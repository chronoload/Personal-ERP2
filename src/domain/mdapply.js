// ============================================================
// domain/mdapply.js
// 把 mdimport 解析出的候选应用到 db（双向的「写回」半边）：
//   智能匹配（默认，不依赖 id 注释）——按「名称 + 所属」在 db 里找已有实体：
//     目标：名称唯一匹配；
//     计划：名称 + 所属目标匹配；
//     活动：名称 + 所属计划匹配（未分类 = 无 plan_ids）。
//   匹配到 → 更新已有实体（不复制）；匹配不到 → 用 hash 生成稳定 id 新建。
//   状态对齐：候选显式标注状态且与 db 不同 → 走 engine 状态机（合法流转则设，否则 warning）。
//   缺失即删：候选带 mirror（完整镜像）时，收集 db 中候选未触及的实体为 deletions，
//     由调用方确认后走 applyDeletions 真正删除（md 成为计划面唯一真源）。
// 依赖 engine 的 create/update/状态机/删除工厂，纯逻辑可 node 测试。
// ============================================================
import {
  createGoal, updateGoal, createPlan, updatePlan,
  createActivity, updateActivity,
  setGoalStatus, setPlanStatus, setActivityStatus,
  deleteActivityCascade, deletePlanCascade, deleteGoalCascade,
} from './engine.js';

// 规范化名称：折叠空白、去首尾，用于匹配比较
function norm(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

// 匹配优先（移动端重复守卫）——多重集对账语义：
//   md 缓冲区描述「期望的内容多重集」，同步把 db 对账到该多重集：
//   同签名（规范标题+排程）的第 k 个无 id 行 → 绑定作用域内第 k 个「未被文本显式绑定」的
//   同签名既有活动；不够匹配才新建。保留「同内容多行 = 多实体」的产品语义（ buffer 有 2 行
//   「运动」→ db 就该有 2 个），同时根治移动端 WebView/IME 丢失隐藏式 id 或补绑失败时
//   「每次失焦/重渲染都复制出副本」（分钟条目不断被重复）——同一 buffer 反复应用必然收敛。
// scopeDates（视图模式）：仅匹配视图作用域内的活动（带日期 → 须在日期组覆盖内；无日期 → 未排程组）。
//   null = 不限作用域（完整镜像/手打模式）。datePart：planned_start → 'YYYY-M-D'。
// boundIds：文本中已带 id 显式绑定的活动 id（不参与匹配，防一行多绑）。
// sigCount：本轮同签名无 id 行计数器（跨调用累计，调用方按行序推进）。
function findMatchActivity(db, a, scopeDates, datePart, boundIds, sigCount) {
  const t = norm(a.title);
  if (!t) return null;
  const sig = t + '|' + (a.planned_start || '');
  const k = sigCount.get(sig) || 0;
  sigCount.set(sig, k + 1);
  // 精确签名（标题+排程）对账：同签名第 k 个无 id 行绑定第 k 个「未被文本显式绑定」的
  // 同签名既有活动；不够才新建。保留「同内容多行=多实体」语义，同时根治移动端
  // id 丢失/补绑失败时的逐轮复制（分钟条目不断被重复）。
  const inScope = (x) => {
    if (scopeDates) {
      const dp = datePart(x.planned_start);
      if (dp && !scopeDates.has(dp)) return false;
    }
    return true;
  };
  const sameTitle = (x) => norm(x.title) === t;
  const exactOf = (x) => (x.planned_start || null) === (a.planned_start || null);
  // 只认精确签名（标题+排程）。「同标题不同时间」一律新建（合法语义）。
  // 引擎自动顺延导致的时间漂移由**无条件 id 回填**根治（回填必达 → 下轮按 id 匹配），
  // 不在此做时间容错——那会把「用户新建的另一时段同名活动」误并到既有活动上。
  let idx = -1;
  for (const x of db.activities || []) {
    if (boundIds.has(x.id)) continue;
    if (!inScope(x)) continue;
    if (sameTitle(x) && exactOf(x)) {
      idx++;
      if (idx === k) return x;
    }
  }
  return null;
}

// 记录一条「绑定回执」（既有 id 补回行上用）：与 createdRefs 同构，occ 口径一致（本轮同标题序号）
function pushBindRef(stat, titleCount, id, title) {
  const occ = titleCount.get(norm(title)) || 0;
  titleCount.set(norm(title), occ + 1);
  stat.createdRefs.push({ type: 'activity', id, title, occ, bind: true });
}

// 活动候选稳健化（防「回车/复制」产生的文本噪音 → 数据错乱）：
//   D0 空行 id 错位修复（回车时 Vditor 把上一行行尾的隐藏式 id 标记下移到新的空待办行）：
//      Shape B（最危险）：原行丢了 id、空行带着原活动 id → 原行被当「新活动」→ 复制出副本且反复重建；
//      Shape A（纯复制）：空行也复制了同一个 id → 同一 id 两份。
//      把藏在空行里的 id 归还给「上一个无 id 的内容活动行」；若上一内容行已有 id（Shape A）则丢弃空行 id。
//   D1 空标题跳过（回车空项 `- [ ]` 不落库；但带 id 的空行是「残留引用」→ ghostIds 标记存在，不判缺失）；
//   D2 相邻内容完全相同（忽略 id 差异：标题|时间|归属）→ 视为误操作，合并只留第一行；
//   D3 同 id 重复（编辑器复制了隐藏 id 链接）→ 忽略并警告。
// 返回 { clean, warnings, ghostIds }，保持行序。
function hardenActivities(acts) {
  if (acts) {
    let lastContent = -1;
    for (let i = 0; i < acts.length; i++) {
      const a = acts[i];
      const empty = !norm(a.title);
      if (a.id && empty) {
        if (lastContent >= 0 && !acts[lastContent].id) {
          acts[lastContent].id = a.id; // 归还给上一无 id 内容行（防副本）
          a.id = null; // 空行不再携带身份（防误保护/误报）
        }
        // 上一内容行已有 id（Shape A）或无上一内容行 → 保留 ghost，交 D1/ghostIds
      } else if (!empty) {
        lastContent = i;
      }
    }
  }
  const clean = [];
  const warnings = [];
  const seenIds = new Set();
  const ghostIds = new Set();
  let prevKey = null;
  for (const a of acts || []) {
    const title = norm(a.title);
    if (!title) {
      if (a.id) ghostIds.add(a.id); // 空标题但带 id：该实体在 md 里仍被引用 → 不得判缺失
      continue; // D1
    }
    if (a.id) {
      if (seenIds.has(a.id)) { warnings.push(`「${a.title}」重复 id 行已忽略（可能由复制产生）`); continue; } // D3
      seenIds.add(a.id);
    }
    const key = `${title}|${a.planned_start || ''}|${a.plan_key || ''}`;
    if (key === prevKey) { warnings.push(`「${a.title}」内容相同的相邻行已合并`); continue; } // D2
    prevKey = key;
    clean.push(a);
  }
  return { clean, warnings, ghostIds };
}

/**
 * 视图局部同步：md 是 db 按日期重排的组织（frontmatter `view:`）。
 * 只更新带 id 的活动（标题/时间/时长/归属/状态），可新增（无 id 行 → 新建并补 id 绑定）。
 * 缺失即删**限定视图覆盖范围**：覆盖 = 视图 md 出现的「## 日期组」内活动 ∪ 未排程活动；
 * 范围内缺失 → 收集 deletions（确认后删），范围外（其他日期）完全不碰。
 */
function applyViewCandidates(db, r) {
  const stat = { created: 0, updated: 0, deletions: [], statusFails: [], createdRefs: [], warnings: [...(r.warnings || [])] };
  const planTitleToId = new Map((db.plans || []).map((p) => [norm(p.title), p.id]));
  const datePart = (dt) => String(dt || '').split('T')[0];
  // 视图覆盖的日期组（「## 日期标题」解析出的 dateBase）+ 触及的活动 id
  const scopeDates = new Set((r.plans || []).filter((p) => p.dateBase).map((p) => p.dateBase));
  const touched = new Set();
  const titleCount = new Map(); // 同标题新建序号（回填 occurrence 用）
  const resolvePlanId = (a) => {
    if (!a.plan_key || !r.plans) return null;
    const pc = r.plans.find((p) => p.key === a.plan_key);
    return pc && pc.title && planTitleToId.has(norm(pc.title)) ? planTitleToId.get(norm(pc.title)) : null;
  };
  // 稳健化：空标题跳过 / 相邻重复合并 / 同 id 降级；ghostIds（空标题带 id 的残留引用）也视为存在
  const { clean: acts, warnings: hw, ghostIds } = hardenActivities(r.activities);
  stat.warnings.push(...hw);
  for (const gid of ghostIds) touched.add(gid);
  // 匹配优先上下文：文本已显式绑定的 id 不参与匹配；同签名无 id 行按出现序号对账
  const boundIds = new Set(acts.filter((x) => x.id).map((x) => x.id));
  const sigCount = new Map();
  for (const a of acts) {
    // 无 id：先匹配优先（作用域内同标题+同排程 → 绑定既有 id 走更新，不新建）；确实无匹配才新建
    if (!a.id) {
      const ex = findMatchActivity(db, a, scopeDates, datePart, boundIds, sigCount);
      if (ex) { a.id = ex.id; pushBindRef(stat, titleCount, ex.id, a.title); }
    }
    // 仍无 id：视图内新增行 → 新建活动（db 授 seq id，防内容推导身份冲突）；返回 createdRefs 供补 id 绑定
    if (!a.id) {
      const res = createActivity(db, {
        title: a.title, note: a.note || '',
        plan_ids: resolvePlanId(a) ? [resolvePlanId(a)] : [],
        planned_start: a.planned_start || null,
        planned_minutes: a.planned_minutes || 0,
      });
      if (!res.ok) { stat.warnings.push(res.error); continue; }
      stat.created++;
      const id = db.activities[db.activities.length - 1].id;
      const occ = titleCount.get(norm(a.title)) || 0;
      titleCount.set(norm(a.title), occ + 1);
      stat.createdRefs.push({ type: 'activity', id, title: a.title, occ });
      touched.add(id);
      // 状态标记（如 [x]）走状态机；新建默认 Planned，非法流转记 statusFails（唤起完成面板）
      if (a.status && a.status !== 'Planned') {
        const sr = setActivityStatus(db, id, a.status);
        if (!sr.ok) {
          stat.warnings.push(`「${a.title}」状态 Planned→${a.status} 未生效：${sr.error}`);
          stat.statusFails.push({ type: 'activity', id, title: a.title, to: a.status });
        }
      }
      continue;
    }
    const ex = db.activities.find((x) => x.id === a.id);
    if (!ex) continue;
    touched.add(ex.id);
    // 归属：候选带 (计划) → 按名称全局匹配 db 计划；否则保持原值
    let planIds = ex.plan_ids || [];
    if (a.plan_key && r.plans) {
      const pc = r.plans.find((p) => p.key === a.plan_key);
      if (pc && pc.title && planTitleToId.has(norm(pc.title))) planIds = [planTitleToId.get(norm(pc.title))];
    }
    const payload = {
      title: a.title,
      note: ex.note || '',
      plan_ids: planIds,
      planned_start: a.planned_start || ex.planned_start,
      planned_minutes: a.planned_minutes != null ? a.planned_minutes : ex.planned_minutes,
    };
    // 与 db 无差异 → 完全不触碰（视图只同步「对应部分」的实际变更）
    if (payload.title === ex.title
      && payload.note === (ex.note || '')
      && JSON.stringify(payload.plan_ids || []) === JSON.stringify(ex.plan_ids || [])
      && (payload.planned_start || null) === (ex.planned_start || null)
      && (payload.planned_minutes || 0) === (ex.planned_minutes || 0)
      && (a.status == null || a.status === ex.status)) {
      continue;
    }
    const res = updateActivity(db, ex.id, payload);
    if (!res.ok) { stat.warnings.push(res.error); continue; }
    stat.updated++;
    // 状态对齐：走状态机（不绕过；非法流转 warning + statusFails 供回滚/唤起完成面板）
    if (a.status != null && a.status !== ex.status) {
      const sr = setActivityStatus(db, ex.id, a.status);
      if (!sr.ok) {
        stat.warnings.push(`「${a.title}」状态 ${ex.status}→${a.status} 未生效：${sr.error}`);
        stat.statusFails.push({ type: 'activity', id: ex.id, title: a.title, to: a.status });
      }
    }
  }
  // 范围内缺失即删（对齐完整镜像，但作用域限定视图覆盖范围）
  if (scopeDates.size) {
    for (const a of db.activities || []) {
      const dp = datePart(a.planned_start);
      const inScope = dp ? scopeDates.has(dp) : true; // 无排程活动视图底部总展示 → 也在覆盖范围
      if (inScope && !touched.has(a.id)) {
        stat.deletions.push({ type: 'activity', id: a.id, title: a.title });
      }
    }
  }
  return stat;
}

/**
 * 应用候选到 db（原地修改并返回统计）。
 * 只做创建/更新 + 状态对齐 + 收集待删（不实际删除）；deletions 由调用方确认后 applyDeletions。
 * @param {object} db 现有 db（会被就地更新）
 * @param {object} r  parseMdImport 的候选 { goals, plans, activities, warnings, mirror }
 * @returns {{ created:number, updated:number, deletions:Array<{type,id,title}>, warnings:Array }}
 */
export function applyCandidates(db, r) {
  // 视图局部同步（day/week/month 组织 md）：只更新带 id 的活动，不创建/删除目标/计划、不缺失即删
  if (r.view) return applyViewCandidates(db, r);
  const stat = { created: 0, updated: 0, deletions: [], statusFails: [], createdRefs: [], warnings: [...(r.warnings || [])] };
  const goalIdByKey = new Map(); // 候选 goal key → db goal id（供计划/活动映射归属）
  const planIdByKey = new Map(); // 候选 plan key → db plan id
  const touchedActIds = new Set(); // 候选触及的活动 id（缺失即删判定）
  const titleCount = new Map(); // 同标题新建序号（回填 occurrence 用）

  const alignGoalStatus = (id, status, title) => {
    if (status == null) return;
    const g = db.goals.find((x) => x.id === id);
    if (!g || g.status === status) return;
    const sr = setGoalStatus(db, id, status);
    if (!sr.ok) { stat.warnings.push(`「${title}」状态 ${g.status}→${status} 未生效：${sr.error}`); stat.statusFails.push({ type: 'goal', id, title, to: status }); }
  };
  const alignPlanStatus = (id, status, title) => {
    if (status == null) return;
    const p = db.plans.find((x) => x.id === id);
    if (!p || p.status === status) return;
    const sr = setPlanStatus(db, id, status);
    if (!sr.ok) { stat.warnings.push(`「${title}」状态 ${p.status}→${status} 未生效：${sr.error}`); stat.statusFails.push({ type: 'plan', id, title, to: status }); }
  };
  const alignActStatus = (id, status, title) => {
    if (status == null) return;
    const a = db.activities.find((x) => x.id === id);
    if (!a || a.status === status) return;
    const sr = setActivityStatus(db, id, status);
    if (!sr.ok) { stat.warnings.push(`「${title}」状态 ${a.status}→${status} 未生效：${sr.error}（需在 App 内走状态流程）`); stat.statusFails.push({ type: 'activity', id, title, to: status }); }
  };

  // ---- goals：id 绑定更新（改名不断链）；无 id 一律新建（不按名称匹配，防覆写已有对象）----
  for (const g of r.goals || []) {
    const ex = g.id ? db.goals.find((x) => x.id === g.id) : null;
    if (ex) {
      const res = updateGoal(db, ex.id, { title: g.title, desc: g.desc });
      if (res.ok) { stat.updated++; goalIdByKey.set(g.key, ex.id); alignGoalStatus(ex.id, g.status, g.title); }
      else stat.warnings.push(res.error);
    } else {
      const res = createGoal(db, { title: g.title, desc: g.desc, _id: g.id || undefined });
      if (res.ok) {
        const id = db.goals[db.goals.length - 1].id;
        goalIdByKey.set(g.key, id);
        stat.created++;
        const occ = titleCount.get(norm(g.title)) || 0;
        titleCount.set(norm(g.title), occ + 1);
        stat.createdRefs.push({ type: 'goal', id, title: g.title, occ });
        alignGoalStatus(id, g.status, g.title);
      } else stat.warnings.push(res.error);
    }
  }

  // ---- plans：id 绑定更新；无 id 一律新建（不按名称匹配）----
  for (const p of r.plans || []) {
    let ex = p.id ? db.plans.find((x) => x.id === p.id) : null;
    if (ex) {
      const res = updatePlan(db, ex.id, { title: p.title, budget: ex.budget ?? null });
      if (res.ok) { stat.updated++; planIdByKey.set(p.key, ex.id); alignPlanStatus(ex.id, p.status, p.title); }
      else stat.warnings.push(res.error);
    } else {
      const goalId = goalIdByKey.get(p.goal_key) || null;
      const res = createPlan(db, { goal_id: goalId, title: p.title, budget: null, _id: p.id || undefined });
      if (res.ok) {
        const id = db.plans[db.plans.length - 1].id;
        planIdByKey.set(p.key, id);
        stat.created++;
        const occ = titleCount.get(norm(p.title)) || 0;
        titleCount.set(norm(p.title), occ + 1);
        stat.createdRefs.push({ type: 'plan', id, title: p.title, occ });
        alignPlanStatus(id, p.status, p.title);
      } else stat.warnings.push(res.error);
    }
  }

  // ---- activities：id 绑定更新（改名不断链）；无 id 行按多重集对账匹配既有（见 findMatchActivity）----
  const { clean: actCands, warnings: hw, ghostIds } = hardenActivities(r.activities);
  stat.warnings.push(...hw);
  for (const gid of ghostIds) touchedActIds.add(gid);
  const mirrorBoundIds = new Set(actCands.filter((x) => x.id).map((x) => x.id));
  const mirrorSigCount = new Map();
  for (const a of actCands) {
    // 无 id：匹配优先（同标题+同排程 → 绑定既有 id 走更新，不新建；防镜像导回 id 丢失复制整本账）
    if (!a.id) {
      const exm = findMatchActivity(db, a, null, null, mirrorBoundIds, mirrorSigCount);
      if (exm) { a.id = exm.id; pushBindRef(stat, titleCount, exm.id, a.title); }
    }
    const planId = planIdByKey.get(a.plan_key) || null;
    const payload = {
      title: a.title,
      note: a.note || '',
      plan_ids: planId ? [planId] : [],
      planned_start: a.planned_start || null,
      planned_minutes: a.planned_minutes || 0,
    };
    const ex = a.id ? db.activities.find((x) => x.id === a.id) : null;
    if (ex) {
      const res = updateActivity(db, ex.id, payload);
      if (!res.ok) { stat.warnings.push(res.error); continue; }
      stat.updated++;
      touchedActIds.add(ex.id);
      alignActStatus(ex.id, a.status, a.title);
    } else {
      const res = createActivity(db, { ...payload, _id: a.id || undefined });
      if (!res.ok) { stat.warnings.push(res.error); continue; }
      stat.created++;
      const id = db.activities[db.activities.length - 1].id;
      touchedActIds.add(id);
      const occ = titleCount.get(norm(a.title)) || 0;
      titleCount.set(norm(a.title), occ + 1);
      stat.createdRefs.push({ type: 'activity', id, title: a.title, occ });
      alignActStatus(id, a.status, a.title);
    }
  }

  // ---- 缺失即删（仅完整镜像）：收集 db 中候选未触及的实体 ----
  if (r.mirror) {
    const goalIds = new Set(goalIdByKey.values());
    const planIds = new Set(planIdByKey.values());
    for (const g of db.goals) if (!goalIds.has(g.id)) {
      stat.deletions.push({ type: 'goal', id: g.id, title: g.title });
    }
    for (const p of db.plans) if (!planIds.has(p.id)) {
      stat.deletions.push({ type: 'plan', id: p.id, title: p.title });
    }
    for (const a of db.activities) if (!touchedActIds.has(a.id)) {
      stat.deletions.push({ type: 'activity', id: a.id, title: a.title });
    }
  }
  return stat;
}

/**
 * 真正执行删除（由调用方在确认后调用）：级联删除活动/计划/目标（含产出/价值流/流水）。
 * @param {object} db
 * @param {Array<{type,id,title}>} deletions applyCandidates 收集的待删列表
 * @returns {{ deleted:number, warnings:Array }}
 */
export function applyDeletions(db, deletions) {
  let deleted = 0;
  const warnings = [];
  // 先删活动（级联产出/流水），再删计划（级联专属活动），最后删目标（级联计划）
  const order = { activity: 0, plan: 1, goal: 2 };
  const sorted = [...(deletions || [])].sort((x, y) => (order[x.type] ?? 3) - (order[y.type] ?? 3));
  for (const d of sorted) {
    let r;
    if (d.type === 'activity') r = deleteActivityCascade(db, d.id);
    else if (d.type === 'plan') r = deletePlanCascade(db, d.id);
    else r = deleteGoalCascade(db, d.id);
    if (r.ok) deleted++;
    else warnings.push(`「${d.title}」删除未生效：${r.error}`);
  }
  return { deleted, warnings };
}

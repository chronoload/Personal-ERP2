// ============================================================
// domain/templates.js —— 渐进式生涯模板链
//
// 三个语义：
//   1) 内置模板 = 多阶段链（stages）。应用只建「下一阶段」，
//      用户看到效果后再手动推进，不会一上来铺满预算。
//   2) 自定义模板 = 目标级 / 计划级快照，不再整库打包。
//   3) 模板只描述结构；预算由 UI 用建议预算换算，写入仍走 engine。
// ============================================================

export const TEMPLATE_CATEGORIES = ['学生', '学术', '产品', '健康', '自定义'];

// 内置模板：stages[].share 为该阶段占建议预算的比例（同一模板合计 1）；
// stage.goal 下的 plans[].weight 为该阶段内的分配比例（通常 1）。
import { BUILTIN_TEMPLATES } from './builtinTemplates.js';
export { BUILTIN_TEMPLATES };

function todayKey(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function planCountOf(plans) { return (plans || []).length; }
function activityCountOf(plans) {
  return (plans || []).reduce((s, p) => s + ((p.activities || []).length), 0);
}

// 兼容 st.goal（旧内置形状）与 st.goals（MD 导入可多目标）
function stageGoals(st) {
  if (!st) return [];
  if (Array.isArray(st.goals)) return st.goals.filter(Boolean);
  return st.goal ? [st.goal] : [];
}

function isStaged(tpl) {
  return !!tpl && Array.isArray(tpl.stages) && tpl.stages.length > 0;
}

export function templateStats(tpl) {
  if (!tpl) return { goals: 0, plans: 0, activities: 0, stages: 0 };
  if (isStaged(tpl)) {
    const stages = tpl.stages;
    const plans = stages.flatMap((st) => stageGoals(st).flatMap((g) => g.plans || []));
    return {
      stages: stages.length,
      goals: stages.reduce((s, st) => s + stageGoals(st).length, 0),
      plans: planCountOf(plans),
      activities: activityCountOf(plans),
    };
  }
  if (tpl.kind === 'goal') {
    const plans = (tpl.goals || []).flatMap((g) => g.plans || []);
    return { stages: 0, goals: (tpl.goals || []).length, plans: planCountOf(plans), activities: activityCountOf(plans) };
  }
  const p = tpl.plan ? [tpl.plan] : [];
  return { stages: 0, goals: 0, plans: planCountOf(p), activities: activityCountOf(p) };
}

// 已应用到第几阶段（1-based；0 = 尚未应用）
export function appliedStage(db, tplId) {
  const stages = (db.goals || [])
    .filter((g) => g && g.tpl_id === tplId)
    .map((g) => Math.max(0, Math.round(num(g.tpl_stage))));
  return stages.length ? Math.max(...stages) : 0;
}

// 把模板展开成可创建的 payload。内置模板必须指定 stage（1-based）。
export function buildTemplatePayload(tpl, { recommended = 0, stage = 1, now = Date.now() } = {}) {
  const date = todayKey(now);
  const makePlan = (p, budget) => {
    const activities = (p.activities || []).map((a) => ({
      title: a.title,
      planned_date: date,
      planned_minutes: Math.max(0, num(a.minutes)),
      repeat: a.repeat || null,
      depth: a.depth === true ? true : (a.depth === false ? false : null),
    }));
    return {
      title: p.title,
      budget,
      priority: Math.max(1, Math.min(5, Math.round(num(p.priority) || 3))),
      horizonMonths: Math.max(1, Math.round(num(p.horizonMonths) || 3)),
      activities,
    };
  };

  if (isStaged(tpl)) {
    const st = tpl.stages[stage - 1];
    const goalsInStage = stageGoals(st);
    if (!st || !goalsInStage.length) {
      return { kind: 'stage', stage, goals: [], budgetTotal: 0, planCount: 0, activityCount: 0 };
    }
    const stageBudget = Math.max(0, recommended * num(st.share));
    // 阶段内权重归一化：多个计划的 weight 不必手写为 1，避免阶段预算被放大。
    const weightedPlans = goalsInStage.flatMap((g) => (g.plans || [])
      .filter((p) => p.budget === null || p.budget === undefined));
    const weightSum = weightedPlans.reduce((s, p) => s + Math.max(0, num(p.weight) || 1), 0) || 1;
    const goals = goalsInStage.map((g) => ({
      title: g.title,
      plans: (g.plans || []).map((p) => {
        const budget = p.budget === null || p.budget === undefined
          ? Math.round(stageBudget * (Math.max(0, num(p.weight) || 1) / weightSum))
          : Math.max(0, num(p.budget));
        return makePlan(p, budget);
      }),
    }));
    const plans = goals.flatMap((g) => g.plans);
    return {
      kind: 'stage',
      stage,
      goals,
      budgetTotal: plans.reduce((s, p) => s + (p.budget || 0), 0),
      planCount: plans.length,
      activityCount: plans.reduce((s, p) => s + p.activities.length, 0),
    };
  }

  if (tpl.kind === 'plan') {
    const p = tpl.plan;
    if (!p) return { kind: 'plan', plan: null, budgetTotal: 0, planCount: 0, activityCount: 0 };
    const plan = makePlan(p, p.budget === null || p.budget === undefined ? null : Math.max(0, num(p.budget)));
    return {
      kind: 'plan',
      plan,
      budgetTotal: plan.budget || 0,
      planCount: 1,
      activityCount: plan.activities.length,
    };
  }

  // 目标级自定义模板：绝对预算原样还原
  const goals = (tpl.goals || []).map((g) => ({
    title: g.title,
    plans: (g.plans || []).map((p) => makePlan(p, p.budget === null || p.budget === undefined ? null : Math.max(0, num(p.budget)))),
  }));
  const plans = goals.flatMap((g) => g.plans);
  return {
    kind: 'goal',
    goals,
    budgetTotal: plans.reduce((s, p) => s + (p.budget || 0), 0),
    planCount: plans.length,
    activityCount: plans.reduce((s, p) => s + p.activities.length, 0),
  };
}

// ---------------- 自定义模板：目标级 / 计划级 ----------------

function goalSnapshot(db, g) {
  return {
    title: g.title,
    plans: (db.plans || [])
      .filter((p) => p.goal_id === g.id && p.status !== 'Archived' && p.status !== 'Completed')
      .map((p) => ({
        title: p.title,
        budget: p.budget === null || p.budget === undefined ? null : num(p.budget),
        priority: num(p.priority) || 3,
        horizonMonths: num(p.horizonMonths) || 3,
        activities: (db.activities || [])
          .filter((a) => (a.plan_ids || []).includes(p.id) && a.status !== 'Archived')
          .map((a) => ({
            title: a.title,
            minutes: num(a.planned_minutes),
            repeat: a.repeat || null,
            depth: a.depth === true ? true : (a.depth === false ? false : null),
          })),
      })),
  };
}

export function extractGoalTemplate(db, goalId, name, now = Date.now()) {
  const g = (db.goals || []).find((x) => x.id === goalId);
  if (!g) return null;
  const snap = goalSnapshot(db, g);
  if (!snap.plans.length) return null;
  return {
    id: null, builtin: false, kind: 'goal', category: '自定义',
    name: String(name || g.title).trim() || g.title,
    created: now, goals: [snap],
  };
}

export function extractPlanTemplate(db, planId, name, now = Date.now()) {
  const p = (db.plans || []).find((x) => x.id === planId);
  if (!p) return null;
  return {
    id: null, builtin: false, kind: 'plan', category: '自定义',
    name: String(name || p.title).trim() || p.title,
    created: now,
    plan: {
      title: p.title,
      budget: p.budget === null || p.budget === undefined ? null : num(p.budget),
      priority: num(p.priority) || 3,
      horizonMonths: num(p.horizonMonths) || 3,
      activities: (db.activities || [])
        .filter((a) => (a.plan_ids || []).includes(p.id) && a.status !== 'Archived')
        .map((a) => ({
          title: a.title,
          minutes: num(a.planned_minutes),
          repeat: a.repeat || null,
          depth: a.depth === true ? true : (a.depth === false ? false : null),
        })),
    },
  };
}

// ============================================================
// MD schema：模板的文本序列化 / 反序列化
//
// 设计目标是「人手能写、模型能产出、解析器能严格校验」：
//   # 模板名称
//   分类: 学生
//   描述: 一句话
//
//   阶段: 启动 | 0.5
//   目标: 学业主线
//   计划: 课程学习 | 优先级 1 | 周期 3 | 权重 1
//   - 听课与笔记 | 90 | weekday | 深度
//
// 约束：阶段占比合计 1；同阶段内权重合计 1（或缺省时均分）；
//      活动分钟 0–600；优先级 1–5；周期 1–36 月。
// ============================================================

export const TEMPLATE_MD_SCHEMA = `# 模板名称
分类: 学生 | 学术 | 产品 | 健康 | 自定义
描述: 一句话说明

阶段: 启动 | 0.5
目标: 目标名称
计划: 计划名称 | 优先级 1 | 周期 3 | 权重 1
- 活动名称 | 90 | weekday | 深度
- 活动名称 | 45 | weekday

阶段: 扩展 | 0.3
目标: 另一个目标
计划: 另一个计划 | 优先级 2 | 周期 6 | 权重 1
- 活动名称 | 60 | daily`;

const REPEAT_MAP = {
  daily: 'daily', 每天: 'daily', 每日: 'daily',
  weekday: 'weekday', 工作日: 'weekday',
  weekly: 'weekly', 每周: 'weekly',
  once: null, 一次: null, 单次: null,
};

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function parsePlanAttr(part) {
  const m = String(part).match(/^(优先级|周期|权重|预算|priority|horizon|weight|budget)\s*[:：=]?\s*(.+)$/i);
  if (!m) return null;
  const rawKey = m[1].toLowerCase();
  const key = rawKey === '优先级' ? 'priority'
    : rawKey === '周期' ? 'horizon'
      : rawKey === '权重' ? 'weight'
        : rawKey === '预算' ? 'budget' : rawKey;
  return { key, raw: m[2].trim() };
}

function parseActivityLine(line) {
  const parts = line.replace(/^[-*]\s+/, '').split('|').map((s) => s.trim());
  const title = parts.shift() || '';
  let minutes = 0;
  let repeat = null;
  let depth = null;
  for (const part of parts) {
    if (!part) continue;
    const mm = part.match(/^(\d+(?:\.\d+)?)\s*(分钟|分|min|m)?$/i);
    if (mm) { minutes = Math.max(0, Math.min(600, Number(mm[1]))); continue; }
    const low = part.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(REPEAT_MAP, low)) repeat = REPEAT_MAP[low];
    else if (low === '深度' || low === 'deep') depth = true;
    else if (low === '浅层' || low === 'shallow' || low === 'light') depth = false;
  }
  return { title, minutes, repeat, depth };
}

export function parseTemplateMD(md) {
  const errors = [];
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const tpl = { id: null, builtin: false, imported: true, category: '自定义', name: '', desc: '', stages: [] };
  let stage = null;
  let goal = null;
  let plan = null;

  const ensureStage = () => {
    if (!stage) {
      stage = { name: '默认', share: 1, goals: [] };
      tpl.stages.push(stage);
    }
    return stage;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) continue;

    if (/^#\s+/.test(t) && !tpl.name) {
      tpl.name = t.replace(/^#\s+/, '').replace(/^模板\s*[:：]\s*/, '').trim();
      continue;
    }
    if (/^#{2,}\s+/.test(t)) {
      ensureStage();
      goal = { title: t.replace(/^#+\s+/, '').trim(), plans: [] };
      stage.goals.push(goal);
      plan = null;
      continue;
    }
    const meta = t.match(/^(分类|描述)\s*[:：]\s*(.*)$/);
    if (meta && !stage) {
      if (meta[1] === '分类') tpl.category = meta[2].trim() || '自定义';
      else tpl.desc = meta[2].trim();
      continue;
    }
    const st = t.match(/^阶段\s*[:：]\s*(.+)$/);
    if (st) {
      const parts = st[1].split('|').map((x) => x.trim());
      stage = { name: parts[0] || '阶段', share: parts[1] !== undefined && parts[1] !== '' ? Number(parts[1]) : null, goals: [] };
      tpl.stages.push(stage);
      goal = null;
      plan = null;
      continue;
    }
    const g = t.match(/^目标\s*[:：]\s*(.+)$/);
    if (g) {
      ensureStage();
      goal = { title: g[1].trim(), plans: [] };
      stage.goals.push(goal);
      plan = null;
      continue;
    }
    const p = t.match(/^计划\s*[:：]\s*(.+)$/);
    if (p) {
      if (!goal) { errors.push(`第 ${i + 1} 行：计划前需要「目标:」`); continue; }
      const parts = p[1].split('|').map((x) => x.trim());
      const title = parts.shift() || '';
      const attrs = { weight: undefined, budget: undefined, priority: 3, horizon: 3 };
      for (const part of parts) {
        if (!part) continue;
        const a = parsePlanAttr(part);
        if (!a) { errors.push(`第 ${i + 1} 行：无法识别计划属性「${part}」`); continue; }
        if (a.key === 'priority') attrs.priority = clampInt(a.raw, 1, 5, 3);
        else if (a.key === 'horizon') attrs.horizon = clampInt(a.raw, 1, 36, 3);
        else if (a.key === 'weight') attrs.weight = Math.max(0, Number(a.raw) || 0);
        else if (a.key === 'budget') attrs.budget = Math.max(0, Number(a.raw) || 0);
      }
      plan = {
        title,
        priority: attrs.priority,
        horizonMonths: attrs.horizon,
        weight: attrs.weight,
        budget: attrs.budget === undefined ? null : attrs.budget,
        activities: [],
      };
      goal.plans.push(plan);
      continue;
    }
    if (/^[-*]\s+/.test(t)) {
      if (!plan) { errors.push(`第 ${i + 1} 行：活动前需要「计划:」`); continue; }
      const a = parseActivityLine(t);
      if (!a.title) errors.push(`第 ${i + 1} 行：活动名称为空`);
      else plan.activities.push(a);
      continue;
    }
    errors.push(`第 ${i + 1} 行：无法识别「${t}」`);
  }

  if (!tpl.name) errors.push('缺少模板名称：首行写「# 模板名称」');
  if (!tpl.stages.length) errors.push('至少需要一个阶段或目标');
  for (const s of tpl.stages) {
    if (!stageGoals(s).length) errors.push(`阶段「${s.name}」没有目标`);
    for (const g of stageGoals(s)) {
      if (!g.title) errors.push('存在空目标名称');
      if (!(g.plans || []).length) errors.push(`目标「${g.title}」没有计划`);
    }
  }

  // 阶段占比：缺省均分，最终归一化到 1
  const defined = tpl.stages.filter((s) => Number.isFinite(s.share));
  const missing = tpl.stages.filter((s) => !Number.isFinite(s.share));
  if (missing.length) {
    const used = defined.reduce((sum, s) => sum + Math.max(0, s.share), 0);
    const each = missing.length ? Math.max(0, 1 - used) / missing.length : 0;
    missing.forEach((s) => { s.share = each; });
  }
  const shareSum = tpl.stages.reduce((sum, s) => sum + Math.max(0, Number(s.share) || 0), 0);
  if (shareSum > 0) tpl.stages.forEach((s) => { s.share = Math.max(0, Number(s.share) || 0) / shareSum; });

  // 同阶段计划权重：无绝对预算时归一化
  for (const s of tpl.stages) {
    const plans = stageGoals(s).flatMap((g) => g.plans || []);
    if (!plans.length) continue;
    if (plans.some((p) => p.budget !== null && p.budget !== undefined)) continue; // 绝对预算优先
    const definedW = plans.filter((p) => Number.isFinite(p.weight) && p.weight > 0);
    if (!definedW.length) plans.forEach((p) => { p.weight = 1; });
    else plans.forEach((p) => { if (!(Number.isFinite(p.weight) && p.weight > 0)) p.weight = 1; });
    const sum = plans.reduce((acc, p) => acc + (Number(p.weight) || 0), 0);
    if (sum > 0) plans.forEach((p) => { p.weight = (Number(p.weight) || 0) / sum; });
  }

  return { template: tpl, errors, stats: templateStats(tpl) };
}

export function serializeTemplateMD(tpl) {
  const lines = [];
  lines.push(`# ${tpl.name || '未命名模板'}`);
  lines.push(`分类: ${tpl.category || '自定义'}`);
  if (tpl.desc) lines.push(`描述: ${tpl.desc}`);
  lines.push('');

  const stages = isStaged(tpl)
    ? tpl.stages
    : [{ name: '默认', share: 1, goals: tpl.kind === 'plan' ? [{ title: tpl.plan.title, plans: [tpl.plan] }] : (tpl.goals || []) }];

  for (const st of stages) {
    lines.push(`阶段: ${st.name || '阶段'} | ${Number(st.share) || 1}`);
    for (const g of stageGoals(st)) {
      lines.push(`目标: ${g.title}`);
      for (const p of g.plans || []) {
        const attrs = [`优先级 ${p.priority || 3}`, `周期 ${p.horizonMonths || 3}`];
        if (p.budget !== null && p.budget !== undefined) attrs.push(`预算 ${p.budget}`);
        else attrs.push(`权重 ${p.weight ?? 1}`);
        lines.push(`计划: ${p.title} | ${attrs.join(' | ')}`);
        for (const a of p.activities || []) {
          const parts = [a.title, String(a.minutes ?? 0)];
          if (a.repeat) parts.push(a.repeat);
          if (a.depth === true) parts.push('深度');
          lines.push(`- ${parts.join(' | ')}`);
        }
      }
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

// 批量：一个 MD 文件可含多个模板，以一级标题「# 模板名」切分
export function parseTemplatesMD(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const chunks = [];
  let cur = null;
  for (const line of lines) {
    const t = line.trim();
    if (/^#\s+/.test(t) && !/^##\s+/.test(t)) {
      if (cur && cur.length) chunks.push(cur);
      cur = [line];
    } else if (cur) {
      cur.push(line);
    }
  }
  if (cur && cur.length) chunks.push(cur);
  return chunks.map((chunk) => parseTemplateMD(chunk.join('\n')));
}

export function serializeTemplatesMD(templates) {
  return (templates || []).map(serializeTemplateMD).join('\n\n');
}

// 单个文件独立解析：文件内可含多个「# 模板」；没有一级标题时用文件名兜底。
export function parseTemplateFile(filename, text) {
  const src = String(text || '').trim();
  if (!src) return [];
  const base = String(filename || 'template').replace(/\.(md|markdown)$/i, '').trim() || 'template';
  const withName = /^#\s+/m.test(src) ? src : `# ${base}\n${src}`;
  return parseTemplatesMD(withName);
}

// 把「MD 编辑结果」合并回原模板：目标级/计划级保留原 kind，阶段模板替换 stages。
export function mergeEditedTemplate(original, parsed) {
  if (!original || !parsed || !Array.isArray(parsed.stages)) return null;
  const base = {
    name: parsed.name || original.name,
    category: parsed.category || original.category || '自定义',
    desc: parsed.desc || '',
  };
  if (original.kind === 'goal') {
    const goals = parsed.stages.flatMap((st) => (Array.isArray(st.goals) ? st.goals : (st.goal ? [st.goal] : [])));
    if (!goals.length) return null;
    return { ...original, ...base, goals };
  }
  if (original.kind === 'plan') {
    const firstGoal = parsed.stages[0] && (parsed.stages[0].goals || [])[0];
    const firstPlan = firstGoal && (firstGoal.plans || [])[0];
    if (!firstPlan) return null;
    return { ...original, ...base, plan: firstPlan };
  }
  return { ...original, ...base, stages: parsed.stages };
}

export const TEMPLATE_PROMPT = `你是我的「生涯资本规划师」。请通过多轮提问，帮我把目标整理成一个可导入 Personal ERP 的模板。

【提问规则】
1. 先逐项问清：我的身份/阶段、每周可投入时间、可用预算或资源、当前最想推进的 1-3 件事、健康/学习/工作权重、最担心的风险。
2. 每次只问一个问题，等我回答后再问下一个；最多 6 轮。
3. 信息足够后，直接输出 Markdown 模板；不要解释、不要前后缀，只给一个 \`\`\`markdown 代码块。

【模板规则】
- 2-4 个阶段，阶段占比合计 1（建议 0.5 / 0.3 / 0.2）。
- 每阶段 1-2 个目标；每个目标 1-3 个计划；每个计划 1-3 个活动。
- 活动时长 20-120 分钟；repeat 只能是 daily / weekday / weekly；深度专注写「深度」，否则留空。
- 优先级 1-5（1 最高）；周期 1/3/6/12 个月。
- 预算写相对权重（0.1-1），不要写绝对金额；系统会按我的可用资本换算。
- 阶段要由轻到重：第一阶段只放最核心的一条主线，后续阶段再扩展；不要一上来铺满。

【格式（严格遵守）】
${TEMPLATE_MD_SCHEMA}

现在开始，先问我第一个问题。`;


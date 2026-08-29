// ============================================================
// domain/importMerge.js
// 增量合并导入（纯函数，可测试）：
//   - 同名资源 → 复用现有账户（其流水/规则/商品成本引用重映射到已有 id，不新增）
//   - 同批内重复资源 id → 首见为准：后续同名异号/同号异名条目跳过并计数（skippedDupRes），
//     保证 resMap 不被后写覆盖、流水归属稳定跟随首见账户
//   - 其余实体 → 按 id 去重追加（已有 id 跳过），并做字段结构兜底规范化
// ============================================================
import { ensureSeq } from '../store/db.js';

export function inspectImport(db, incoming) {
  const byName = new Set(db.resources.map((r) => r.name));
  const all = incoming.resources || [];
  const sameRes = all.filter((r) => byName.has(r.name)).length;
  const nNew = (key) => {
    const have = new Set((db[key] || []).map((x) => x.id));
    return (incoming[key] || []).filter((x) => x && x.id != null && !have.has(x.id)).length;
  };
  return {
    newRes: all.length - sameRes, sameRes,
    rules: nNew('rules'), goals: nNew('goals'), plans: nNew('plans'),
    activities: nNew('activities'), txs: nNew('txs'),
    outputs: nNew('outputs'), valueflows: nNew('valueflows'),
    goods: nNew('goods'),
  };
}

// 字段规范化：旧格式备份可能缺字段，补齐数组/null 结构，保证引擎安全读取
const asArr = (x) => (Array.isArray(x) ? x : []);
const asNull = (x) => (x === undefined ? null : x);

// ---------- 导入通道时间消毒（仅作用于并入的活动字段） ----------
// 脏时间字符串会被引擎静默进位/降级：'T25:70' 滚到次日、'T9:5' 触发弹性化并清空捆绑。
// 这里严格校验 + Date 组件往返核对，不合格一律置 null（弹性安全兜底，绝不抛异常）。
const DT_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})T([0-9]|0[0-9]|1[0-9]|2[0-3]):([0-5][0-9])$/;
function validDt(v) {
  const m = typeof v === 'string' ? v.match(DT_RE) : null;
  if (!m) return null;
  const [y, mo, d, h, mi] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
  const t = new Date(y, mo - 1, d, h, mi);
  return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d && t.getHours() === h && t.getMinutes() === mi ? v : null;
}
function validDay(v) { // repeat_until：补零日期且真实存在，否则 null
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, mo, d] = v.split('-').map(Number);
  const t = new Date(y, mo - 1, d);
  return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d ? v : null;
}
const looseDay = (v) => (typeof v === 'string' && /^\d{4}-\d{1,2}-\d{1,2}$/.test(v) ? v : null); // planned_date：宽松日期原样保留

export function mergeImport(db, incoming) {
  // ★ 结构预检：不合格的 incoming 直接拒绝，绝不半途而废
  if (!incoming || !Array.isArray(incoming.resources)) {
    throw new Error('备份缺少 resources 集合，不是有效的 Personal ERP 备份');
  }
  // ★ 纯函数化：在深拷贝上合并，全程无异常才换回原对象字段；
  //   中途任何一步失败，调用方的 db 保持原样（杜绝半残库被持久化）
  const work = JSON.parse(JSON.stringify(db));
  const resMap = {};
  const byName = new Map(work.resources.map((r) => [r.name, r]));
  let addedRes = 0, reusedRes = 0, skippedDupRes = 0;
  const seenIncIds = new Set(); // 批内已见的 incoming 资源 id：重复即跳过（首见为准），防 resMap 后写覆盖导致资金错户
  for (const ir of incoming.resources.filter((x) => x && typeof x === 'object')) {
    if (seenIncIds.has(ir.id)) { skippedDupRes++; continue; }
    seenIncIds.add(ir.id);
    const ex = byName.get(ir.name);
    if (ex) { resMap[ir.id] = ex.id; reusedRes++; }
    else {
      const copy = { ...ir, id: 'r' + ((work.seq.r = (work.seq.r || 0) + 1)) };
      work.resources.push(copy);
      byName.set(copy.name, copy);
      resMap[ir.id] = copy.id;
      addedRes++;
    }
  }
  const remap = (id) => resMap[id] || id;
  // 各实体的规范化出口（goods.costs 的资源引用在此统一重映射）
  const normalize = {
    rules: (r) => r,
    goals: (g) => ({ ...g }),
    plans: (p) => ({ ...p }),
    activities: (a) => ({
      ...a,
      plan_ids: asArr(a.plan_ids),
      time_logs: asArr(a.time_logs),
      conflicts: asArr(a.conflicts),
      theme: asNull(a.theme),
      planned_start: validDt(a.planned_start),
      planned_end: validDt(a.planned_end),
      repeat_until: validDay(a.repeat_until),
      planned_date: looseDay(a.planned_date),
    }),
    outputs: (o) => ({ ...o, tags: asArr(o.tags), activity_id: asNull(o.activity_id) }),
    valueflows: (v) => ({ ...v, output_id: asNull(v.output_id), activity_ref: asNull(v.activity_ref) }),
    txs: (t) => ({ ...t, reversal_of: asNull(t.reversal_of), source_id: asNull(t.source_id) }),
    goods: (g) => ({
      ...g,
      costs: asArr(g.costs).map((c) => ({ ...c, resource_id: remap(c.resource_id) })),
    }),
  };
  const pushNew = (arr, list, norm) => {
    const have = new Set(arr.map((x) => x.id));
    let n = 0;
    for (const item of (list || []).filter((x) => x && typeof x === 'object' && x.id != null)) {
      if (!have.has(item.id)) {
        have.add(item.id); // 同批导入内重复 id 也只入一条
        arr.push(norm(item));
        n++;
      }
    }
    return n;
  };
  const clean = (key) => (incoming[key] || []).filter((x) => x && typeof x === 'object' && x.id != null);
  const hadActIds = new Set(work.activities.map((a) => a.id)); // 仅约束本次并入的活动
  const counts = {
    rules: pushNew(work.rules, clean('rules').map((r) => ({ ...r, from: remap(r.from), to: remap(r.to) })), normalize.rules),
    goals: pushNew(work.goals, clean('goals'), normalize.goals),
    plans: pushNew(work.plans, clean('plans'), normalize.plans),
    activities: pushNew(work.activities, clean('activities'), normalize.activities),
    outputs: pushNew(work.outputs, clean('outputs'), normalize.outputs),
    valueflows: pushNew(work.valueflows, clean('valueflows'), normalize.valueflows),
    txs: pushNew(work.txs, clean('txs').map((t) => ({ ...t, resource_id: remap(t.resource_id) })), normalize.txs),
    goods: pushNew(work.goods, clean('goods'), normalize.goods),
  };
  // 不变量②兜底（弹性安全）：并入的 Completed 活动若缺有效流水或产出佐证，降级 Planned 并清空实际起止，
  // 防止幽灵完成绕过引擎校验（判定须在全部并入完成后做——txs/outputs 可能与活动同批到达）
  for (const a of work.activities) {
    if (hadActIds.has(a.id) || a.status !== 'Completed') continue;
    const hasTx = work.txs.some((t) => t.source_type === 'activity' && t.source_id === a.id && !t.reversal_of);
    const hasOut = work.outputs.some((o) => o.activity_id === a.id);
    if (!hasTx || !hasOut) {
      a.status = 'Planned';
      a.actual_start = null;
      a.actual_end = null;
    }
  }
  ensureSeq(work);
  // ★ 全部成功：把工作副本的集合与 seq 原子搬回原对象（引用不变，调用方无感）
  for (const k of ['resources', 'rules', 'goals', 'plans', 'activities', 'txs', 'outputs', 'valueflows', 'goods', 'seq']) {
    db[k] = work[k];
  }
  return { addedRes, reusedRes, skippedDupRes, ...counts };
}

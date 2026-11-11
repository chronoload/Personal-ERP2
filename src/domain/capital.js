// ============================================================
// domain/capital.js —— 资本准入模型（纯函数，可单测）
//
// 回答一个问题：以当前「可用资源 + 劳动产能」，同时承诺这么多目标/计划，
// 是否撑得住？撑不住时冻结哪些、解冻哪些、是否锁新增。
//
// 设计约束：
//   · 不碰 status 状态机——冻结走独立轴 plan.budgetState = active|frozen。
//   · 只算与建议，不写库；写库统一走 sync()，由 App.render 前调用。
//   · 双阈值 + 迟滞：>1.6× 冻结到 ≤1.4×；≤1.2× 才解冻（加回后仍 ≤1.2×）。
// ============================================================

export const CAPITAL = {
  riskCoeff: 0.6,        // 可用资本的风险折扣（保守预算）
  warnRatio: 1.2,        // 超建议预算 20% → 提醒
  freezeRatio: 1.6,      // 超 60% → 冻结
  freezeTarget: 1.4,     // 冻结到 1.4× 以下，留缓冲避免抖动
  thawRatio: 1.2,        // ≤1.2× 才考虑解冻
  deadDays: 90,          // 超过 90 天无活动/流水 → 死账
  horizonMonths: 3,      // 默认规划周期
  workDaysPerMonth: 22,
  dailyDeepMin: 300,     // 与 attention.js 的 deep 日预算一致
  laborUtilization: 0.6, // 劳动产能只按 60% 可兑现
  laborLookbackDays: 90,
};

const DAY = 86400000;

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function balanceOf(db, rid) {
  const r = (db.resources || []).find((x) => x.id === rid);
  let bal = num(r && r.initial);
  for (const t of db.txs || []) {
    if (t.resource_id !== rid) continue;
    bal += num(t.debit) - num(t.credit);
  }
  return bal;
}

function primaryResource(db) {
  const list = db.resources || [];
  return list.find((r) => r.name === '价值元') || list.find((r) => r.unit === '元') || list[0] || null;
}

// 有向换算图：rule.from --rate--> rule.to（rate = 1 单位 from 换得多少 to）
function rateGraph(db) {
  const graph = new Map();
  for (const r of db.rules || []) {
    if (r.status && r.status !== 'Active') continue;
    const rate = num(r.rate);
    if (!(rate > 0) || !r.from || !r.to || r.from === r.to) continue;
    if (!graph.has(r.from)) graph.set(r.from, []);
    graph.get(r.from).push({ to: r.to, rate });
  }
  return graph;
}

// 从 from 到 to 的最大换算率（DFS 取最大乘积；seen 防环）
function rateBetween(graph, fromId, toId) {
  if (fromId === toId) return 1;
  let best = 0;
  const seen = new Set([fromId]);
  const dfs = (id, acc) => {
    if (acc <= best) return;
    for (const e of graph.get(id) || []) {
      if (seen.has(e.to)) continue;
      const next = acc * e.rate;
      if (e.to === toId) best = Math.max(best, next);
      else { seen.add(e.to); dfs(e.to, next); seen.delete(e.to); }
    }
  };
  dfs(fromId, 1);
  return best;
}

// 可用资本：所有启用资源换算到主计量单位后的余额和（允许负债为负）
export function liquidValue(db) {
  const primary = primaryResource(db);
  const graph = rateGraph(db);
  const unconvertible = [];
  if (!primary) return { value: 0, primary: null, unconvertible, balances: {} };
  let value = 0;
  const balances = {};
  for (const r of db.resources || []) {
    if (r.status && r.status !== 'Active') continue;
    const bal = balanceOf(db, r.id);
    balances[r.id] = bal;
    if (r.id === primary.id) { value += bal; continue; }
    const rate = rateBetween(graph, r.id, primary.id);
    if (rate > 0) value += bal * rate;
    else if (bal !== 0) unconvertible.push(r.name);
  }
  return { value, primary, unconvertible, balances };
}

function trackedMinutesOf(a, now) {
  if (!a || !Array.isArray(a.time_logs)) return 0;
  return a.time_logs.reduce((s, l) => {
    const end = l.end || now;
    return s + Math.max(0, Math.round((end - l.start) / 60000));
  }, 0);
}

// 劳动产能：过去 90 天「活动收入 / 已计时分钟」× 未来可投入分钟
export function laborValue(db, now = Date.now()) {
  const since = now - CAPITAL.laborLookbackDays * DAY;
  const actIds = new Set();
  let income = 0;
  for (const t of db.txs || []) {
    if (num(t.created) < since || num(t.debit) <= 0) continue;
    income += num(t.debit);
    if (t.source_type === 'activity' && t.source_id) actIds.add(t.source_id);
  }
  let tracked = 0;
  for (const a of db.activities || []) {
    if (actIds.has(a.id)) tracked += trackedMinutesOf(a, now);
  }
  const productivity = tracked > 0 ? income / tracked : 0;
  const availableMin = CAPITAL.horizonMonths * CAPITAL.workDaysPerMonth
    * CAPITAL.dailyDeepMin * CAPITAL.laborUtilization;
  return {
    value: availableMin * productivity,
    productivity,
    availableMin,
    income,
    tracked,
  };
}

function lastTouchOf(db, plan, now) {
  let last = num(plan.created);
  const acts = (db.activities || []).filter((a) => (a.plan_ids || []).includes(plan.id));
  const actIds = new Set(acts.map((a) => a.id));
  for (const a of acts) {
    last = Math.max(last, num(a.created), num(a.actual_end), num(a.planned_start ? Date.parse(a.planned_start) : 0));
  }
  for (const t of db.txs || []) {
    if (t.source_type === 'activity' && actIds.has(t.source_id)) last = Math.max(last, num(t.created));
  }
  return Math.min(last, now);
}

function planBudget(p) {
  return p.budget === null || p.budget === undefined ? null : Math.max(0, num(p.budget));
}

// 冻结顺序：先冻「低优先级 → 长周期 → 大预算」
function freezeOrder(a, b) {
  return (num(b.priority || 3) - num(a.priority || 3))
    || (num(b.horizonMonths || 3) - num(a.horizonMonths || 3))
    || (num(b.budget) - num(a.budget))
    || String(a.id).localeCompare(String(b.id));
}

// 解冻顺序：先放「高优先级 → 短周期 → 小预算」，即冻结顺序的逆序
function thawOrder(a, b) { return freezeOrder(b, a); }

/**
 * 分析当前资本状态（只读）。
 * @returns {{
 *   now, primary, liquid, labor, recommended, committed, ratio, level,
 *   unboundedPlans: Array, unconvertible: Array,
 *   frozenPlanIds: string[], deadPlanIds: string[], deadGoalIds: string[],
 *   goalFrozenIds: string[], addLocked: boolean,
 *   toFreezeIds: string[], toThawIds: string[], committedAfter: number
 * }}
 */
export function analyze(db, now = Date.now()) {
  const liquid = liquidValue(db);
  const labor = laborValue(db, now);

  // 劳动兑现上限：不超过可用资本的 2 倍，避免历史高单价把预算吹爆
  const laborContribution = Math.min(labor.value, Math.max(0, liquid.value) * 2);
  const recommended = Math.max(0, liquid.value * CAPITAL.riskCoeff + laborContribution);

  const livePlans = (db.plans || []).filter((p) => !['Archived', 'Completed'].includes(p.status));
  const frozen = livePlans.filter((p) => p.budgetState === 'frozen');
  const active = livePlans.filter((p) => p.budgetState !== 'frozen');
  const unboundedPlans = active.filter((p) => planBudget(p) === null).map((p) => p.title);

  const committed = active.reduce((s, p) => s + (planBudget(p) || 0), 0);
  const frozenCommitted = frozen.reduce((s, p) => s + (planBudget(p) || 0), 0);
  const totalCommitted = committed + frozenCommitted;
  const ratio = recommended > 0 ? committed / recommended : (committed > 0 ? Infinity : 0);
  const totalRatio = recommended > 0 ? totalCommitted / recommended : (totalCommitted > 0 ? Infinity : 0);
  const level = ratio > CAPITAL.freezeRatio ? 'freeze' : (ratio > CAPITAL.warnRatio ? 'warn' : 'ok');
  const portfolioLevel = totalRatio > CAPITAL.freezeRatio ? 'freeze'
    : (totalRatio > CAPITAL.warnRatio ? 'warn' : 'ok');

  // 死账：非归档/完成、未冻结，且 90 天无活动/流水
  const deadPlanIds = active
    .filter((p) => now - lastTouchOf(db, p, now) > CAPITAL.deadDays * DAY)
    .map((p) => p.id);
  const deadSet = new Set(deadPlanIds);
  const goalFrozenIds = [];
  const deadGoalIds = [];
  for (const g of db.goals || []) {
    if (g.status === 'Archived' || g.status === 'Completed') continue;
    const ps = livePlans.filter((p) => p.goal_id === g.id);
    if (!ps.length) continue;
    if (ps.every((p) => p.budgetState === 'frozen')) goalFrozenIds.push(g.id);
    if (ps.every((p) => deadSet.has(p.id))) deadGoalIds.push(g.id);
  }

  // 冻结：>1.6× 时按顺序冻到 ≤1.4×
  const toFreezeIds = [];
  if (recommended > 0 && ratio > CAPITAL.freezeRatio) {
    let projected = committed;
    for (const p of active.filter((x) => planBudget(x) !== null).sort(freezeOrder)) {
      if (projected / recommended <= CAPITAL.freezeTarget) break;
      projected -= planBudget(p) || 0;
      toFreezeIds.push(p.id);
    }
  }

  // 解冻：总组合回落到 1.2× 以内（含冻结项）才放回；否则冻结区就是长期 backlog
  const toThawIds = [];
  if (recommended > 0 && totalRatio <= CAPITAL.thawRatio) {
    toThawIds.push(...frozen.filter((p) => planBudget(p) !== null).sort(thawOrder).map((p) => p.id));
  }

  // 锁新增：按「总组合」（含冻结项）判断——冻结只是隐藏工作量，不消灭承诺。
  // 已锁则要总组合回到 1.2× 且死账清零才解锁（迟滞，避免冻结/解冻抖动）。
  const shouldLock = totalRatio > CAPITAL.freezeRatio || deadPlanIds.length > 0;
  const addLocked = db.capitalLock
    ? (totalRatio > CAPITAL.thawRatio || deadPlanIds.length > 0)
    : shouldLock;

  const frozenPlanIds = frozen.map((p) => p.id);
  const committedAfter = committed
    - toFreezeIds.reduce((s, id) => s + (planBudget(livePlans.find((p) => p.id === id)) || 0), 0)
    + toThawIds.reduce((s, id) => s + (planBudget(livePlans.find((p) => p.id === id)) || 0), 0);

  return {
    now,
    primary: liquid.primary,
    liquid: liquid.value,
    labor: laborContribution,
    laborRaw: labor.value,
    productivity: labor.productivity,
    recommended,
    committed,
    frozenCommitted,
    totalCommitted,
    ratio,
    totalRatio,
    level,
    portfolioLevel,
    unboundedPlans,
    unconvertible: liquid.unconvertible,
    frozenPlanIds,
    deadPlanIds,
    deadGoalIds,
    goalFrozenIds,
    addLocked,
    toFreezeIds,
    toThawIds,
    committedAfter,
  };
}

/**
 * 把模型结论落到库里（唯一写入口）：自动冻结/解冻 + 维护 capitalLock。
 * 幂等：无变化时返回 changed=false。
 */
export function sync(db, now = Date.now()) {
  const before = analyze(db, now);
  let changed = false;
  for (const id of before.toFreezeIds) {
    const p = (db.plans || []).find((x) => x.id === id);
    if (!p || p.budgetState === 'frozen') continue;
    p.budgetState = 'frozen';
    p.frozenAt = now;
    changed = true;
  }
  for (const id of before.toThawIds) {
    const p = (db.plans || []).find((x) => x.id === id);
    if (!p || p.budgetState !== 'frozen') continue;
    p.budgetState = 'active';
    p.frozenAt = null;
    changed = true;
  }
  const after = analyze(db, now);
  if (!!db.capitalLock !== after.addLocked) {
    db.capitalLock = after.addLocked;
    changed = true;
  }
  return { changed, analysis: after };
}

// 供看板：所有关联计划都被冻结 → 活动从看板隐藏
export function activityHiddenByFreeze(db, a) {
  const pids = (a && a.plan_ids) || [];
  if (!pids.length) return false;
  const plans = pids.map((pid) => (db.plans || []).find((p) => p.id === pid)).filter(Boolean);
  if (!plans.length) return false;
  return plans.every((p) => p.budgetState === 'frozen');
}

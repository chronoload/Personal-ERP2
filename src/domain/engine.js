// ============================================================
// domain/engine.js
// 领域引擎（应用服务层）：所有会改变系统的操作都必须经过这里。
// 职责：强制状态机合法流转 + 5 条全局不变量，失败返回 {ok:false,error}，
//       成功则原地修改 db 并返回 {ok:true}。UI 只调用本层函数。
// 这是「严格 ERP」与「普通 CRUD」的分水岭。
// ============================================================
import {
  ACTIVITY_TRANSITIONS, PLAN_TRANSITIONS, OUTPUT_TRANSITIONS, GOAL_TRANSITIONS,
  nextId, newActivity, newOutput, newPlan, newGoal, newResource, newRule, newGood,
  VF_EXPECT_MS, VF_RECHARGE, DIR_CONSUME,
} from './entities.js';

const ok = (extra) => ({ ok: true, ...(extra || {}) });
const fail = (error) => ({ ok: false, error });

// 金额守门（F1）：所有入账金额必须为有限正数——Infinity 经 Number('1e999') 绕过 `>0` 守卫
const validAmount = (n) => Number.isFinite(n) && n > 0;

// 预设收支清洗（多资源，同 Goods.costs）：[{resource_id, amount, note}] → 清洗后的数组
// 金额 0 / 空 / 缺省条目 → 丢弃；非法金额/资源 → 抛错交由调用方转 fail
function sanitizePresets(db, presets, label) {
  if (!presets) return [];
  const list = Array.isArray(presets) ? presets : [presets]; // 兼容单资源旧调用
  const out = [];
  for (const p of list) {
    if (!p) continue;
    const amount = Number(p.amount);
    if (!(amount > 0)) continue;
    if (!validAmount(amount)) throw new Error(`${label}金额无效`);
    if (!resourceOf(db, p.resource_id)) throw new Error(`${label}资源不存在`);
    out.push({ resource_id: p.resource_id, amount, note: String(p.note || '').trim() || '' });
  }
  return out;
}

// ---------- 只读核算（不变量1/4 的数值基础） ----------

// 资源余额 = initial + Σ(debit) − Σ(credit)
// 冲正流水本身是真实借贷分录，必须计入（原单 −50 + 冲正 +50 = 0，账实相符）
export function balanceOf(db, resourceId) {
  const r = db.resources.find((x) => x.id === resourceId);
  if (!r) return 0;
  let d = 0, c = 0;
  for (const t of db.txs) {
    if (t.resource_id !== resourceId) continue;
    d += t.debit; c += t.credit;
  }
  return r.initial + d - c;
}

export function resourceOf(db, id) {
  return db.resources.find((r) => r.id === id);
}

// 某计划下所有活动累计消耗（活动来源流水的 credit 之和，冲正抵减）
export function planCost(db, planId) {
  const actIds = new Set(db.activities.filter((a) => a.plan_ids.includes(planId)).map((a) => a.id));
  // 原单被冲正额：origTxId -> 该单累计被冲正的 credit（冲正为 debit）
  const revByOrig = new Map();
  for (const t of db.txs) {
    if (t.source_type === 'reversal') {
      revByOrig.set(t.source_id, (revByOrig.get(t.source_id) || 0) + t.debit);
    }
  }
  let sum = 0;
  for (const t of db.txs) {
    if (t.source_type !== 'activity' || !actIds.has(t.source_id)) continue;
    sum += t.credit - (revByOrig.get(t.id) || 0);
  }
  return Math.max(0, sum);
}

// 单个活动的消耗（活动来源流水 credit 之和，扣减冲正）
export function activityCost(db, activityId) {
  let rev = 0;
  const origIds = new Set(
    db.txs.filter((t) => t.source_type === 'activity' && t.source_id === activityId).map((t) => t.id)
  );
  for (const t of db.txs) {
    if (t.source_type === 'reversal' && origIds.has(t.source_id)) rev += t.debit;
  }
  let sum = 0;
  for (const t of db.txs) {
    if (t.source_type === 'activity' && t.source_id === activityId) sum += t.credit;
  }
  return Math.max(0, sum - rev);
}

// 按任务累计计时（番茄钟 time_logs 之和，运行中按当前时间计）
export function trackedMinutes(db, activityId) {
  const a = db.activities.find((x) => x.id === activityId);
  if (!a || !Array.isArray(a.time_logs)) return 0;
  return a.time_logs.reduce((s, l) => {
    const end = l.end || Date.now();
    return s + Math.max(0, Math.round((end - l.start) / 60000));
  }, 0);
}

// 不变量4：计划预算硬约束（budget 非空且已耗 ≥ 预算 → 冻结）
// F3：1e-9 容差——0.1+0.7 的浮点和是 0.799999…，裸比较会让恰好花满的计划漏判
export function isPlanBlocked(db, planId) {
  const p = db.plans.find((x) => x.id === planId);
  if (!p || p.budget === null) return false;
  return planCost(db, planId) >= p.budget - 1e-9;
}

export function anyPlanBlocked(db, planIds) {
  return planIds.some((pid) => isPlanBlocked(db, pid));
}

// 不变量2：活动必须已有流水 + 产出
export function activityHasTx(db, id) {
  return db.txs.some((t) => t.source_type === 'activity' && t.source_id === id && !t.reversal_of);
}
export function activityHasOutput(db, id) {
  return db.outputs.some((o) => o.activity_id === id);
}

// 决策 16BC：ValueFlow 超期状态由 expected 派生（不落库，定时任务由派生代替）
export function vfStatus(db, vf) {
  if (vf.status === 'Closed') return 'Closed';
  return vf.expected < Date.now() ? 'Overdue' : 'Pending';
}

// 通用状态机校验
function checkTransition(table, from, to) {
  const allowed = table[from];
  return !!allowed && allowed.includes(to);
}

// ---------- 资源 (Resource) ----------

export function createResource(db, { name, unit, initial, color }) {
  if (!name || !name.trim()) return fail('资源名称必填');
  if (!Number.isFinite(Number(initial))) return fail('初始余额必须是数字');
  const r = newResource({ name: name.trim(), unit: (unit || '').trim(), initial: Number(initial) || 0, color: color || null });
  r.id = nextId(db, 'r');
  db.resources.push(r);
  return ok();
}

export function setResourceStatus(db, id, status) {
  const r = resourceOf(db, id);
  if (!r) return fail('资源不存在');
  r.status = status;
  return ok();
}

// 编辑资源元信息（名称/单位/颜色）：余额不在此改（走 adjustResource 流水），id 与流水引用不受影响
export function updateResource(db, id, { name, unit, color }) {
  const r = resourceOf(db, id);
  if (!r) return fail('资源不存在');
  if (!name || !name.trim()) return fail('资源名称必填');
  r.name = name.trim();
  r.unit = (unit || '').trim();
  if (color !== undefined) r.color = color;
  return ok();
}

// 删除资源（初始化/维护）：连带清理其流水与兑换规则
export function deleteResource(db, id) {
  const r = resourceOf(db, id);
  if (!r) return fail('资源不存在');
  db.resources = db.resources.filter((x) => x.id !== id);
  db.txs = db.txs.filter((t) => t.resource_id !== id);
  db.rules = db.rules.filter((x) => x.from !== id && x.to !== id);
  return ok();
}

// 手动调整资源余额（点击资源卡「补充」）：生成一笔 manual 流水，不挂活动
export function adjustResource(db, resourceId, { direction, amount, note }) {
  const r = resourceOf(db, resourceId);
  if (!r) return fail('资源不存在');
  const amt = Number(amount);
  if (!(amt > 0)) return fail('金额必须 > 0');
  if (!validAmount(amt)) return fail('金额无效');
  db.txs.push({
    id: nextId(db, 't'), resource_id: resourceId,
    debit: direction === 'debit' ? amt : 0,
    credit: direction === 'credit' ? amt : 0,
    source_type: 'manual', source_id: 'manual',
    note: (note || '').trim() || (direction === 'debit' ? '手动补充' : '手动调整'),
    reversal_of: null, created: Date.now(),
  });
  return ok();
}

// ---------- 兑换规则 (ConversionRule) ----------

export function createRule(db, { label, from, to, rate }) {
  if (!label || !label.trim()) return fail('规则标签必填');
  if (from === to) return fail('不能同资源兑换');
  if (!(Number(rate) > 0)) return fail('兑换比例必须 > 0');
  const rule = newRule({ label: label.trim(), from, to, rate: Number(rate) });
  rule.id = nextId(db, 'ru');
  db.rules.push(rule);
  return ok();
}

export function setRuleStatus(db, id, status) {
  const r = db.rules.find((x) => x.id === id);
  if (!r) return fail('规则不存在');
  r.status = status;
  return ok();
}

// 执行兑换（决策 B：单向换算）。生成两条流水，保证两资源各自 余额=Σ流水。
// 允许借贷：from 余额不足也放行，from 可扣为负。
export function convert(db, ruleId, amount) {
  const rule = db.rules.find((r) => r.id === ruleId);
  if (!rule || rule.status !== 'Active') return fail('规则不存在或已停用');
  const amt = Number(amount);
  if (!(amt > 0)) return fail('兑换数量必须 > 0');
  if (!validAmount(amt)) return fail('金额无效');
  const gain = amt * rule.rate;
  db.txs.push({
    id: nextId(db, 't'), resource_id: rule.from, debit: 0, credit: amt,
    source_type: 'conversion', source_id: rule.id, note: `${rule.label} → 兑换为${resourceOf(db, rule.to).name}`,
    reversal_of: null, created: Date.now(),
  });
  db.txs.push({
    id: nextId(db, 't'), resource_id: rule.to, debit: gain, credit: 0,
    source_type: 'conversion', source_id: rule.id, note: `${rule.label} ← 来自${resourceOf(db, rule.from).name}`,
    reversal_of: null, created: Date.now(),
  });
  return ok();
}

// ---------- 商品 (Good) ----------

// 读取商品成本（兼容旧单资源格式 {resource_id, price}）
export function goodCosts(g) {
  if (Array.isArray(g?.costs) && g.costs.length) return g.costs;
  if (g?.resource_id && Number(g?.price) > 0) return [{ resource_id: g.resource_id, amount: Number(g.price) }];
  return [];
}

function normalizeCosts(db, costs) {
  const out = [];
  for (const c of costs || []) {
    const amount = Number(c.amount);
    if (!(amount > 0)) continue;
    if (!resourceOf(db, c.resource_id)) return fail('消耗资源不存在');
    out.push({ resource_id: c.resource_id, amount });
  }
  if (!out.length) return fail('至少配置一种资源消耗');
  return { ok: true, out };
}

export function createGood(db, { name, emoji, costs, note }) {
  if (!name || !name.trim()) return fail('商品名称必填');
  const nc = normalizeCosts(db, costs);
  if (!nc.ok) return nc;
  const g = newGood({
    name: name.trim(), emoji: (emoji || '').trim() || '🛍️',
    costs: nc.out, note: (note || '').trim(),
  });
  g.id = nextId(db, 'gd');
  db.goods.push(g);
  return ok();
}

export function updateGood(db, id, { name, emoji, costs, note }) {
  const g = db.goods.find((x) => x.id === id);
  if (!g) return fail('商品不存在');
  if (!name || !name.trim()) return fail('商品名称必填');
  const nc = normalizeCosts(db, costs);
  if (!nc.ok) return nc;
  g.name = name.trim(); g.emoji = (emoji || '').trim() || '🛍️';
  g.costs = nc.out; g.note = (note || '').trim();
  delete g.resource_id; delete g.price; // 清理旧格式字段
  return ok();
}

export function setGoodStatus(db, id, status) {
  const g = db.goods.find((x) => x.id === id);
  if (!g) return fail('商品不存在');
  g.status = status;
  return ok();
}

export function deleteGood(db, id) {
  const g = db.goods.find((x) => x.id === id);
  if (!g) return fail('商品不存在');
  db.goods = db.goods.filter((x) => x.id !== id);
  return ok();
}

// 快速消费（LifeUp 式）：按商品的多资源成本逐一生成 credit 流水，不挂活动。
// 允许借贷：余额不足照样扣减，余额可为负。
export function consumeGood(db, id, { qty = 1, note = '' } = {}) {
  const g = db.goods.find((x) => x.id === id);
  if (!g) return fail('商品不存在');
  if (g.status !== 'Active') return fail('商品已停用');
  const n = Number(qty);
  if (!(n > 0)) return fail('数量必须 > 0');
  if (!validAmount(n)) return fail('金额无效');
  const costs = goodCosts(g);
  if (!costs.length) return fail('商品未配置资源消耗');
  // F4：原子预检——导入通道可绕过 normalizeCosts 注入坏成本（负数/NaN/幽灵资源），
  // 必须在推入任何流水前整批复验，杜绝「半消费」脏状态
  for (const c of costs) {
    if (!resourceOf(db, c.resource_id)) return fail(`商品成本无效：资源 ${c.resource_id} 不存在`);
    if (!validAmount(Number(c.amount) * n)) return fail(`商品成本无效：「${g.name}」资源 ${c.resource_id} 的成本非法`);
  }
  for (const c of costs) {
    db.txs.push({
      id: nextId(db, 't'), resource_id: c.resource_id,
      debit: 0, credit: c.amount * n,
      source_type: 'goods', source_id: g.id,
      note: `购买「${g.name}」×${n}${note ? ' · ' + note : ''}`,
      reversal_of: null, created: Date.now(),
    });
  }
  return ok();
}

// ---------- 目标 (Goal) ----------

export function createGoal(db, { title, desc, _id }) {
  if (!title || !title.trim()) return fail('目标名称必填');
  const g = newGoal({ title: title.trim(), desc: (desc || '').trim() });
  g.id = _id || nextId(db, 'g'); // _id：mdapply 用 hash 稳定 id（可幂等回写）
  db.goals.push(g);
  return ok();
}

export function updateGoal(db, id, { title, desc }) {
  const g = db.goals.find((x) => x.id === id);
  if (!g) return fail('目标不存在');
  if (!title || !title.trim()) return fail('目标名称必填');
  g.title = title.trim(); g.desc = (desc || '').trim();
  return ok();
}

export function deleteGoal(db, id) {
  const cnt = db.plans.filter((p) => p.goal_id === id).length;
  if (cnt) return fail(`该目标下有 ${cnt} 个计划，需先移除计划`);
  db.goals = db.goals.filter((x) => x.id !== id);
  return ok();
}

// 级联删除一个活动：活动 + 其产出 + 产出衍生的价值流 + 相关流水与冲正
function removeActivityDeep(db, activityId) {
  cleanConflictsFor(db, activityId); // B4：级联删除先解除全部捆绑，幸存者不留孤儿 id
  const outIds = new Set(db.outputs.filter((o) => o.activity_id === activityId).map((o) => o.id));
  const vfIds = new Set(db.valueflows.filter((v) => outIds.has(v.output_id)).map((v) => v.id));
  const txIds = new Set(db.txs.filter((t) => t.source_type === 'activity' && t.source_id === activityId).map((t) => t.id));
  db.activities = db.activities.filter((a) => a.id !== activityId);
  db.outputs = db.outputs.filter((o) => o.activity_id !== activityId);
  db.valueflows = db.valueflows.filter((v) => !vfIds.has(v.id));
  db.txs = db.txs.filter((t) => {
    if (t.source_type === 'activity' && t.source_id === activityId) return false;
    if (t.source_type === 'reversal' && txIds.has(t.source_id)) return false;
    if (t.source_type === 'valueflow' && vfIds.has(t.source_id)) return false;
    return true;
  });
}

// 级联删除一个计划：
//   - 仅关联该计划的活动 → 整链删除（含产出/价值流/流水）
//   - 同时关联多个计划的活动 → 仅解除与该计划的关联（保留活动）
export function deletePlanCascade(db, planId) {
  const plan = db.plans.find((x) => x.id === planId);
  if (!plan) return fail('计划不存在');
  const linked = db.activities.filter((a) => a.plan_ids.includes(planId));
  for (const a of linked) {
    if (a.plan_ids.length <= 1) removeActivityDeep(db, a.id);
    else a.plan_ids = a.plan_ids.filter((pid) => pid !== planId);
  }
  db.plans = db.plans.filter((x) => x.id !== planId);
  return ok();
}

// 级联删除一个目标：先级联删除其下所有计划，再删目标
export function deleteGoalCascade(db, goalId) {
  const goal = db.goals.find((x) => x.id === goalId);
  if (!goal) return fail('目标不存在');
  const plans = db.plans.filter((p) => p.goal_id === goalId);
  for (const p of plans) deletePlanCascade(db, p.id);
  db.goals = db.goals.filter((x) => x.id !== goalId);
  return ok();
}

// 删除影响统计（供确认提示）：{ acts 级联删, unlink 解除关联, outs, vfs }
export function planDeleteImpact(db, planId) {
  const linked = db.activities.filter((a) => a.plan_ids.includes(planId));
  const solo = linked.filter((a) => a.plan_ids.length <= 1);
  const soloIds = new Set(solo.map((a) => a.id));
  const outs = db.outputs.filter((o) => soloIds.has(o.activity_id));
  const outIds = new Set(outs.map((o) => o.id));
  return {
    acts: solo.length,
    unlink: linked.length - solo.length,
    outs: outs.length,
    vfs: db.valueflows.filter((v) => outIds.has(v.output_id)).length,
  };
}

export function goalDeleteImpact(db, goalId) {
  const plans = db.plans.filter((p) => p.goal_id === goalId);
  const acc = { plans: plans.length, acts: 0, unlink: 0, outs: 0, vfs: 0 };
  for (const p of plans) {
    const im = planDeleteImpact(db, p.id);
    acc.acts += im.acts; acc.unlink += im.unlink; acc.outs += im.outs; acc.vfs += im.vfs;
  }
  return acc;
}

// 计划配色（按计划染色任务卡片 / 计划卡片）
export const PLAN_COLORS = ['#4a7fbf', '#3da06a', '#d97706', '#7c3aed', '#dc2626', '#0e7490', '#be185d', '#4d7c0f'];

// ---------- 计划 (Plan) ----------

export function createPlan(db, { goal_id, title, budget, color, default_expenses, default_incomes, _id }) {
  if (!title || !title.trim()) return fail('计划名称必填');
  if (!db.goals.some((g) => g.id === goal_id)) return fail('所属目标不存在');
  if (budget !== null && !(Number(budget) >= 0)) return fail('预算必须 ≥ 0');
  let de, di;
  try {
    de = sanitizePresets(db, default_expenses, '默认支出');
    di = sanitizePresets(db, default_incomes, '默认收入');
  } catch (e) { return fail(e.message); }
  const p = newPlan({
    goal_id, title: title.trim(), budget: budget === null ? null : Number(budget),
    color: color || PLAN_COLORS[db.plans.length % PLAN_COLORS.length],
  });
  p.default_expenses = de; p.default_incomes = di;
  p.id = _id || nextId(db, 'p'); // _id：mdapply 用 hash 稳定 id（可幂等回写）
  db.plans.push(p);
  return ok();
}

export function updatePlan(db, id, { title, budget, color, default_expenses, default_incomes }) {
  const p = db.plans.find((x) => x.id === id);
  if (!p) return fail('计划不存在');
  if (!title || !title.trim()) return fail('计划名称必填');
  if (budget !== null && !(Number(budget) >= 0)) return fail('预算必须 ≥ 0');
  let de, di;
  try {
    if (default_expenses !== undefined) de = sanitizePresets(db, default_expenses, '默认支出');
    if (default_incomes !== undefined) di = sanitizePresets(db, default_incomes, '默认收入');
  } catch (e) { return fail(e.message); }
  p.title = title.trim(); p.budget = budget === null ? null : Number(budget);
  if (color !== undefined) p.color = color || null;
  if (default_expenses !== undefined) p.default_expenses = de;
  if (default_incomes !== undefined) p.default_incomes = di;
  return ok();
}

export function deletePlan(db, id) {
  const cnt = db.activities.filter((a) => a.plan_ids.includes(id)).length;
  if (cnt) return fail(`该计划下有 ${cnt} 个活动，需先移除活动`);
  db.plans = db.plans.filter((x) => x.id !== id);
  return ok();
}

export function setPlanStatus(db, id, next) {
  const p = db.plans.find((x) => x.id === id);
  if (!p) return fail('计划不存在');
  if (!checkTransition(PLAN_TRANSITIONS, p.status, next)) return fail(`非法流转：${p.status} → ${next}`);
  p.status = next;
  return ok();
}

// 目标状态机（三级归档统一降级语义）：Active → Completed → Archived
export function setGoalStatus(db, id, next) {
  const g = db.goals.find((x) => x.id === id);
  if (!g) return fail('目标不存在');
  if (!checkTransition(GOAL_TRANSITIONS, g.status || 'Active', next)) return fail(`非法流转：${g.status} → ${next}`);
  g.status = next;
  return ok();
}

// ---------- 活动 (Activity) ----------

// 循环：计算下一次执行日（返回 YYYY-M-D）。repeat: daily|weekday|weekly|monthly
export function nextOccurrenceDate(dateStr, repeat) {
  const d = parseDate(dateStr || todayKey());
  if (repeat === 'daily') d.setDate(d.getDate() + 1);
  else if (repeat === 'weekday') { do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); }
  else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
  else if (repeat === 'monthly') {
    // F-S3：月末钳制——先落目标月再设日号，超出手则钳到该月最后一日
    //（逐次钳制会让日号漂移，如 Jan31→Feb28→Mar28，属已文档化的可接受行为）
    const dom = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    d.setDate(Math.min(dom, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  }
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
// 解析 YYYY-M-D / YYYY-MM-DD（非 ISO，避免 new Date(string) 的补零限制）
function parseDate(str) {
  const [y, m, d] = String(str).split('-').map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
// 日期字符串比较（兼容 YYYY-M-D / YYYY-MM-DD）
function dateKey(s) {
  return String(s).split('-').map((n) => String(Number(n)).padStart(2, '0')).join('-');
}

// 由计划开始时间（YYYY-MM-DDTHH:MM，精确到分钟）推导计划日期（非补零 YYYY-M-D）
function datePartFromDatetime(v) {
  if (!v) return null;
  const m = String(v).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? `${Number(m[1])}-${Number(m[2])}-${Number(m[3])}` : null;
}
function timePartFromDatetime(v) {
  const m = String(v).match(/T(\d{1,2}):(\d{1,2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

// B7：计划开始时间入口校验——补零/非补零均可，但各部分必须语义真实。
// Date 构造会静默进位（hour25→次日01、Feb30→Mar02、分70→时进位），用往返比对拦截；
// 分钟个位（'T9:5'）直接被格式拒绝（B8 同源）。
function validPlannedStart(v) {
  const m = String(v).match(/^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{2})$/);
  if (!m) return false;
  const [y, mo, d, h, mi] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
  const dt = new Date(y, mo - 1, d, h, mi);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d
    && dt.getHours() === h && dt.getMinutes() === mi;
}

// ---------- 活动时间原子性 ----------
// 规则：有开始时间且时长>0 的活动占固定时段，一律禁止重叠；
// 弹性活动（无开始时间或零时长）不参与冲突。显式保留的重叠互记 conflicts 捆绑，
// 执行（startActivity）时仲裁：先做这个 / 让对手先。
const OCCUPY_STATUSES = ['Planned', 'Started']; // 未完成的占时间线；已完成属历史事实不拦路

function parseDt(v) { // 'YYYY-MM-DDTHH:MM' → 本地毫秒时间戳
  const m = String(v || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
}
function fmtDt(ms) { // 时间戳 → 'YYYY-MM-DDTHH:MM'
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 活动固定时间窗；null = 弹性（不占时段）
export function activityWindow(a) {
  const s = parseDt(a && a.planned_start);
  const mins = Number(a && a.planned_minutes) || 0;
  if (!s || mins <= 0) return null;
  return { start: s, end: s + mins * 60000 };
}

function occupies(a) { return OCCUPY_STATUSES.includes(a.status) && !!activityWindow(a); }

function windowsOverlap(w1, w2) { return w1.start < w2.end && w2.start < w1.end; }

// 与 [startMs,endMs] 相交的占用中活动（可排除自身）
export function findConflicts(db, { startMs, endMs, excludeId = null }) {
  return db.activities.filter((x) => {
    if (x.id === excludeId || !occupies(x)) return false;
    const w = activityWindow(x);
    return w.start < endMs && startMs < w.end;
  });
}

// 从期望时刻起找最近空闲槽：当天扫间隙放不下 → 次日同一钟点重试（上限30天）。
// B1 重写接受规则为重叠制：[t,t+dur) 与任何占用窗不重叠即可——
//   · 期望起点自身无重叠 → 直接采用（允许跨午夜时长，不再被日末硬切拒绝）；
//   · 撞块顺延后日内放得下、或被跨午夜块推出当日（重叠已清空）→ 采用；
//   · 仅「日内被堵且跨午夜放不下」才跳到次日同一钟点。
function findFreeSlot(db, desiredMs, minutes, excludeId) {
  const dur = Math.max(1, minutes) * 60000;
  const scanDay = (cur) => {
    const dayEnd = new Date(cur); dayEnd.setHours(24, 0, 0, 0);
    return {
      de: dayEnd.getTime(),
      wins: db.activities
        .filter((x) => x.id !== excludeId && occupies(x))
        .map((x) => activityWindow(x))
        .filter((w) => w.start < dayEnd.getTime() && w.end > cur)
        .sort((p, q) => p.start - q.start),
    };
  };
  let cur = desiredMs;
  for (let i = 0; i < 30; i++) {
    const { de, wins } = scanDay(cur);
    if (!wins.some((w) => cur < w.end && w.start < cur + dur)) return cur; // 期望点即空闲
    let t = cur;
    for (const w of wins) {
      if (t >= w.end) continue;          // 块已在身后
      if (t + dur <= w.start) break;     // 当前起点可用
      t = w.end;                         // 撞块 → 移到块尾再看后续块
    }
    if (t + dur <= de || t > de) return t; // 日内放下；或被跨午夜块推过午夜
    const d = new Date(cur); d.setDate(d.getDate() + 1); // 次日同一钟点
    cur = d.getTime();
  }
  // B2 兜底：30 天仍全满时落在最终扫描日最后一个占用窗的窗尾之后，保证不与占块重叠
  const { wins } = scanDay(cur);
  return Math.max(cur, wins.length ? wins[wins.length - 1].end : cur);
}

function linkConflict(a, b) { // 双向捆绑（去重）
  a.conflicts = Array.from(new Set([...(a.conflicts || []), b.id]));
  b.conflicts = Array.from(new Set([...(b.conflicts || []), a.id]));
}
function unlinkConflict(a, b) {
  a.conflicts = (a.conflicts || []).filter((z) => z !== b.id);
  b.conflicts = (b.conflicts || []).filter((z) => z !== a.id);
}
function cleanConflictsFor(db, id) { // 清除某活动的全部捆绑（双向）
  const a = db.activities.find((x) => x.id === id);
  if (!a) return;
  for (const oid of a.conflicts || []) {
    const o = db.activities.find((x) => x.id === oid);
    if (o) o.conflicts = (o.conflicts || []).filter((z) => z !== id);
  }
  a.conflicts = [];
}

// B5：剪除陈旧捆绑——对手已消失 / 不再占用时间线（非 Planned）或窗口不再重叠 → 双向解除
function pruneStaleConflicts(db, x) {
  if (!x) return;
  const wx = activityWindow(x);
  x.conflicts = (x.conflicts || []).filter((cid) => {
    const o = db.activities.find((y) => y.id === cid);
    const wo = o ? activityWindow(o) : null;
    const alive = !!o && o.status === 'Planned' && !!wx && !!wo && windowsOverlap(wx, wo);
    if (!alive && o) o.conflicts = (o.conflicts || []).filter((z) => z !== x.id);
    return alive;
  });
}

// 原子性落地：推算 planned_end → 冲突检测 → 自动顺延（默认）或按 keep_conflict 捆绑。
// 返回 { shifted } | { bundled } | {}（UI 据此提示）
function applyAtomicity(db, a, { keepConflict = false } = {}) {
  cleanConflictsFor(db, a.id);
  const w = activityWindow(a);
  if (!w) { a.planned_end = null; return {}; }
  a.planned_end = fmtDt(w.end);
  const hits = findConflicts(db, { startMs: w.start, endMs: w.end, excludeId: a.id });
  if (hits.length && keepConflict) {
    for (const h of hits) linkConflict(a, h);
    return { bundled: true };
  }
  if (hits.length) { // 智能顺延：挪到最近空闲槽
    const slot = findFreeSlot(db, w.start, a.planned_minutes, a.id);
    a.planned_start = fmtDt(slot);
    a.planned_date = datePartFromDatetime(a.planned_start);
    a.planned_end = fmtDt(slot + a.planned_minutes * 60000);
    return { shifted: true, to: a.planned_start };
  }
  return {};
}

export function createActivity(db, { title, note, plan_ids, planned_date = null, planned_start = null, planned_minutes = 0, repeat = null, repeat_until = null, theme = null, keep_conflict = false, preset_expenses, preset_incomes, _id }) {
  if (!title || !title.trim()) return fail('活动名称必填');
  if (planned_start != null && planned_start !== '' && !validPlannedStart(planned_start)) {
    return fail(`计划时间无效：${planned_start}（需 YYYY-MM-DDTHH:MM 且各部分真实存在）`);
  }
  const ids = plan_ids || [];
  for (const pid of ids) if (!db.plans.some((p) => p.id === pid)) return fail('关联计划不存在');
  let pe, pi;
  try {
    pe = sanitizePresets(db, preset_expenses, '预设支出');
    pi = sanitizePresets(db, preset_incomes, '预设收入');
  } catch (e) { return fail(e.message); }
  const a = newActivity({
    title: title.trim(), note: (note || '').trim(), plan_ids: ids,
    planned_date: planned_start ? datePartFromDatetime(planned_start) : (planned_date || null),
    planned_start: planned_start || null,
    planned_minutes: Number(planned_minutes) || 0,
    repeat, repeat_until: repeat_until || null, theme: theme || null,
  });
  a.preset_expenses = pe; a.preset_incomes = pi;
  a.id = _id || nextId(db, 'a'); // _id：mdapply 用 hash 稳定 id（可幂等回写）
  db.activities.push(a);
  const atom = applyAtomicity(db, a, { keepConflict: !!keep_conflict }); // 入库后跑原子性（排除自身）
  // 循环（系列容器）：一条活动存全部期次，不生成 N 份副本
  let spawned = 0;
  if (a.repeat) {
    a.occurrences = buildOccurrenceDates(a).map((d) => ({ date: d, status: 'pending' }));
    if (a.occurrences.length) a.planned_date = a.occurrences[0].date;
    spawned = (a.occurrences.length || 1) - 1;
  }
  return ok({ ...atom, spawned });
}

export function updateActivity(db, id, { title, note, plan_ids, planned_date, planned_start, planned_minutes, repeat, repeat_until, theme, keep_conflict, preset_expenses, preset_incomes }) {
  const a = db.activities.find((x) => x.id === id);
  if (!a) return fail('活动不存在');
  if (!title || !title.trim()) return fail('活动名称必填');
  // B7/B8：仅当字段被显式提供且非空时校验；缺省不动原值，'' / null 表示清空仍合法
  if (planned_start !== undefined && planned_start !== null && planned_start !== ''
    && !validPlannedStart(planned_start)) {
    return fail(`计划时间无效：${planned_start}（需 YYYY-MM-DDTHH:MM 且各部分真实存在）`);
  }
  if (preset_expenses !== undefined || preset_incomes !== undefined) {
    try {
      if (preset_expenses !== undefined) a.preset_expenses = sanitizePresets(db, preset_expenses, '预设支出');
      if (preset_incomes !== undefined) a.preset_incomes = sanitizePresets(db, preset_incomes, '预设收入');
    } catch (e) { return fail(e.message); }
  }
  a.title = title.trim(); a.note = (note || '').trim();
  let atom = {};
  if (plan_ids) {
    for (const pid of plan_ids) if (!db.plans.some((p) => p.id === pid)) return fail('关联计划不存在');
    a.plan_ids = plan_ids;
  }
  if (planned_start !== undefined) {
    a.planned_start = planned_start || null;
    a.planned_date = planned_start ? datePartFromDatetime(planned_start) : fallbackSeriesDate(a);
  } else if (planned_date !== undefined) {
    // 显式清空计划日期：循环系列回落首个 pending 期次，避免「无当前期」悬空
    a.planned_date = planned_date || fallbackSeriesDate(a);
  }
  if (planned_minutes !== undefined) a.planned_minutes = Number(planned_minutes) || 0;
  // 时间窗被触碰 → 重跑原子性（顺延或按 keep_conflict 捆绑；挪走则自动解除旧捆绑）
  if (planned_start !== undefined || planned_minutes !== undefined) {
    atom = applyAtomicity(db, a, { keepConflict: !!keep_conflict });
  }
  if (repeat !== undefined) {
    a.repeat = repeat || null;
    a.repeat_until = repeat_until !== undefined ? (repeat_until || null) : a.repeat_until;
    // 循环不再由状态机衍生：把活动设为循环后，用「⋯ → 续生成后续期次」按需生成，
    // 每期独立管理（旧「完成后补设循环自动衍生」已移除）。
  }
  if (repeat_until !== undefined) a.repeat_until = repeat_until || null;
  if (theme !== undefined) a.theme = theme || null;
  return ok(atom);
}

export function deleteActivity(db, id) {
  const a = db.activities.find((x) => x.id === id);
  if (!a) return fail('活动不存在');
  if (a.status !== 'Planned') return fail('仅 Planned 状态可删除');
  cleanConflictsFor(db, id); // B3：删除前解除全部捆绑，幸存者不留孤儿 id
  db.activities = db.activities.filter((x) => x.id !== id);
  db.txs = db.txs.filter((t) => !(t.source_type === 'activity' && t.source_id === id));
  db.outputs = db.outputs.filter((o) => o.activity_id !== id);
  return ok();
}

// 活动级联删除影响（供确认提示）
export function activityDeleteImpact(db, id) {
  const outIds = new Set(db.outputs.filter((o) => o.activity_id === id).map((o) => o.id));
  return {
    outs: outIds.size,
    vfs: db.valueflows.filter((v) => outIds.has(v.output_id)).length,
    txs: db.txs.filter((t) => (t.source_type === 'activity' && t.source_id === id)
      || (t.source_type === 'reversal' && db.txs.some((x) => x.source_type === 'activity' && x.source_id === id && x.id === t.source_id))
      || (t.source_type === 'valueflow' && outIds.has(t.source_id))).length,
  };
}

// 级联删除活动（任意状态）：活动 + 产出 + 价值流 + 相关流水/冲正
export function deleteActivityCascade(db, id) {
  const a = db.activities.find((x) => x.id === id);
  if (!a) return fail('活动不存在');
  removeActivityDeep(db, id);
  return ok();
}

// Planned → Started（不变量4：预算耗尽则禁止）。
// 原子性仲裁：存在排队中的捆绑对手（Planned 且窗口仍重叠）时，不直接启动，
// 返回结构化 conflict_choice 供 UI 弹三选一：先做这个 / 让对手先 / 取消。
export function startActivity(db, id, { override = null } = {}) {
  const a = db.activities.find((x) => x.id === id);
  if (!a) return fail('活动不存在');
  if (!checkTransition(ACTIVITY_TRANSITIONS, a.status, 'Started')) return fail(`仅 ${a.status} 可开始`);
  if (anyPlanBlocked(db, a.plan_ids)) return fail('⛔ 关联计划预算已耗尽，禁止开始');
  const rivals = (a.conflicts || [])
    .map((cid) => db.activities.find((x) => x.id === cid))
    .filter((x) => x && x.status === 'Planned'
      && windowsOverlap(activityWindow(a), activityWindow(x)));
  if (!override && rivals.length) {
    return ok({ conflict_choice: {
      self: { id: a.id, title: a.title },
      others: rivals.map((x) => ({ id: x.id, title: x.title })),
    } });
  }
  if (override === 'first') { // 先做这个：对手顺延到本活动结束后的最近空闲槽
    const myWin = activityWindow(a);
    for (const rv of rivals) {
      const rvMins = rv.planned_minutes || 30;
      const from = Math.max(parseDt(rv.planned_start), myWin ? myWin.end : Date.now());
      const slot = findFreeSlot(db, from, rvMins, a.id);
      rv.planned_start = fmtDt(slot);
      rv.planned_date = datePartFromDatetime(rv.planned_start);
      rv.planned_end = fmtDt(slot + rvMins * 60000);
      unlinkConflict(a, rv);
      pruneStaleConflicts(db, rv); // B5：对手挪走后其第三方捆绑可能已陈旧
    }
  }
  if (override === 'defer') { // 让对手先：自己顺延到对手之后的最近空闲槽，仍为 Planned
    const myWin = activityWindow(a);
    const rivalEnds = rivals.map((x) => { const w = activityWindow(x); return w ? w.end : Date.now(); });
    const mins = a.planned_minutes || 30;
    const from = Math.max(myWin ? myWin.start : Date.now(), ...(rivalEnds.length ? rivalEnds : [Date.now()]));
    const slot = findFreeSlot(db, from, mins, a.id);
    a.planned_start = fmtDt(slot);
    a.planned_date = datePartFromDatetime(a.planned_start);
    a.planned_end = fmtDt(slot + mins * 60000);
    for (const rv of rivals) unlinkConflict(a, rv);
    pruneStaleConflicts(db, a); // B5：自身挪走后同理清理陈旧捆绑
    return ok({ moved_to: a.planned_start });
  }
  a.actual_start = Date.now();
  a.status = 'Started';
  pruneStaleConflicts(db, a); // B5：开始时同样剪除已陈旧的捆绑
  return ok();
}

// Started → Completed（不变量2 + 不变量4）。
// 原子创建「支出(credit) + 收入(debit)」多笔流水（至少一笔）+ 产出。
// expenses/incomes: [{ resource_id, amount, note }]（多资源，同 Goods.costs）；
// 兼容单资源旧调用 expense/income: { resource_id, amount, note } | null
export function completeActivity(db, id, { expense = null, income = null, expenses, incomes, output_title, output_tags }) {
  const a = db.activities.find((x) => x.id === id);
  if (!a) return fail('活动不存在');
  if (a.status !== 'Started') return fail('仅 Started 可完成');
  if (anyPlanBlocked(db, a.plan_ids)) return fail('⛔ 关联计划预算已耗尽，禁止完成');
  const exList = expenses !== undefined ? expenses : (expense ? [expense] : []);
  const inList = incomes !== undefined ? incomes : (income ? [income] : []);
  // F1：Infinity 经 `>0` 守卫漏入，先于收支判定拦截
  for (const e of exList) if (e && !validAmount(Number(e.amount))) return fail('金额无效');
  for (const i of inList) if (i && !validAmount(Number(i.amount))) return fail('金额无效');
  const validExpenses = exList.filter((e) => e && Number(e.amount) > 0);
  const validIncomes = inList.filter((i) => i && Number(i.amount) > 0);
  if (!validExpenses.length && !validIncomes.length) return fail('必须至少登记一笔收支流水');
  if (!output_title || !output_title.trim()) return fail('产出标题必填');
  for (const e of validExpenses) if (!resourceOf(db, e.resource_id)) return fail('支出资源不存在');
  for (const i of validIncomes) if (!resourceOf(db, i.resource_id)) return fail('收入资源不存在');
  for (const e of validExpenses) {
    db.txs.push({
      id: nextId(db, 't'), resource_id: e.resource_id, debit: 0,
      credit: Number(e.amount),
      source_type: 'activity', source_id: id, note: (e.note || '').trim() || '支出',
      reversal_of: null, created: Date.now(),
    });
  }
  for (const i of validIncomes) {
    db.txs.push({
      id: nextId(db, 't'), resource_id: i.resource_id, debit: Number(i.amount),
      credit: 0,
      source_type: 'activity', source_id: id, note: (i.note || '').trim() || '收入',
      reversal_of: null, created: Date.now(),
    });
  }
  const out = newOutput({ title: output_title.trim(), tags: output_tags || [], note: '' });
  out.id = nextId(db, 'o'); out.activity_id = id;
  db.outputs.push(out);
  a.actual_end = Date.now();
  a.status = 'Completed';
  cleanConflictsFor(db, a.id); // B6：完成即离开时间线，全部捆绑解除（UI ⚠ 不再永挂）
  // 循环（系列容器）：标记本期 done，推进到下一 pending 期次（planned_date 原地滚动）
  if (a.repeat && Array.isArray(a.occurrences) && a.occurrences.length) {
    const occ = currentOccurrence(a, dateKey(new Date(a.actual_start)));
    if (occ && occ.status !== 'done') { occ.status = 'done'; occ.completedAt = Date.now(); }
    const advanced = advanceRecurrence(db, a);
    return ok({ advanced, done: seriesProgress(db, a) });
  }
  return ok();
}

// 快速完成（通用计时通道专用）：与 completeActivity 相同的入账契约，
// 产出标签固定标记来源，消除 UI 直写 db 的唯一旁路
export function quickComplete(db, activityId, { expense, income, outputTitle } = {}) {
  return completeActivity(db, activityId, {
    expense: expense || null,
    income: income || null,
    output_title: outputTitle || '快速计时',
    output_tags: ['快速计时'],
  });
}

// 一键完成（活动预设收支，多资源）：创建时预设了收支 → 直接按预设入账，产出标题=活动名。
// 无任何有效预设时拒绝（不变量2 要求至少一笔流水），返回摘要供 UI 轻确认。
export function quickCompletePreset(db, id) {
  const a = db.activities.find((x) => x.id === id);
  if (!a) return fail('活动不存在');
  const expenses = (a.preset_expenses || []).filter((e) => e && Number(e.amount) > 0);
  const incomes = (a.preset_incomes || []).filter((i) => i && Number(i.amount) > 0);
  if (!expenses.length && !incomes.length) return fail('该活动未预设收支，请打开完成表单');
  const r = completeActivity(db, id, {
    expenses, incomes,
    output_title: a.title,
    output_tags: ['预设'],
  });
  if (!r.ok) return r;
  return ok({
    summary: {
      expenses: expenses.map((e) => ({ ...e })),
      incomes: incomes.map((i) => ({ ...i })),
      output_title: a.title,
    },
  });
}

// 改账（已完成活动的收支修正，决策 6B 冲正语义，不变量5）：
// 反转该活动全部 activity-source 原单流水（追加冲正分录），再按新值重记；产出与状态不动。
// 仅允许修正收支，不可改产出/状态（避免引入新的状态机旁路）。
// expenses/incomes: [{ resource_id, amount, note }]；兼容单资源旧调用 expense/income。
export function amendActivityLedger(db, id, { expense = null, income = null, expenses, incomes } = {}) {
  const a = db.activities.find((x) => x.id === id);
  if (!a) return fail('活动不存在');
  if (a.status !== 'Completed') return fail('仅 Completed 活动可改账');
  let e, i;
  try {
    const exSrc = expenses !== undefined ? expenses : (expense ? [expense] : []);
    const inSrc = incomes !== undefined ? incomes : (income ? [income] : []);
    e = sanitizePresets(db, exSrc, '支出');
    i = sanitizePresets(db, inSrc, '收入');
  } catch (err) { return fail(err.message); }
  if (!e.length && !i.length) return fail('改账后必须至少保留一笔收支');
  // 1) 反转原 activity 流水（逐条追加冲正）
  const origs = db.txs.filter((t) => t.source_type === 'activity' && t.source_id === id && !t.reversal_of);
  for (const t of origs) {
    const amt = t.debit > 0 ? t.debit : t.credit; // 原单方向金额
    db.txs.push({
      id: nextId(db, 't'), resource_id: t.resource_id,
      debit: t.debit > 0 ? 0 : amt, credit: t.debit > 0 ? amt : 0, // 反向
      source_type: 'reversal', source_id: t.id, note: `改账冲正：${t.note}`,
      reversal_of: t.id, created: Date.now(),
    });
  }
  // 2) 按新值重记
  for (const ex of e) {
    db.txs.push({
      id: nextId(db, 't'), resource_id: ex.resource_id, debit: 0, credit: ex.amount,
      source_type: 'activity', source_id: id, note: (ex.note || '').trim() || '支出',
      reversal_of: null, created: Date.now(),
    });
  }
  for (const inc of i) {
    db.txs.push({
      id: nextId(db, 't'), resource_id: inc.resource_id, debit: inc.amount, credit: 0,
      source_type: 'activity', source_id: id, note: (inc.note || '').trim() || '收入',
      reversal_of: null, created: Date.now(),
    });
  }
  return ok();
}

// ============================================================
// 循环预生成（替代旧的「完成/失败时自动衍生下一期」状态机）：
// 创建活动时一次性生成全部后续期次；每期是独立 Planned 活动，
// 用现有 开始/完成/失败/编辑/删除 操作管理，不再依赖隐藏的自动衍生。
// ============================================================
const REPEAT_BATCH = 30;      // 无 repeat_until 时默认生成期数
const REPEAT_MAX_UNTIL = 365; // repeat_until 生成上限（防失控）

// ============================================================
// 循环（系列容器）：一条活动 = 一个循环。
// 内部 occurrences[] 存全部期次（{date, status}），列表/日历只出现这一条；
// 完成/失败一期 → 标记该期次并推进到下一期（planned_date 原地滚动），
// 不再生成 N 份副本 → 列表不爆炸、删除即删整个系列。
// ============================================================

// 生成期次日期序列（含首期 planned_date；weekday 跳过周末由 nextOccurrenceDate 处理）
function buildOccurrenceDates(a) {
  if (!a.repeat) return [];
  const dates = [a.planned_date];
  let cur = a.planned_date;
  for (let i = 0; i < REPEAT_MAX_UNTIL; i++) {
    const next = nextOccurrenceDate(cur, a.repeat);
    if (a.repeat_until && dateKey(next) > dateKey(a.repeat_until)) break;
    if (!a.repeat_until && dates.length >= REPEAT_BATCH) break; // 无 until → 默认 N 期
    dates.push(next);
    cur = next;
  }
  return dates;
}

// 当前期次：优先匹配给定日期，否则第一个 pending，最后兜底首个
function currentOccurrence(a, dateStr) {
  const occs = a.occurrences || [];
  if (dateStr) {
    const hit = occs.find((o) => dateKey(o.date) === dateKey(dateStr));
    if (hit) return hit;
  }
  return occs.find((o) => o.status === 'pending') || occs[0] || null;
}

// 循环系列的「当前期」兜底：清空计划时间时回落到首个 pending 期次（无则首个），
// 避免「无当前期」悬空态（编辑表单清空时间后 planned_date 不能是 null）
function fallbackSeriesDate(a) {
  if (!a.repeat || !Array.isArray(a.occurrences) || !a.occurrences.length) return null;
  const next = a.occurrences.find((o) => o.status === 'pending');
  return next ? next.date : a.occurrences[0].date;
}

// 推进到下一个 pending 期次；无则返回 false（系列终态）
function advanceRecurrence(db, a) {
  const next = (a.occurrences || []).find((o) => o.status === 'pending');
  if (!next) return false;
  a.planned_date = next.date;
  a.actual_start = null;
  a.actual_end = null;
  a.status = 'Planned';
  a.failedReason = null;
  cleanConflictsFor(db, a.id); // 换期即离开时间线，解除旧捆绑
  return true;
}

// 循环进度：{ done, skipped, pending, total }
export function seriesProgress(db, a) {
  const occs = a.occurrences || [];
  const done = occs.filter((o) => o.status === 'done').length;
  const skipped = occs.filter((o) => o.status === 'skipped').length;
  return { done, skipped, pending: occs.length - done - skipped, total: occs.length };
}

// 续生成：在当前系列之后追加 count 期（无 repeat_until 时可随时扩期；扩期即解除 until 上限）
export function extendRecurrence(db, id, count = REPEAT_BATCH) {
  const a = db.activities.find((x) => x.id === id);
  if (!a) return fail('活动不存在');
  if (!a.repeat) return fail('仅循环活动可续生成后续期次');
  if (a.repeat_until) a.repeat_until = null; // 扩期 = 开放循环
  const occs = a.occurrences || [];
  let cur = occs.length ? occs[occs.length - 1].date : a.planned_date;
  let made = 0;
  for (let i = 0; i < count && made < REPEAT_MAX_UNTIL; i++) {
    const next = nextOccurrenceDate(cur, a.repeat);
    occs.push({ date: next, status: 'pending' });
    cur = next;
    made++;
  }
  a.occurrences = occs;
  return ok({ spawned: made });
}

// 跳过单个期次（日历展开的「未来期次」用）：不触发布局/不记账，只标记 skipped。
// 若跳过的是当前期且未开始 → 推进到下一 pending 期次；进行中（Started）拒绝（走完成/失败）。
export function skipOccurrence(db, id, date) {
  const a = db.activities.find((x) => x.id === id);
  if (!a) return fail('活动不存在');
  if (!a.repeat || !Array.isArray(a.occurrences) || !a.occurrences.length) return fail('仅循环活动可操作期次');
  const occ = a.occurrences.find((o) => dateKey(o.date) === dateKey(date));
  if (!occ) return fail('期次不存在');
  if (occ.status !== 'pending') return fail(occ.status === 'done' ? '已完成期次不可跳过' : '该期次已跳过');
  occ.status = 'skipped';
  if (dateKey(a.planned_date) === dateKey(occ.date)) {
    if (a.status === 'Started') { occ.status = 'pending'; return fail('进行中的本期请用「完成/失败」处理'); }
    advanceRecurrence(db, a); // 跳过当前期 → 推进到下一 pending
  }
  return ok({ planned_date: a.planned_date });
}

// ============================================================
// 周期编辑三态（对标 Google/Outlook 改循环弹窗）
//   scope = 'all'（全部=整系列）| 'following'（此期及后续）| 'only'（仅此期）
// 系列容器是「单记录 + 共享字段」：三态的本质区别在「日期」如何变化——
//   all       → 整系列整体更新（含日期），即普通 updateActivity
//   following → 当期与其后所有期次日期整体平移（保持原间隔），字段整系列更新
//   only      → 把当期从系列摘出，另建独立单次活动（例外，字段快照带入），系列保留其余期次
// 仅 Planned 的当期可做 following/only（Started 走完成/失败；当期已完成/已跳过只能选「全部」）。
// ============================================================
function daysBetween(aKey, bKey) {
  return Math.round((parseDate(aKey).getTime() - parseDate(bKey).getTime()) / 86400000);
}
function addDaysToKey(key, n) {
  const d = parseDate(key);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function updateSeries(db, id, scope, payload) {
  const a = db.activities.find((x) => x.id === id);
  if (!a) return fail('活动不存在');
  if (!a.repeat || !Array.isArray(a.occurrences) || !a.occurrences.length) return fail('仅循环活动支持编辑范围');
  if (scope === 'all' || !scope) return updateActivity(db, id, payload);
  const pivot = a.occurrences.find((o) => dateKey(o.date) === dateKey(a.planned_date)) || a.occurrences[0];
  if (!pivot) return fail('期次不存在');
  if (pivot.status !== 'pending') return fail('当期已完成/已跳过，编辑范围只能选「全部」');
  if (a.status === 'Started') return fail('进行中的本期请先「完成/失败」再调整后续期次');

  if (scope === 'only') {
    // 仅此期：摘出当期 → 独立单次活动（例外），表单字段快照带入；系列回落/保留其余期次
    const r = createActivity(db, {
      title: payload.title, note: payload.note, plan_ids: payload.plan_ids || a.plan_ids,
      planned_date: payload.planned_start ? datePartFromDatetime(payload.planned_start) : (payload.planned_date || pivot.date),
      planned_start: payload.planned_start || a.planned_start,
      planned_minutes: payload.planned_minutes !== undefined ? Number(payload.planned_minutes) || 0 : a.planned_minutes,
      repeat: null, repeat_until: null,
      theme: payload.theme !== undefined ? payload.theme : a.theme,
      keep_conflict: payload.keep_conflict,
      preset_expenses: payload.preset_expenses, preset_incomes: payload.preset_incomes,
    });
    if (!r.ok) return r;
    const ex = db.activities[db.activities.length - 1];
    a.occurrences = a.occurrences.filter((o) => o !== pivot);
    if (a.occurrences.length) {
      a.planned_date = fallbackSeriesDate(a);
    } else {
      // 系列期次被摘空 → 退化为单次空壳（非循环，无悬空）
      a.repeat = null; a.occurrences = []; a.planned_date = null;
    }
    return ok({ split: true, exception_id: ex.id, planned_date: a.planned_date });
  }

  if (scope === 'following') {
    // 此期及后续：当期与其后全部期次日期整体平移，保持原间隔；字段整系列更新
    const newPivotDate = payload.planned_start ? datePartFromDatetime(payload.planned_start) : (payload.planned_date || pivot.date);
    const delta = daysBetween(newPivotDate, pivot.date);
    const fromIdx = a.occurrences.indexOf(pivot);
    if (delta !== 0) {
      a.occurrences = a.occurrences.map((o, i) => (i < fromIdx ? o : { ...o, date: addDaysToKey(o.date, delta) }));
      // repeat_until 被平移超越则截断（始终保留当期 pivot，避免系列被截空）
      if (a.repeat_until) {
        const pivotDate = addDaysToKey(pivot.date, delta); // map 后 pivot 引用已换新，用平移后的当期日期比对
        a.occurrences = a.occurrences.filter((o) => dateKey(o.date) === dateKey(pivotDate) || dateKey(o.date) <= dateKey(a.repeat_until));
      }
    }
    const r = updateActivity(db, id, payload);
    if (!r.ok) return r;
    return ok({ ...r, shifted_dates: delta });
  }

  return fail('未知编辑范围');
}

export function failActivity(db, id, reason = '') {
  const a = db.activities.find((x) => x.id === id);
  if (!a) return fail('活动不存在');
  if (!checkTransition(ACTIVITY_TRANSITIONS, a.status, 'Failed')) return fail(`非法流转：${a.status} → Failed`);
  a.status = 'Failed';
  a.failedReason = String(reason || '').slice(0, 200) || '未指定原因';
  a.retryCount = (a.retryCount || 0) + 1;
  a.actual_end = Date.now();
  cleanConflictsFor(db, id);
  if (a.repeat && Array.isArray(a.occurrences) && a.occurrences.length) {
    // 循环：标记本期 skipped，推进到下一期（重试）
    const occ = currentOccurrence(a, a.actual_start ? dateKey(new Date(a.actual_start)) : a.planned_date);
    if (occ && occ.status === 'pending') occ.status = 'skipped';
    const advanced = advanceRecurrence(db, a);
    return ok({ advanced, removed: !advanced });
  }
  // 非循环：自动 re-init 回 Planned（可立即重试，不留 Failed 堆积）
  a.status = 'Planned';
  a.failedReason = null;
  a.actual_start = null;
  a.actual_end = null;
  return ok({ reInited: true, removed: false });
}

export function reinitFailedActivity(db, id) {
  const a = db.activities.find((x) => x.id === id);
  if (!a) return fail('活动不存在');
  if (a.status !== 'Failed') return fail('仅 Failed 可重初始化');
  a.status = 'Planned';
  a.failedReason = null;
  a.actual_start = null;
  a.actual_end = null;
  return ok();
}

// 后续状态：Completed → Reviewed → Archived（决策 8C）
export function setActivityStatus(db, id, next) {
  const a = db.activities.find((x) => x.id === id);
  if (!a) return fail('活动不存在');
  if (!checkTransition(ACTIVITY_TRANSITIONS, a.status, next)) return fail(`非法流转：${a.status} → ${next}`);
  if (next === 'Completed') {
    // 直接到 Completed 的兜底校验（正常路径应走 completeActivity）
    if (!activityHasTx(db, id)) return fail('⛔ 完成必须已有资源流水（不变量2）');
    if (!activityHasOutput(db, id)) return fail('⛔ 完成必须已有产出（不变量2）');
    if (anyPlanBlocked(db, a.plan_ids)) return fail('⛔ 关联计划预算已耗尽');
    a.actual_end = Date.now();
  }
  a.status = next;
  if (!OCCUPY_STATUSES.includes(next)) cleanConflictsFor(db, id); // B6：离开时间线即解除全部捆绑
  return ok();
}

// 已开始活动的顺延（服务层定时任务调用）：把 Started 活动的固定窗口整体搬到 now，
// 再走原子性重检——目标槽被占则自动顺延到最近空闲槽。无时长不可顺延。
export function rescheduleStarted(db, id, { now = Date.now() } = {}) {
  const a = db.activities.find((x) => x.id === id);
  if (!a) return fail('活动不存在');
  if (a.status !== 'Started') return fail('仅 Started 可顺延');
  if (!(Number(a.planned_minutes) > 0)) return fail('无时长不可顺延');
  a.planned_start = fmtDt(now);
  a.planned_end = fmtDt(now + Number(a.planned_minutes) * 60000);
  a.planned_date = datePartFromDatetime(a.planned_start);
  applyAtomicity(db, a);
  return ok({ moved_to: a.planned_start });
}

// ---------- 产出 (Output) ----------

// 决策 12B/13B：Draft→Published→Archived；归档自动生成 ValueFlow(Pending, +7天)
export function setOutputStatus(db, id, next) {
  const o = db.outputs.find((x) => x.id === id);
  if (!o) return fail('产出不存在');
  if (!checkTransition(OUTPUT_TRANSITIONS, o.status, next)) return fail(`非法流转：${o.status} → ${next}`);
  if (next === 'Archived') {
    db.valueflows.push({
      id: nextId(db, 'v'), output_id: o.id,
      giver: '', receiver: '', // 决策 14C：可后续补录双向交换对象
      status: 'Pending', expected: Date.now() + VF_EXPECT_MS,
      feedback: '', created: Date.now(),
    });
  }
  o.status = next;
  return ok();
}

// ---------- 流水 (ResourceTransaction) ----------

// 不变量5 / 决策 6B：绝对禁止 UPDATE/DELETE；更正 = 追加冲正流水（reversal_of 指向原单）
export function reverseTx(db, id, { amount, reason }) {
  const orig = db.txs.find((x) => x.id === id);
  if (!orig) return fail('流水不存在');
  if (orig.reversal_of) return fail('被冲正的流水不可再次冲正');
  const amt = Number(amount);
  if (!(amt > 0)) return fail('冲正金额必须 > 0');
  if (!validAmount(amt)) return fail('金额无效');
  // F2：累计冲正上限——同一原单可多次部分冲正，但 Σ冲正 ≤ 原单金额，
  // 否则重复部分冲正会凭空退款（60+60 > 100）
  const max = orig.debit || orig.credit;
  let reversed = 0;
  for (const t of db.txs) {
    if (t.source_type === 'reversal' && t.source_id === orig.id) reversed += (t.debit || 0) + (t.credit || 0);
  }
  if (amt > max - reversed) return fail('累计冲正已超出原流水金额');
  db.txs.push({
    id: nextId(db, 't'), resource_id: orig.resource_id,
    debit: orig.credit ? amt : 0, credit: orig.debit ? amt : 0,
    source_type: 'reversal', source_id: orig.id,
    note: `${(reason || '').trim() || '冲正'}（冲正 ${orig.id}）`,
    reversal_of: orig.id, created: Date.now(),
  });
  return ok();
}

// ---------- 价值流 (ValueFlow) ----------

// 决策 16BC：Pending/Overdue → 录入反馈 → Closed；可选回充资源（决策 15C）
export function closeValueflow(db, id, { feedback, recharge }) {
  const v = db.valueflows.find((x) => x.id === id);
  if (!v) return fail('价值流不存在');
  if (v.status === 'Closed') return fail('该价值流已闭环');
  v.feedback = (feedback || '').trim();
  v.status = 'Closed';
  if (recharge) {
    const token = db.resources.find((r) => r.name === '价值元') || db.resources[0];
    if (token) {
      db.txs.push({
        id: nextId(db, 't'), resource_id: token.id, debit: VF_RECHARGE, credit: 0,
        source_type: 'valueflow', source_id: v.id, note: `价值流回充 +${VF_RECHARGE}`,
        reversal_of: null, created: Date.now(),
      });
    }
  }
  return ok();
}

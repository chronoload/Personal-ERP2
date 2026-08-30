// ============================================================
// domain/entities.js
// 领域层：聚合根定义、状态机常量与合法流转表（纯数据，无副作用）
// 依据：测试.md 冻结决策 1B~19BC + 5 条全局不变量
// ============================================================

// ---- 资源 (Resource) -------------------------------------------------
// 决策：多资源账户 + 可自定义；余额 = initial + Σ(debit) − Σ(credit)（不变量1）
export const RESOURCE_STATES = ['Active', 'Inactive'];

// ---- 活动 (Activity) -------------------------------------------------
// 决策 8C：严格五态（含审计关门）+ 2026-08 形式化扩展：显式 FAILED 终态防止堆积
// 解耦原则：本表仅管 Activity，不触及其他聚合根的 TRANSITIONS
export const ACTIVITY_STATES = ['Planned', 'Started', 'Completed', 'Failed', 'Reviewed', 'Archived'];
export const ACTIVITY_TRANSITIONS = {
  Planned: ['Started', 'Failed'],
  Started: ['Completed', 'Failed'],
  Completed: ['Reviewed'],
  Failed: [], // 终态：不再重试，杜绝堆积；如需清理可归档由上层决定
  Reviewed: ['Archived'],
};
// 形式化转移表（单一真源，显式规则，无隐藏魔法）- 镜像 Python 规范的 TRANSITION_TABLE
export const ACTIVITY_TRANSITION_TABLE = {
  'Planned->Started': true,
  'Planned->Failed': true,
  'Started->Completed': true,
  'Started->Failed': true,
  'Completed->Reviewed': true,
  'Reviewed->Archived': true,
};

// ---- 计划 (Plan) -----------------------------------------------------
// 决策 18C：终身演进态（含孵化）
export const PLAN_STATES = ['Incubating', 'Active', 'Paused', 'Completed', 'Archived'];
export const PLAN_TRANSITIONS = {
  Incubating: ['Active'],
  Active: ['Paused', 'Completed', 'Archived'],
  Paused: ['Active', 'Completed', 'Archived'],
};

// ---- 目标 (Goal) -----------------------------------------------------
// 战略层轻态机：Active → Completed → Archived（归档即从主视图退场，保持列表精简）
export const GOAL_STATES = ['Active', 'Completed', 'Archived'];
export const GOAL_TRANSITIONS = {
  Active: ['Completed', 'Archived'],
  Completed: ['Archived'],
};

// ---- 产出 (Output) ---------------------------------------------------
// 决策 12B：独立生命周期
export const OUTPUT_STATES = ['Draft', 'Published', 'Archived'];
export const OUTPUT_TRANSITIONS = {
  Draft: ['Published'],
  Published: ['Archived'],
};

// ---- 价值流 (ValueFlow) ----------------------------------------------
// 决策 16BC：Pending → Closed / Overdue（Overdue 由 expected 派生）
export const VF_STATES = ['Pending', 'Closed', 'Overdue'];

// ---- 流水方向 ---------------------------------------------------------
export const DIR_CONSUME = 'credit'; // 消耗（支出）
export const DIR_GAIN = 'debit';     // 获得（收入）

// 价值流回充额度（决策 15C）
export const VF_RECHARGE = 10;

// 产出归档后 ValueFlow 默认期望反馈周期（决策 13B/16C）：7 天
export const VF_EXPECT_MS = 7 * 24 * 3600 * 1000;

// ---- 商品 (Good) -------------------------------------------------
// 决策：LifeUp 式快速消费——预设商品，一键扣减资源余额（生成 credit 流水）
export const GOOD_STATES = ['Active', 'Inactive'];

export function newGood({ name, emoji = '🛍️', costs = [], note = '' }) {
  return { name, emoji, costs, note, status: 'Active', created: Date.now() };
}

// ---- ID 生成 ----------------------------------------------------------
// 为每个聚合根维护独立自增序号：db.seq[key] 递增
export function nextId(db, key) {
  db.seq[key] = (db.seq[key] || 0) + 1;
  return key + db.seq[key];
}

// ---- 通用实体工厂 -----------------------------------------------------
export function newActivity({ title, note = '', plan_ids = [], planned_date = null, planned_start = null, planned_minutes = 0, repeat = null, repeat_until = null, time_logs = [], theme = null }) {
  return {
    title,
    note,
    plan_ids,
    planned_date,       // YYYY-M-D（计划日期，供日历/循环；由 planned_start 推导）
    planned_start,      // 计划开始时间，精确到分钟：YYYY-MM-DDTHH:MM（可空）
    planned_minutes,    // 计划投入分钟
    repeat,             // 循环：null | 'daily' | 'weekday' | 'weekly' | 'monthly'
    repeat_until,       // 循环结束日（YYYY-M-D / YYYY-MM-DD，可空=一直循环）
    occurrences: [],    // 期次数组（循环容器）：[{ date:'YYYY-M-D', status:'pending'|'done'|'skipped', completedAt? }]
    time_logs,          // 按任务计时 [{ start, end? }]，未关 end 表示运行中
    theme,              // 卡片虚化主题背景：null | {type:'gradient'|'image', value/url}
    preset_expenses: [],  // 预设支出（多资源，同 Goods.costs）：[{resource_id, amount, note}]
    preset_incomes: [],   // 预设收入（多资源）：[{resource_id, amount, note}]
    conflicts: [],      // 冲突捆绑：显式保留的时间重叠对手 id 列表（执行时仲裁）
    actual_start: null, // 实际开始时间戳（决策 9B 实际坐标）
    actual_end: null,
    status: 'Planned',
    failedReason: null, // 显式失败原因（仅 Failed 终态有值，解耦堆积）
    retryCount: 0,
    maxRetries: 3,
    created: Date.now(),
  };
}

export function newOutput({ title, tags = [], note = '' }) {
  return { title, tags, note, status: 'Draft', created: Date.now() };
}

export function newPlan({ goal_id, title, budget = null, color = null }) {
  return {
    goal_id, title, budget, color, status: 'Incubating', created: Date.now(),
    default_expenses: [], // 计划级默认预设支出（多资源，新建该计划下活动时继承）
    default_incomes: [],  // 计划级默认预设收入（多资源）
  };
}

export function newGoal({ title, desc = '' }) {
  return { title, desc, status: 'Active', created: Date.now() };
}

export function newResource({ name, unit = '', initial = 0, color = null }) {
  return { name, unit, initial, color, status: 'Active', created: Date.now() };
}

export function newRule({ label, from, to, rate }) {
  return { label, from, to, rate, status: 'Active', created: Date.now() };
}

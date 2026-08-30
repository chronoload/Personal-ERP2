// ============================================================
// tests/domain.test.js
// 领域引擎单元测试：状态机 / 不变量 / 冲正 / 兑换
// 运行：npm test  (node --test)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedDB } from '../src/store/db.js';
import { mergeImport, inspectImport } from '../src/domain/importMerge.js';
import * as E from '../src/domain/engine.js';

// 最小化的干净库（独立于演示数据）
function freshDB() {
  const db = seedDB();
  // 清空演示数据，只保留结构 + 一个资源
  db.resources = [{ id: 'r1', name: 'Token', unit: 'Token', initial: 100, status: 'Active', created: 0 }];
  db.rules = []; db.goals = []; db.plans = []; db.activities = []; db.txs = []; db.outputs = []; db.valueflows = []; db.goods = [];
  db.seq = { r: 1, ru: 0, g: 0, p: 0, a: 0, t: 0, o: 0, v: 0, gd: 0 };
  return db;
}

// ---- 不变量1：余额 = 初始 + Σ(debit−credit)，冲正不重复计入 ----
test('不变量1：余额由流水求和得出', () => {
  const db = freshDB();
  db.txs.push({ id: 't1', resource_id: 'r1', debit: 10, credit: 0, source_type: 'manual', source_id: null, note: '', reversal_of: null, created: 1 });
  db.txs.push({ id: 't2', resource_id: 'r1', debit: 0, credit: 30, source_type: 'manual', source_id: null, note: '', reversal_of: null, created: 2 });
  assert.equal(E.balanceOf(db, 'r1'), 100 + 10 - 30);
});

test('不变量1：被冲正的原流水不计入余额', () => {
  const db = freshDB();
  db.txs.push({ id: 't1', resource_id: 'r1', debit: 0, credit: 50, source_type: 'manual', source_id: null, note: '', reversal_of: null, created: 1 });
  db.txs.push({ id: 't2', resource_id: 'r1', debit: 50, credit: 0, source_type: 'reversal', source_id: 't1', note: '', reversal_of: 't1', created: 2 });
  assert.equal(E.balanceOf(db, 'r1'), 100); // 50 支出被 50 冲正抵消
});

// ---- 状态机：活动五态 8C ----
test('8C：活动五态合法流转', () => {
  const db = freshDB();
  E.createActivity(db, { title: '写章节', note: '', plan_ids: [] });
  const a = db.activities[0];
  assert.equal(a.status, 'Planned');
  assert.equal(E.startActivity(db, a.id).ok, true);
  assert.equal(a.status, 'Started');
  // 未登记流水/产出前不能直接到 Completed（不变量2 兜底）
  assert.equal(E.setActivityStatus(db, a.id, 'Completed').ok, false);
  // 完成需要流水+产出
  const r = E.completeActivity(db, a.id, { expense: { resource_id: 'r1', amount: 20, note: 'x' }, output_title: '章节1', output_tags: ['写作'] });
  assert.equal(r.ok, true);
  assert.equal(a.status, 'Completed');
  assert.equal(E.setActivityStatus(db, a.id, 'Reviewed').ok, true);
  assert.equal(E.setActivityStatus(db, a.id, 'Archived').ok, true);
});

test('8C：非法流转被拒绝（Started 回退 Planned）', () => {
  const db = freshDB();
  E.createActivity(db, { title: 'x', note: '', plan_ids: [] });
  E.startActivity(db, db.activities[0].id);
  assert.equal(E.startActivity(db, db.activities[0].id).ok, false); // 已 Started 不能再 start
  assert.equal(E.setActivityStatus(db, db.activities[0].id, 'Planned').ok, false); // 无回退
});

// ---- 目标状态机（战略层轻态）：Active → Completed → Archived ----
test('目标状态机：合法流转 / 非法拒绝 / 缺省回落', () => {
  const db = freshDB();
  E.createGoal(db, { title: '健康' });
  const g = db.goals[0];
  assert.equal(g.status, 'Active'); // 新建默认 Active
  assert.equal(E.setGoalStatus(db, g.id, 'Completed').ok, true);
  assert.equal(E.setGoalStatus(db, g.id, 'Archived').ok, true);
  assert.equal(E.setGoalStatus(db, g.id, 'Active').ok, false); // 归档后不回退
  assert.equal(E.setGoalStatus(db, g.id, 'Completed').ok, false); // 归档后不能完成
  assert.equal(E.setGoalStatus(db, 'nonexistent', 'Active').ok, false); // 不存在拒绝
});

// ---- 不变量2：完成必须流水 + 产出 ----
test('不变量2：Complete 必带流水与产出，缺一则拒', () => {
  const db = freshDB();
  E.createActivity(db, { title: 'a', note: '', plan_ids: [] });
  const id = db.activities[0].id;
  E.startActivity(db, id);
  assert.equal(E.completeActivity(db, id, { resource_id: 'r1', direction: 'credit', amount: 0, output_title: 'o', output_tags: [] }).ok, false); // 金额=0
  assert.equal(E.completeActivity(db, id, { resource_id: 'r1', direction: 'credit', amount: 5, output_title: '', output_tags: [] }).ok, false); // 缺产出
});

// ---- 不变量3：产出归档自动生成 ValueFlow(Pending, +7天) ----
test('不变量3：Output Archived 自动生成 ValueFlow', () => {
  const db = freshDB();
  E.createActivity(db, { title: 'a', note: '', plan_ids: [] });
  const id = db.activities[0].id;
  E.startActivity(db, id);
  E.completeActivity(db, id, { expense: { resource_id: 'r1', amount: 5, note: '' }, output_title: 'o', output_tags: [] });
  const oid = db.outputs[0].id;
  assert.equal(E.setOutputStatus(db, oid, 'Published').ok, true);
  assert.equal(E.setOutputStatus(db, oid, 'Archived').ok, true);
  assert.equal(db.valueflows.length, 1);
  const vf = db.valueflows[0];
  assert.equal(vf.status, 'Pending');
  assert.ok(vf.expected - Date.now() >= 6 * 864e5); // ~7 天
  assert.equal(E.vfStatus(db, vf), 'Pending');
});

// ---- 不变量4：计划预算硬约束 ----
test('不变量4：预算耗尽后禁止开始/完成', () => {
  const db = freshDB();
  E.createGoal(db, { title: 'g', desc: '' });
  E.createPlan(db, { goal_id: db.goals[0].id, title: 'p', budget: 10 });
  const pid = db.plans[0].id;
  E.createActivity(db, { title: 'a', note: '', plan_ids: [pid] });
  const aid = db.activities[0].id;
  E.startActivity(db, aid);
  // 完成一笔 10（刚好打满预算）
  assert.equal(E.completeActivity(db, aid, { expense: { resource_id: 'r1', amount: 10, note: '' }, output_title: 'o', output_tags: [] }).ok, true);
  assert.equal(E.isPlanBlocked(db, pid), true);
  // 新活动禁止开始
  E.createActivity(db, { title: 'b', note: '', plan_ids: [pid] });
  assert.equal(E.startActivity(db, db.activities[1].id).ok, false);
});

// ---- 不变量5：流水不可变，只可冲正 ----
test('不变量5：冲正生成新流水且余额回补', () => {
  const db = freshDB();
  db.seq.t = 1; // 已有手工 t1，保证 nextId 不冲突
  db.txs.push({ id: 't1', resource_id: 'r1', debit: 0, credit: 40, source_type: 'manual', source_id: null, note: '', reversal_of: null, created: 1 });
  assert.equal(E.balanceOf(db, 'r1'), 60);
  const r = E.reverseTx(db, 't1', { amount: 40, reason: '记错了' });
  assert.equal(r.ok, true);
  const rev = db.txs[1];
  assert.equal(rev.id, 't2');
  assert.equal(rev.reversal_of, 't1');
  assert.equal(rev.debit, 40);
  assert.equal(E.balanceOf(db, 'r1'), 100); // 完全回补
  // 冲正不可再冲正
  assert.equal(E.reverseTx(db, rev.id, { amount: 10, reason: '' }).ok, false);
});

// ---- 兑换：单向换算生成两条流水 ----
test('兑换：单向换算生成双向流水且余额守恒', () => {
  const db = freshDB();
  db.resources.push({ id: 'r2', name: '精力', unit: '点', initial: 50, status: 'Active', created: 0 });
  E.createRule(db, { label: '换算', from: 'r2', to: 'r1', rate: 2 });
  const r = E.convert(db, db.rules[0].id, 10);
  assert.equal(r.ok, true);
  assert.equal(E.balanceOf(db, 'r2'), 40); // -10
  assert.equal(E.balanceOf(db, 'r1'), 120); // +20
  // 允许借贷：余额不足也放行（r2 余 40，兑 999 → r2 变 -959）
  assert.equal(E.convert(db, db.rules[0].id, 999).ok, true);
  assert.equal(E.balanceOf(db, 'r2'), -959);
});

// ---- 计划成本核算 ----
test('planCost 只统计活动来源且跳过冲正', () => {
  const db = freshDB();
  E.createGoal(db, { title: 'g', desc: '' });
  E.createPlan(db, { goal_id: db.goals[0].id, title: 'p', budget: null });
  const pid = db.plans[0].id;
  E.createActivity(db, { title: 'a', note: '', plan_ids: [pid] });
  const aid = db.activities[0].id;
  E.startActivity(db, aid);
  E.completeActivity(db, aid, { expense: { resource_id: 'r1', amount: 30, note: '' }, output_title: 'o', output_tags: [] });
  assert.equal(E.planCost(db, pid), 30);
});

// ---- 级联删除：计划 → 整链清理 ----
function buildPlanWithCompletedActivity(db) {
  E.createGoal(db, { title: 'g', desc: '' });
  E.createPlan(db, { goal_id: db.goals[0].id, title: 'p', budget: null });
  const pid = db.plans[0].id;
  E.createActivity(db, { title: 'a', note: '', plan_ids: [pid] });
  const aid = db.activities[0].id;
  E.startActivity(db, aid);
  E.completeActivity(db, aid, { expense: { resource_id: 'r1', amount: 30, note: '' }, output_title: 'o', output_tags: [] });
  const oid = db.outputs[0].id;
  E.setOutputStatus(db, oid, 'Published');
  E.setOutputStatus(db, oid, 'Archived'); // 生成价值流
  return { pid, aid, oid };
}

test('级联删除计划：活动/产出/价值流/流水一并清理', () => {
  const db = freshDB();
  const { pid, aid, oid } = buildPlanWithCompletedActivity(db);
  const nTxBefore = db.txs.length;
  assert.ok(nTxBefore > 0);
  assert.equal(E.planDeleteImpact(db, pid).acts, 1);
  assert.equal(E.deletePlanCascade(db, pid).ok, true);
  assert.equal(db.plans.length, 0);
  assert.equal(db.activities.length, 0);
  assert.equal(db.outputs.length, 0);
  assert.equal(db.valueflows.length, 0);
  assert.equal(db.txs.length, 0); // 活动流水+价值流回充等全部清理
  assert.equal(db.activities.some((x) => x.id === aid), false);
});

test('级联删除计划：多计划活动仅解除关联', () => {
  const db = freshDB();
  E.createGoal(db, { title: 'g', desc: '' });
  E.createPlan(db, { goal_id: db.goals[0].id, title: 'p1', budget: null });
  E.createPlan(db, { goal_id: db.goals[0].id, title: 'p2', budget: null });
  const p1 = db.plans[0].id, p2 = db.plans[1].id;
  E.createActivity(db, { title: 'a', note: '', plan_ids: [p1, p2] });
  const aid = db.activities[0].id;
  assert.equal(E.planDeleteImpact(db, p1).unlink, 1);
  assert.equal(E.deletePlanCascade(db, p1).ok, true);
  assert.equal(db.activities.length, 1); // 活动保留
  assert.deepEqual(db.activities[0].plan_ids, [p2]); // 仅解除 p1
  assert.equal(db.plans.length, 1);
});

test('级联删除目标：连带其下计划与活动', () => {
  const db = freshDB();
  E.createGoal(db, { title: 'g', desc: '' });
  E.createGoal(db, { title: 'g2', desc: '' });
  E.createPlan(db, { goal_id: db.goals[0].id, title: 'p', budget: null });
  const g1 = db.goals[0].id;
  E.createActivity(db, { title: 'a', note: '', plan_ids: [db.plans[0].id] });
  assert.equal(E.deleteGoalCascade(db, g1).ok, true);
  assert.equal(db.goals.length, 1);
  assert.equal(db.goals[0].title, 'g2'); // g2 保留
  assert.equal(db.plans.length, 0);
  assert.equal(db.activities.length, 0);
});

test('级联删除后余额与流水自洽', () => {
  const db = freshDB();
  const { pid } = buildPlanWithCompletedActivity(db);
  const balBefore = E.balanceOf(db, 'r1');
  E.deletePlanCascade(db, pid);
  assert.equal(E.balanceOf(db, 'r1'), 100); // 回到初始，无残留
  assert.equal(db.txs.filter((t) => t.reversal_of).length, 0); // 无孤儿冲正
});

// ---- 循环任务 ----
test('循环任务：一条活动 = 一个循环，完成一期推进到下一期', () => {
  const db = freshDB();
  E.createActivity(db, { title: '晨跑', note: '', plan_ids: [], planned_date: '2026-8-21', repeat: 'daily', repeat_until: '2026-8-25' });
  const a = db.activities[0];
  assert.equal(db.activities.length, 1); // 不再生成 N 份副本
  assert.equal(a.occurrences.length, 5); // 8-21..8-25 全部期次
  E.startActivity(db, a.id);
  const r = E.completeActivity(db, a.id, { expense: { resource_id: 'r1', amount: 5, note: '' }, output_title: 'o', output_tags: [] });
  assert.equal(r.ok, true);
  assert.equal(r.advanced, true);
  assert.equal(db.activities.length, 1);
  assert.equal(a.planned_date, '2026-8-22'); // 推进到下一期
  assert.equal(a.occurrences[0].status, 'done');
  assert.equal(a.status, 'Planned');
  // 工作日循环跳过周末
  assert.equal(E.nextOccurrenceDate('2026-8-21', 'weekday'), '2026-8-24'); // 周五→下周一
});

test('循环任务：超过结束日不再生成', () => {
  const db = freshDB();
  E.createActivity(db, { title: 'x', note: '', plan_ids: [], planned_date: '2026-8-30', repeat: 'daily', repeat_until: '2026-8-30' });
  const a = db.activities[0];
  E.startActivity(db, a.id);
  E.completeActivity(db, a.id, { expense: { resource_id: 'r1', amount: 1, note: '' }, output_title: 'o', output_tags: [] });
  assert.equal(db.activities.length, 1); // 下一日已过结束日
});

// ---- 收支同记 ----
test('完成同时记支出+收入两笔流水', () => {
  const db = freshDB();
  db.resources.push({ id: 'r2', name: '时间', unit: 'h', initial: 10, status: 'Active', created: 0 });
  E.createActivity(db, { title: 'a', note: '', plan_ids: [] });
  const id = db.activities[0].id;
  E.startActivity(db, id);
  const r = E.completeActivity(db, id, {
    expense: { resource_id: 'r1', amount: 30, note: '花销' },
    income: { resource_id: 'r2', amount: 2, note: '回充' },
    output_title: 'o', output_tags: [],
  });
  assert.equal(r.ok, true);
  assert.equal(db.txs.length, 2);
  assert.equal(E.balanceOf(db, 'r1'), 70); // -30
  assert.equal(E.balanceOf(db, 'r2'), 12); // +2
});

// ---- 按任务计时 ----
test('trackedMinutes 汇总 time_logs', () => {
  const db = freshDB();
  E.createActivity(db, { title: 'a', note: '', plan_ids: [] });
  const a = db.activities[0];
  const now = Date.now();
  a.time_logs = [{ start: now - 30 * 60e3, end: now }, { start: now - 10 * 60e3, end: now }];
  assert.equal(E.trackedMinutes(db, a.id), 40);
});

// ---- 手动调整资源 ----
test('adjustResource 生成 manual 流水并改变余额', () => {
  const db = freshDB();
  assert.equal(E.adjustResource(db, 'r1', { direction: 'debit', amount: 50, note: '充值' }).ok, true);
  assert.equal(E.balanceOf(db, 'r1'), 150);
  assert.equal(db.txs[0].source_type, 'manual');
  assert.equal(E.adjustResource(db, 'r1', { direction: 'credit', amount: 20, note: '' }).ok, true);
  assert.equal(E.balanceOf(db, 'r1'), 130);
});

// ---- 编辑资源元信息 ----
test('updateResource 改名称/单位/颜色，不影响余额与流水引用', () => {
  const db = freshDB();
  E.adjustResource(db, 'r1', { direction: 'debit', amount: 10, note: '' });
  assert.equal(E.updateResource(db, 'r1', { name: '  精力  ', unit: '点', color: '#3da06a' }).ok, true);
  const r = db.resources.find((x) => x.id === 'r1');
  assert.equal(r.name, '精力'); // 名称 trim
  assert.equal(r.unit, '点');
  assert.equal(r.color, '#3da06a');
  assert.equal(E.balanceOf(db, 'r1'), 110); // 余额不受编辑影响
});

test('updateResource：空名拒绝 / 资源不存在拒绝 / color 缺省不动原色', () => {
  const db = freshDB();
  db.resources[0].color = '#4a7fbf';
  assert.equal(E.updateResource(db, 'r1', { name: '', unit: '' }).ok, false);
  assert.equal(E.updateResource(db, 'rX', { name: 'x' }).ok, false);
  E.updateResource(db, 'r1', { name: '新名', unit: '' });
  assert.equal(db.resources[0].color, '#4a7fbf'); // 未传 color 保持原色
});

// ---- 删除资源 ----
test('deleteResource 连带清理流水与规则', () => {
  const db = freshDB();
  db.resources.push({ id: 'r2', name: '时间', unit: 'h', initial: 10, status: 'Active', created: 0 });
  db.txs.push({ id: 't1', resource_id: 'r2', debit: 0, credit: 5, source_type: 'manual', source_id: 'manual', note: '', reversal_of: null, created: 1 });
  E.createRule(db, { label: '换算', from: 'r2', to: 'r1', rate: 2 });
  assert.equal(E.deleteResource(db, 'r2').ok, true);
  assert.equal(db.resources.length, 1);
  assert.equal(db.txs.length, 0);
  assert.equal(db.rules.length, 0);
});

// ---- 增量合并导入 ----
test('计划颜色：默认自动分配 + 可更新', () => {
  const db = freshDB();
  E.createGoal(db, { title: 'g', desc: '' });
  const gid = db.goals[0].id;
  E.createPlan(db, { goal_id: gid, title: 'p1', budget: null });
  assert.ok(db.plans[0].color, 'should auto-assign a color');
  E.updatePlan(db, db.plans[0].id, { title: 'p1', budget: null, color: '#ff0000' });
  assert.equal(db.plans[0].color, '#ff0000');
});

test('计划开始时间（分钟级）推导日期，循环期次带到下一期', () => {
  const db = freshDB();
  E.createActivity(db, { title: '晨读', note: '', plan_ids: [], planned_start: '2026-8-23T07:30', planned_minutes: 30, repeat: 'daily' });
  const a = db.activities[0];
  assert.equal(a.planned_date, '2026-8-23');
  assert.equal(a.planned_start, '2026-8-23T07:30');
  assert.equal(a.occurrences[1].date, '2026-8-24');
  E.startActivity(db, a.id);
  const r = E.completeActivity(db, a.id, { expense: { resource_id: 'r1', amount: 1, note: '' }, output_title: 'o', output_tags: [] });
  assert.equal(r.advanced, true);
  assert.equal(a.planned_date, '2026-8-24'); // 推进到下一期
  assert.equal(a.planned_start, '2026-8-23T07:30'); // 时刻保留
  // 编辑：清空开始时间 → 时间清空；循环系列 planned_date 不悬空（回落首个 pending 期次）
  E.updateActivity(db, a.id, { title: '晨读', note: '', plan_ids: [], planned_start: '' });
  assert.equal(a.planned_start, null);
  assert.equal(a.planned_date, '2026-8-24'); // 回落首个 pending 期次，而非 null
});

test('增量合并：同名资源复用、引用重映射、其余按 id 去重', () => {
  const db = freshDB();
  db.resources[0].name = '价值元';
  const incoming = {
    resources: [
      { id: 'x1', name: '价值元', unit: '价值元', initial: 999, status: 'Active' }, // 同名 → 复用 r1
      { id: 'x2', name: '灵感', unit: '点', initial: 10, status: 'Active' },        // 新增
    ],
    rules: [{ id: 'xr', label: '规则', from: 'x1', to: 'x2', rate: 3, status: 'Active' }],
    goals: [{ id: 'xg', title: 'g', desc: '' }],
    plans: [{ id: 'xp', goal_id: 'xg', title: 'p', budget: null, status: 'Incubating' }],
    activities: [{ id: 'xa', title: 'a', note: '', plan_ids: ['xp'], status: 'Planned', created: 0 }],
    txs: [{ id: 'xt', resource_id: 'x1', debit: 0, credit: 5, source_type: 'manual', source_id: 'manual', note: '', reversal_of: null, created: 1 }],
    outputs: [], valueflows: [],
  };
  const prev = inspectImport(db, incoming);
  assert.equal(prev.sameRes, 1);
  assert.equal(prev.newRes, 1);
  const res = mergeImport(db, incoming);
  assert.equal(res.reusedRes, 1);
  assert.equal(res.addedRes, 1);
  assert.equal(db.resources.length, 2);            // 同名未新增重复
  assert.equal(db.resources.some((r) => r.id === 'x1'), false);
  assert.equal(db.rules[0].from, 'r1');            // 引用重映射到已有账户
  assert.equal(db.txs[0].resource_id, 'r1');
  assert.equal(E.balanceOf(db, 'r1'), 95);          // 100 - 5（新流水并入既有账户）
  assert.equal(db.goals.length, 1);
  assert.equal(db.plans[0].goal_id, 'xg');
  assert.equal(db.activities[0].plan_ids[0], 'xp');
});

// ---- 商品快速消费（LifeUp 式） ----
test('完成后再设循环：用「续生成」补期次', () => {
  const db = freshDB();
  db.resources[0].name = '价值元';
  E.createActivity(db, { title: '读书', note: '', plan_ids: [], planned_date: '2026-8-23' });
  const a = db.activities[0];
  E.startActivity(db, a.id);
  E.completeActivity(db, a.id, { expense: { resource_id: 'r1', amount: 1, note: '' }, output_title: 'o', output_tags: [] });
  assert.equal(a.status, 'Completed');
  assert.equal(a.occurrences.length, 0); // 非循环无期次
  // 编辑补设循环：不再自动衍生（旧「完成后自动衍生」已移除）
  const r = E.updateActivity(db, a.id, { title: '读书', note: '', plan_ids: [], repeat: 'daily' });
  assert.equal(r.ok, true);
  assert.equal(r.spawned, undefined);
  assert.equal(a.occurrences.length, 0);
  // 用「续生成」补期次
  const er = E.extendRecurrence(db, a.id, 3);
  assert.equal(er.ok, true);
  assert.equal(er.spawned, 3);
  assert.equal(a.occurrences.length, 3);
  assert.equal(a.occurrences[1].date, '2026-8-25'); // 从 8-23 起 daily
  // 再次续生成追加在最后
  const er2 = E.extendRecurrence(db, a.id, 2);
  assert.equal(er2.spawned, 2);
  assert.equal(a.occurrences.length, 5);
  // 再次编辑其他字段不重复生成
  const r2 = E.updateActivity(db, a.id, { title: '读书改', note: '', plan_ids: [], repeat: 'daily' });
  assert.equal(r2.spawned, undefined);
  assert.equal(a.occurrences.length, 5);
});

test('Archived 状态补设循环不生成下一期', () => {
  const db = freshDB();
  E.createActivity(db, { title: 'x', note: '', plan_ids: [] });
  const a = db.activities[0];
  E.startActivity(db, a.id);
  E.completeActivity(db, a.id, { expense: { resource_id: 'r1', amount: 1, note: '' }, output_title: 'o', output_tags: [] });
  E.setActivityStatus(db, a.id, 'Reviewed');
  E.setActivityStatus(db, a.id, 'Archived');
  const r = E.updateActivity(db, a.id, { title: 'x', note: '', plan_ids: [], repeat: 'weekly' });
  assert.equal(r.ok, true);
  assert.equal(db.activities.length, 1); // 归档后链条终止
});

// ---- 商品快速消费（LifeUp 式，支持多资源成本） ----
test('商品：创建/编辑/停用/删除', () => {
  const db = freshDB();
  assert.equal(E.createGood(db, { name: '咖啡', emoji: '☕', costs: [{ resource_id: 'r1', amount: 12 }], note: '' }).ok, true);
  const g = db.goods[0];
  assert.equal(g.id, 'gd1');
  assert.equal(E.createGood(db, { name: '', emoji: '', costs: [{ resource_id: 'r1', amount: 1 }] }).ok, false); // 名称必填
  assert.equal(E.createGood(db, { name: 'x', emoji: '', costs: [] }).ok, false); // 至少一种消耗
  assert.equal(E.updateGood(db, g.id, { name: '拿铁', emoji: '🥛', costs: [{ resource_id: 'r1', amount: 15 }, { resource_id: 'r1', amount: 0 }].filter((c) => c.amount > 0), note: '提神' }).ok, true);
  assert.equal(g.name, '拿铁');
  assert.equal(E.setGoodStatus(db, g.id, 'Inactive').ok, true);
  assert.equal(E.consumeGood(db, g.id, { qty: 1 }).ok, false); // 停用不可消费
  assert.equal(E.deleteGood(db, g.id).ok, true);
  assert.equal(db.goods.length, 0);
});

test('商品：快速消费生成 credit 流水且余额守恒（不变量1）', () => {
  const db = freshDB();
  db.resources.push({ id: 'r2', name: '精力', unit: '点', initial: 10, status: 'Active' });
  // 一杯咖啡 = 12 价值元 + 2 精力
  E.createGood(db, { name: '咖啡', emoji: '☕', costs: [{ resource_id: 'r1', amount: 12 }, { resource_id: 'r2', amount: 2 }], note: '' });
  const gid = db.goods[0].id;
  assert.equal(E.consumeGood(db, gid, { qty: 1, note: '下午茶' }).ok, true);
  assert.equal(db.txs.length, 2); // 每种资源一条流水
  const t1 = db.txs[0], t2 = db.txs[1];
  assert.equal(t1.source_type, 'goods');
  assert.equal(t1.credit, 12);
  assert.equal(t2.credit, 2);
  assert.equal(t1.note.includes('咖啡'), true);
  assert.equal(E.balanceOf(db, 'r1'), 88); // 100 - 12
  assert.equal(E.balanceOf(db, 'r2'), 8);  // 10 - 2
  // 允许借贷：余额不足照样扣减，余额可为负
  assert.equal(E.consumeGood(db, gid, { qty: 10 }).ok, true); // 需 120 元 + 20 精力
  assert.equal(E.balanceOf(db, 'r1'), -32); // 88 - 120（借贷）
  assert.equal(E.balanceOf(db, 'r2'), -12); // 8 - 20（借贷）
});

test('商品：旧单资源格式兼容读取', () => {
  const db = freshDB();
  db.goods.push({ id: 'gd9', name: '旧格式', emoji: '☕', resource_id: 'r1', price: 5, status: 'Active' });
  const g = db.goods[0];
  assert.deepEqual(E.goodCosts(g), [{ resource_id: 'r1', amount: 5 }]);
  assert.equal(E.consumeGood(db, 'gd9', { qty: 1 }).ok, true);
  assert.equal(E.balanceOf(db, 'r1'), 95);
});

// ---- 兑换允许借贷 ----
test('兑换：from 余额不足也放行（借贷）', () => {
  const db = freshDB();
  E.createRule(db, { label: '换算', from: 'r1', to: 'r1b', rate: 1 });
  // r1 余额 100，兑 250 → r1 变 -150，目标 +250
  const rule = db.rules[0];
  db.resources.push({ id: 'r1b', name: '灵感', unit: '点', initial: 0, status: 'Active' });
  const r = E.convert(db, rule.id, 250);
  assert.equal(r.ok, true);
  assert.equal(E.balanceOf(db, 'r1'), -150);
});

// ---- 活动时间原子性 ----
test('原子性：planned_end 由起始时间+时长推算', () => {
  const db = freshDB();
  const r = E.createActivity(db, { title: 'A', planned_start: '2026-08-23T10:00', planned_minutes: 90 });
  assert.equal(r.ok, true);
  const a = db.activities.find((x) => x.title === 'A');
  assert.equal(a.planned_end, '2026-08-23T11:30');
});

test('原子性：创建撞车→自动顺延到最近空闲槽并回报 shifted', () => {
  const db = freshDB();
  E.createActivity(db, { title: 'A', planned_start: '2026-08-23T10:00', planned_minutes: 60 });
  const r = E.createActivity(db, { title: 'B', planned_start: '2026-08-23T10:30', planned_minutes: 30 });
  assert.equal(r.ok, true);
  assert.equal(r.shifted, true);
  const b = db.activities.find((x) => x.title === 'B');
  assert.equal(b.planned_start, '2026-08-23T11:00'); // A 结束后无缝衔接
  assert.equal(b.planned_date, '2026-8-23');
});

test('原子性：弹性活动（无开始时间或零时长）不参与冲突', () => {
  const db = freshDB();
  E.createActivity(db, { title: '弹性', planned_date: '2026-8-23', planned_minutes: 0 });
  const r = E.createActivity(db, { title: 'B', planned_start: '2026-08-23T09:00', planned_minutes: 60 });
  assert.equal(r.ok, true);
  assert.equal(r.shifted, undefined); // 无窗活动不挡路
});

test('原子性：当天排满→顺延到次日同时刻', () => {
  const db = freshDB();
  E.createActivity(db, { title: '全天A', planned_start: '2026-08-23T08:00', planned_minutes: 600 });
  E.createActivity(db, { title: '全天B', planned_start: '2026-08-23T18:00', planned_minutes: 360 });
  const r = E.createActivity(db, { title: 'C', planned_start: '2026-08-23T12:00', planned_minutes: 120 });
  assert.equal(r.ok, true);
  assert.equal(r.shifted, true);
  const c = db.activities.find((x) => x.title === 'C');
  assert.equal(c.planned_start, '2026-08-24T12:00');
});

test('原子性：keep_conflict 显式保留冲突→双方互写捆绑标记', () => {
  const db = freshDB();
  E.createActivity(db, { title: 'A', planned_start: '2026-08-23T10:00', planned_minutes: 60 });
  const r = E.createActivity(db, { title: 'B', planned_start: '2026-08-23T10:30', planned_minutes: 30, keep_conflict: true });
  assert.equal(r.ok, true);
  assert.notEqual(r.bundled, undefined);
  const a = db.activities.find((x) => x.title === 'A');
  const b = db.activities.find((x) => x.title === 'B');
  assert.ok(b.conflicts.includes(a.id));
  assert.ok(a.conflicts.includes(b.id));
});

test('原子性：更新挪走时间→捆绑自动解除（双向清理）', () => {
  const db = freshDB();
  E.createActivity(db, { title: 'A', planned_start: '2026-08-23T10:00', planned_minutes: 60 });
  E.createActivity(db, { title: 'B', planned_start: '2026-08-23T10:30', planned_minutes: 30, keep_conflict: true });
  const b = db.activities.find((x) => x.title === 'B');
  const a = db.activities.find((x) => x.title === 'A');
  const r = E.updateActivity(db, b.id, { title: 'B', planned_start: '2026-08-23T15:00', planned_minutes: 30 });
  assert.equal(r.ok, true);
  assert.deepEqual(b.conflicts || [], []);
  assert.deepEqual(a.conflicts || [], []);
});

test('原子性：开始有排队冲突的活动→返回仲裁选择而不启动', () => {
  const db = freshDB();
  const ra = E.createActivity(db, { title: 'A', planned_start: '2026-08-23T10:00', planned_minutes: 60 });
  E.createActivity(db, { title: 'B', planned_start: '2026-08-23T10:30', planned_minutes: 30, keep_conflict: true });
  const a = db.activities.find((x) => x.title === 'A');
  const s = E.startActivity(db, a.id);
  assert.equal(s.ok, true);
  assert.ok(s.conflict_choice); // 结构化仲裁信息，UI 弹三选一
  assert.equal(a.status, 'Planned'); // 未真正开始
});

test('原子性：仲裁「先做这个」→对手顺延到自己结束后并正常开始', () => {
  const db = freshDB();
  E.createActivity(db, { title: 'A', planned_start: '2026-08-23T10:00', planned_minutes: 60 });
  E.createActivity(db, { title: 'B', planned_start: '2026-08-23T10:30', planned_minutes: 30, keep_conflict: true });
  const a = db.activities.find((x) => x.title === 'A');
  const b = db.activities.find((x) => x.title === 'B');
  const s = E.startActivity(db, a.id, { override: 'first' });
  assert.equal(s.ok, true);
  assert.equal(a.status, 'Started');
  assert.equal(b.planned_start, '2026-08-23T11:00');
  assert.deepEqual(b.conflicts || [], []); // 冲突已消解
});

test('quickComplete：快速计时收编路径同样满足不变量2', () => {
  const db = freshDB();
  E.createActivity(db, { title: '通用计时', note: '', plan_ids: [] });
  E.startActivity(db, db.activities[0].id);
  const r = E.quickComplete(db, db.activities[0].id, { expense: { resource_id: 'r1', amount: 5 } , outputTitle: '专注段' });
  assert.equal(r.ok, true);
  assert.equal(db.activities[0].status, 'Completed');
  assert.ok(db.outputs.some((o) => o.title === '专注段'));
  assert.ok(db.txs.some((t) => t.source_type === 'activity' && t.source_id === db.activities[0].id), '不变量2：必须产生活动来源流水');
});

test('原子性：仲裁「让对手先」→自己顺延到对手结束后仍为 Planned', () => {
  const db = freshDB();
  E.createActivity(db, { title: 'A', planned_start: '2026-08-23T10:00', planned_minutes: 60 });
  E.createActivity(db, { title: 'B', planned_start: '2026-08-23T10:30', planned_minutes: 30, keep_conflict: true });
  const a = db.activities.find((x) => x.title === 'A');
  const s = E.startActivity(db, a.id, { override: 'defer' });
  assert.equal(s.ok, true);
  assert.equal(s.moved_to, '2026-08-23T11:00');
  assert.equal(a.status, 'Planned');
  assert.equal(a.planned_start, '2026-08-23T11:00');
});

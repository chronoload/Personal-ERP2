// tests/preset_complete.test.js
// 预设收支（多资源，同 Goods.costs）+ 一键完成 + 改账 + 自动失败（TDD）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedDB, normalizeDB } from '../src/store/db.js';
import * as E from '../src/domain/engine.js';
import { newActivity, newPlan } from '../src/domain/entities.js';
import { scanDueEvents } from '../src/domain/schedule.js';

function freshDB() {
  const db = seedDB();
  db.resources = [
    { id: 'r1', name: 'Token', unit: 'Token', initial: 100, status: 'Active', created: 0 },
    { id: 'r2', name: '时间', unit: '分', initial: 0, status: 'Active', created: 0 },
    { id: 'r3', name: '精力', unit: '点', initial: 50, status: 'Active', created: 0 },
  ];
  db.rules = []; db.goals = []; db.plans = []; db.activities = []; db.txs = []; db.outputs = []; db.valueflows = []; db.goods = [];
  db.seq = { r: 3, ru: 0, g: 0, p: 0, a: 0, t: 0, o: 0, v: 0, gd: 0 };
  return db;
}
function msOf(s) {
  const [d, t] = s.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mi] = t.split(':').map(Number);
  return new Date(y, m - 1, dd, hh, mi).getTime();
}

// ---- 实体默认字段 ----
test('preset: newActivity/newPlan 默认预设数组为空', () => {
  const a = newActivity({ title: 't' });
  assert.deepEqual(a.preset_expenses, []);
  assert.deepEqual(a.preset_incomes, []);
  const p = newPlan({ goal_id: 'g1', title: 'p' });
  assert.deepEqual(p.default_expenses, []);
  assert.deepEqual(p.default_incomes, []);
});

// ---- 创建/更新活动预设（多资源）----
test('preset: createActivity 保存多资源预设收支', () => {
  const db = freshDB();
  const r = E.createActivity(db, {
    title: '写稿', plan_ids: [],
    preset_expenses: [
      { resource_id: 'r1', amount: 10, note: '写作消耗' },
      { resource_id: 'r2', amount: 60, note: '耗时' },
    ],
    preset_incomes: [{ resource_id: 'r1', amount: 5, note: '认可回充' }],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(db.activities[0].preset_expenses, [
    { resource_id: 'r1', amount: 10, note: '写作消耗' },
    { resource_id: 'r2', amount: 60, note: '耗时' },
  ]);
  assert.deepEqual(db.activities[0].preset_incomes, [{ resource_id: 'r1', amount: 5, note: '认可回充' }]);
});

test('preset: createActivity 非法预设被拒（资源不存在 / Infinity 金额）', () => {
  const db = freshDB();
  const r1 = E.createActivity(db, { title: 't', preset_expenses: [{ resource_id: 'ghost', amount: 1 }] });
  assert.equal(r1.ok, false);
  const r2 = E.createActivity(db, { title: 't', preset_incomes: [{ resource_id: 'r1', amount: '1e999' }] });
  assert.equal(r2.ok, false);
});

test('preset: createActivity 金额 0/空 条目被丢弃', () => {
  const db = freshDB();
  const r = E.createActivity(db, {
    title: 't',
    preset_expenses: [{ resource_id: 'r1', amount: 0 }, { resource_id: 'r2', amount: 3 }],
    preset_incomes: [{ resource_id: 'r1', amount: '' }],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(db.activities[0].preset_expenses, [{ resource_id: 'r2', amount: 3, note: '' }]);
  assert.deepEqual(db.activities[0].preset_incomes, []);
});

test('preset: updateActivity 更新/清空预设数组', () => {
  const db = freshDB();
  E.createActivity(db, { title: 't', preset_expenses: [{ resource_id: 'r1', amount: 3 }] });
  const id = db.activities[0].id;
  E.updateActivity(db, id, { title: 't', preset_expenses: [{ resource_id: 'r2', amount: 7 }, { resource_id: 'r3', amount: 2 }] });
  assert.deepEqual(db.activities[0].preset_expenses, [
    { resource_id: 'r2', amount: 7, note: '' },
    { resource_id: 'r3', amount: 2, note: '' },
  ]);
  E.updateActivity(db, id, { title: 't', preset_expenses: [] });
  assert.deepEqual(db.activities[0].preset_expenses, []);
});

// ---- 计划级默认预设（多资源）----
test('preset: createPlan/updatePlan 保存多资源默认预设', () => {
  const db = freshDB();
  db.goals = [{ id: 'g1', title: 'g', desc: '', created: 0 }];
  const r = E.createPlan(db, {
    goal_id: 'g1', title: 'p', budget: null,
    default_expenses: [{ resource_id: 'r1', amount: 2 }, { resource_id: 'r2', amount: 1 }],
    default_incomes: [{ resource_id: 'r1', amount: 1 }],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(db.plans[0].default_expenses, [
    { resource_id: 'r1', amount: 2, note: '' },
    { resource_id: 'r2', amount: 1, note: '' },
  ]);
  assert.deepEqual(db.plans[0].default_incomes, [{ resource_id: 'r1', amount: 1, note: '' }]);
  const p = db.plans[0];
  const ru = E.updatePlan(db, p.id, { goal_id: 'g1', title: 'p', budget: null, default_expenses: [{ resource_id: 'r1', amount: 9 }] });
  assert.equal(ru.ok, true);
  assert.equal(db.plans[0].default_expenses[0].amount, 9);
});

// ---- 循环衍生继承 ----
test('preset: 循环系列保留预设收支，完成一期推进后仍可用预设', () => {
  const db = freshDB();
  E.createActivity(db, {
    title: '每日', planned_date: '2026-8-20', repeat: 'daily', planned_minutes: 30,
    preset_expenses: [{ resource_id: 'r1', amount: 1 }, { resource_id: 'r2', amount: 30 }],
    preset_incomes: [{ resource_id: 'r2', amount: 2 }],
  });
  const a = db.activities[0];
  E.startActivity(db, a.id);
  const r = E.completeActivity(db, a.id, { expense: { resource_id: 'r1', amount: 1 }, output_title: 'o' });
  assert.equal(r.advanced, true); // 推进到下一期，仍是同一条活动
  // 系列保留预设收支
  assert.deepEqual(a.preset_expenses, [{ resource_id: 'r1', amount: 1, note: '' }, { resource_id: 'r2', amount: 30, note: '' }]);
  assert.deepEqual(a.preset_incomes, [{ resource_id: 'r2', amount: 2, note: '' }]);
});

// ---- 一键完成（多资源）----
test('quickCompletePreset: 无预设拒绝', () => {
  const db = freshDB();
  E.createActivity(db, { title: 't' });
  const id = db.activities[0].id;
  E.startActivity(db, id);
  const r = E.quickCompletePreset(db, id);
  assert.equal(r.ok, false);
});

test('quickCompletePreset: 多资源预设入账满足不变量2，余额正确', () => {
  const db = freshDB();
  E.createActivity(db, {
    title: '写稿',
    preset_expenses: [{ resource_id: 'r1', amount: 10 }, { resource_id: 'r2', amount: 60 }],
    preset_incomes: [{ resource_id: 'r1', amount: 5 }],
  });
  const id = db.activities[0].id;
  E.startActivity(db, id);
  const r = E.quickCompletePreset(db, id);
  assert.equal(r.ok, true);
  assert.equal(r.summary.expenses.length, 2);
  assert.equal(r.summary.incomes.length, 1);
  assert.equal(r.summary.output_title, '写稿');
  assert.equal(db.activities[0].status, 'Completed');
  assert.equal(E.activityHasTx(db, id), true);
  assert.equal(E.activityHasOutput(db, id), true);
  const out = db.outputs.find((o) => o.activity_id === id);
  assert.equal(out.title, '写稿');
  // 不变量1：r1 = 100-10+5 = 95；r2 = 0-60 = -60
  assert.equal(E.balanceOf(db, 'r1'), 95);
  assert.equal(E.balanceOf(db, 'r2'), -60);
  // 多笔流水：2 支出 + 1 收入
  const actTxs = db.txs.filter((t) => t.source_type === 'activity' && t.source_id === id && !t.reversal_of);
  assert.equal(actTxs.length, 3);
});

test('quickCompletePreset: 仅预设支出也可完成', () => {
  const db = freshDB();
  E.createActivity(db, { title: 't', preset_expenses: [{ resource_id: 'r2', amount: 3 }] });
  const id = db.activities[0].id;
  E.startActivity(db, id);
  const r = E.quickCompletePreset(db, id);
  assert.equal(r.ok, true);
  assert.equal(db.activities[0].status, 'Completed');
  assert.equal(E.balanceOf(db, 'r2'), -3);
});

// ---- 改账（多资源冲正语义）----
test('amendActivityLedger: 多资源冲正重记后余额净正确，原单留痕', () => {
  const db = freshDB();
  E.createActivity(db, {
    title: 't',
    preset_expenses: [{ resource_id: 'r1', amount: 10 }, { resource_id: 'r2', amount: 5 }],
  });
  const id = db.activities[0].id;
  E.startActivity(db, id);
  E.quickCompletePreset(db, id);
  assert.equal(E.balanceOf(db, 'r1'), 90);
  assert.equal(E.balanceOf(db, 'r2'), -5);
  // 改为 支出 r1=6 + 收入 r3=3
  const r = E.amendActivityLedger(db, id, {
    expenses: [{ resource_id: 'r1', amount: 6 }],
    incomes: [{ resource_id: 'r3', amount: 3 }],
  });
  assert.equal(r.ok, true);
  // r1: 90 + 10(冲正) - 6 = 94；r2: -5 + 5(冲正) = 0；r3: 50 + 3 = 53
  assert.equal(E.balanceOf(db, 'r1'), 94);
  assert.equal(E.balanceOf(db, 'r2'), 0);
  assert.equal(E.balanceOf(db, 'r3'), 53);
  // 冲正留痕
  const revs = db.txs.filter((t) => t.source_type === 'reversal');
  assert.ok(revs.length >= 2);
  assert.equal(revs.some((t) => t.note.includes('改账冲正')), true);
  assert.equal(E.activityHasTx(db, id), true);
  assert.equal(E.activityHasOutput(db, id), true);
});

test('amendActivityLedger: 非 Completed 拒绝 / 全空拒绝', () => {
  const db = freshDB();
  E.createActivity(db, { title: 't', preset_expenses: [{ resource_id: 'r1', amount: 10 }] });
  const id = db.activities[0].id;
  assert.equal(E.amendActivityLedger(db, id, { expenses: [{ resource_id: 'r1', amount: 5 }] }).ok, false); // 未开始
  E.startActivity(db, id);
  assert.equal(E.amendActivityLedger(db, id, { expenses: [], incomes: [] }).ok, false); // Started 也拒
  E.quickCompletePreset(db, id);
  assert.equal(E.amendActivityLedger(db, id, { expenses: [], incomes: [] }).ok, false); // 全空
});

// ---- 自动失败（AutoPilot F5，修复超时未失败）----
test('autoFail: 非循环 Started 超时超宽限 → re-init 回 Planned 可重试', async () => {
  const { AutoPilot } = await import('../src/services/autoPilot.js');
  const db = freshDB();
  const now = msOf('2026-8-21T10:00');
  E.createActivity(db, { title: 't', planned_start: '2026-8-21T09:00', planned_minutes: 10 });
  const id = db.activities[0].id;
  E.startActivity(db, id);
  db.activities[0].actual_start = now - 41 * 60000; // 超时 31 分钟 > 宽限 30
  const scan = scanDueEvents(db, now);
  assert.equal(scan.overtime.length, 1);
  AutoPilot._autoFail({ db, engine: E }, scan);
  assert.equal(db.activities[0].status, 'Planned'); // 非循环 re-init
  assert.equal(db.activities[0].retryCount, 1);
  assert.equal(db.activities[0].failedReason, null);
});

test('autoFail: 未超宽限不失败；循环超时 → 标记 skipped + 推进（不衍生副本）', async () => {
  const { AutoPilot } = await import('../src/services/autoPilot.js');
  const db = freshDB();
  const now = msOf('2026-8-21T10:00');
  // 未超宽限（超 10 分钟）
  E.createActivity(db, { title: 'a', planned_start: '2026-8-21T09:00', planned_minutes: 10 });
  const id1 = db.activities[0].id;
  E.startActivity(db, id1);
  db.activities[0].actual_start = now - 20 * 60000; // 超 10 分钟 < 宽限 30
  let scan = scanDueEvents(db, now);
  AutoPilot._autoFail({ db, engine: E }, scan);
  assert.equal(db.activities[0].status, 'Started');
  // 循环超宽限：标记 skipped + 推进到下一期，列表仍 1 条
  E.createActivity(db, { title: '每日', planned_date: '2026-8-20', repeat: 'daily', planned_minutes: 10 });
  const a2 = db.activities[1];
  E.startActivity(db, a2.id);
  db.activities[1].actual_start = now - 41 * 60000; // 超 31 分钟
  scan = scanDueEvents(db, now);
  AutoPilot._autoFail({ db, engine: E }, scan);
  assert.equal(a2.occurrences[0].status, 'skipped');
  assert.equal(a2.status, 'Planned'); // 推进回 Planned（重试下一期）
  assert.equal(db.activities.length, 2); // 不衍生副本
});

// ---- 旧库 normalize：单资源 → 多资源数组 ----
test('normalizeDB: v2 单资源预设迁移为多资源数组', () => {
  const legacy = {
    schemaVersion: 2,
    resources: [{ id: 'r1', name: 'x', initial: 0, status: 'Active', created: 0 }],
    rules: [], goals: [], txs: [], outputs: [], valueflows: [], goods: [],
    plans: [{ id: 'p1', goal_id: null, title: 'p', budget: null, color: null, status: 'Incubating', created: 0, default_expense: { resource_id: 'r1', amount: 2 } }],
    activities: [{ id: 'a1', title: 't', note: '', plan_ids: [], planned_date: null, planned_start: null, planned_minutes: 0, repeat: null, repeat_until: null, time_logs: [], theme: null, preset_expense: { resource_id: 'r1', amount: 3 }, conflicts: [], actual_start: null, actual_end: null, status: 'Planned', created: 0 }],
  };
  normalizeDB(legacy);
  assert.equal(legacy.schemaVersion, 3);
  // 迁移仅做包装（保留原字段），不补 note
  assert.equal(legacy.plans[0].default_expenses.length, 1);
  assert.equal(legacy.plans[0].default_expenses[0].resource_id, 'r1');
  assert.equal(legacy.plans[0].default_expenses[0].amount, 2);
  assert.equal(legacy.activities[0].preset_expenses.length, 1);
  assert.equal(legacy.activities[0].preset_expenses[0].resource_id, 'r1');
  assert.equal(legacy.activities[0].preset_expenses[0].amount, 3);
  assert.equal('default_expense' in legacy.plans[0], false);
  assert.equal('preset_expense' in legacy.activities[0], false);
});

test('normalizeDB: v0 旧库计划/活动补空数组预设', () => {
  const legacy = {
    resources: [], rules: [], goals: [], txs: [], outputs: [], valueflows: [], goods: [],
    plans: [{ id: 'p1', goal_id: null, title: 'p', budget: null, color: null, status: 'Incubating', created: 0 }],
    activities: [{ id: 'a1', title: 't' }],
  };
  normalizeDB(legacy);
  assert.deepEqual(legacy.plans[0].default_expenses, []);
  assert.deepEqual(legacy.plans[0].default_incomes, []);
  assert.deepEqual(legacy.activities[0].preset_expenses, []);
  assert.deepEqual(legacy.activities[0].preset_incomes, []);
});

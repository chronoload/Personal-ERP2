// ============================================================
// tests/engine_fixes.test.js
// 引擎修复回归（对应 docs/perp-project/verify/probe_time.mjs 的 BUG 用例）：
// B1 跨午夜空闲槽 / B2 兜底不重叠 / B3·B4 删除不留孤儿捆绑 / B5 仲裁剪陈旧 /
// B6 离开时间线解除全部捆绑 / B7·B8 入口时间校验。F-S5 快进因与受保护
// domain.test.js 语义冲突而搁置（见交付报告），故此处不含快进用例。
// 运行：npm test
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedDB } from '../src/store/db.js';
import * as E from '../src/domain/engine.js';

function freshDB() {
  const db = seedDB();
  db.resources = [{ id: 'r1', name: 'Token', unit: 'Token', initial: 100, status: 'Active', created: 0 }];
  db.rules = []; db.goals = []; db.plans = []; db.activities = []; db.txs = []; db.outputs = []; db.valueflows = []; db.goods = [];
  db.seq = { r: 1, ru: 0, g: 0, p: 0, a: 0, t: 0, o: 0, v: 0, gd: 0 };
  return db;
}

const mk = (db, ps, mins, keep = false, title = 'x') =>
  E.createActivity(db, { title, plan_ids: [], planned_start: ps, planned_minutes: mins, keep_conflict: keep });

// ---- B3：deleteActivity 不留孤儿冲突 id ----
test('B3 删除活动后幸存者 conflicts 清空', () => {
  const db = freshDB();
  mk(db, '2026-08-25T09:00', 60, true, 'A');
  mk(db, '2026-08-25T09:30', 60, true, 'B'); // 双向捆绑
  assert.equal(E.deleteActivity(db, db.activities[1].id).ok, true);
  assert.deepEqual(db.activities[0].conflicts, []);
});

// ---- B4：级联删除同样清理幸存者捆绑 ----
test('B4 deleteActivityCascade 不留孤儿冲突 id', () => {
  const db = freshDB();
  mk(db, '2026-08-25T09:00', 60, true, 'A');
  mk(db, '2026-08-25T09:30', 60, true, 'B');
  assert.equal(E.deleteActivityCascade(db, db.activities[1].id).ok, true);
  assert.deepEqual(db.activities[0].conflicts, []);
});

test('B4 deletePlanCascade / deleteGoalCascade 链式删除时清理幸存者捆绑', () => {
  const build = () => {
    const db = freshDB();
    E.createGoal(db, { title: 'g', desc: '' });
    E.createPlan(db, { goal_id: db.goals[0].id, title: 'p', budget: null });
    mk(db, '2026-08-25T09:00', 60, true, 'A');
    mk(db, '2026-08-25T09:30', 60, true, 'B'); // 唯一挂计划 → 随计划级联删
    db.activities[1].plan_ids = [db.plans[0].id];
    return db;
  };
  const db1 = build();
  E.deletePlanCascade(db1, db1.plans[0].id);
  assert.equal(db1.activities.length, 1);
  assert.deepEqual(db1.activities[0].conflicts, []);

  const db2 = build();
  E.deleteGoalCascade(db2, db2.goals[0].id);
  assert.equal(db2.activities.length, 1);
  assert.deepEqual(db2.activities[0].conflicts, []);
});

// ---- B5：'first' 仲裁剪除第三方陈旧捆绑 ----
test("B5 仲裁'first' 后被挪对手的第三方捆绑被剪除且互不重叠", () => {
  const db = freshDB();
  mk(db, '2026-08-25T09:00', 120, true, 'A'); // 09:00-11:00，与 B、C 都重叠
  mk(db, '2026-08-25T09:30', 60, true, 'B');
  mk(db, '2026-08-25T10:00', 60, true, 'C');
  const r = E.startActivity(db, db.activities[0].id, { override: 'first' });
  assert.equal(r.ok, true);
  assert.equal(db.activities[0].status, 'Started');
  const b = db.activities[1], c = db.activities[2];
  assert.deepEqual(b.conflicts, []);
  assert.deepEqual(c.conflicts, []);
  const wb = E.activityWindow(b), wc = E.activityWindow(c);
  assert.ok(!(wb.start < wc.end && wc.start < wb.end), 'B 与 C 挪走后不应再重叠');
});

// ---- B6：完成/兜底离开时间线即解除全部捆绑 ----
test('B6 completeActivity 后对手 conflicts 清空（UI ⚠ 不再永挂）', () => {
  const db = freshDB();
  mk(db, '2026-08-25T09:00', 60, false, 'A');
  E.startActivity(db, db.activities[0].id); // A 先开始
  mk(db, '2026-08-25T09:30', 60, true, 'B'); // 与进行中的 A 重叠 → 捆绑
  const a = db.activities[0], b = db.activities[1];
  assert.deepEqual(b.conflicts, [a.id]); // 前置：捆绑已建立
  const r = E.completeActivity(db, a.id, { expense: { resource_id: 'r1', amount: 1 }, output_title: 'o' });
  assert.equal(r.ok, true);
  assert.deepEqual(a.conflicts, []);
  assert.deepEqual(b.conflicts, []);
});

test('B6 setActivityStatus 兜底落 Completed 同样解除全部捆绑', () => {
  const db = freshDB();
  mk(db, '2026-08-25T09:00', 60, false, 'A');
  const a = db.activities[0];
  E.startActivity(db, a.id);
  mk(db, '2026-08-25T09:30', 60, true, 'B');
  assert.deepEqual(a.conflicts.length, 1); // 前置：捆绑已建立
  // 手工满足不变量2 兜底校验
  db.txs.push({ id: 't9', resource_id: 'r1', debit: 0, credit: 1, source_type: 'activity', source_id: a.id, reversal_of: null, created: 0 });
  db.outputs.push({ id: 'o9', title: 'o', tags: [], note: '', status: 'Draft', activity_id: a.id, created: 0 });
  assert.equal(E.setActivityStatus(db, a.id, 'Completed').ok, true);
  assert.deepEqual(a.conflicts, []);
  assert.deepEqual(db.activities[1].conflicts, []);
});

// ---- B1：跨午夜时长同晚可放 ----
test('B1 23:30+60m 在 22:00-23:15 占块之后同晚直接放下（跨午夜不再拒绝）', () => {
  const db = freshDB();
  mk(db, '2026-08-25T22:00', 75, false, '早场'); // 22:00-23:15
  const r = mk(db, '2026-08-25T23:30', 60, false, '夜场'); // 期望点空闲 → 同晚原样采用
  const n = db.activities[1];
  assert.equal(r.shifted, undefined);
  assert.equal(n.planned_start, '2026-08-25T23:30');
  const w = E.activityWindow(n), w0 = E.activityWindow(db.activities[0]);
  assert.ok(!(w.start < w0.end && w0.start < w.end));
});

// ---- B2：极端连堵后兜底落点与任何占块不重叠 ----
test('B2 连堵33天后投同刻活动，落点与所有占块均不重叠', () => {
  const db = freshDB();
  const base = new Date(2026, 7, 25);
  for (let i = 0; i < 33; i++) {
    mk(db, `${base.getFullYear()}-${base.getMonth() + 1}-${base.getDate()}T23:45`, 60, false, 'blk' + i); // 各自跨午夜互不重叠
    base.setDate(base.getDate() + 1);
  }
  const r = mk(db, '2026-08-25T23:45', 60, false, 'NEW');
  assert.equal(r.ok, true);
  const nu = db.activities[db.activities.length - 1];
  const wn = E.activityWindow(nu);
  const clash = db.activities.some((x) => {
    if (x === nu) return false;
    const w = E.activityWindow(x);
    return !!w && wn.start < w.end && w.start < wn.end;
  });
  assert.equal(clash, false);
});

// ---- B7/B8：入口时间校验 ----
test('B7 入口拒绝语义非法时间（hour25/min70/Feb30/分钟个位/残缺格式）', () => {
  const db = freshDB();
  const r0 = E.createActivity(db, { title: 'A', plan_ids: [], planned_start: '2026-08-25T08:00', planned_minutes: 30 });
  assert.equal(r0.ok, true);
  const a = db.activities[0];
  for (const bad of ['2026-08-25T25:70', '2026-08-25T09:5', '2026-2-30T09:00', '2026-08-25T09:00:00', 'garbage']) {
    const r = E.createActivity(db, { title: 'x', plan_ids: [], planned_start: bad, planned_minutes: 30 });
    assert.equal(r.ok, false, `createActivity 应拒绝 ${bad}`);
    assert.match(String(r.error), /计划时间无效/);
    const u = E.updateActivity(db, a.id, { title: 'A', note: '', planned_start: bad });
    assert.equal(u.ok, false, `updateActivity 应拒绝 ${bad}`);
    assert.match(String(u.error), /计划时间无效/);
  }
  assert.equal(db.activities.length, 1); // 被拒活动均未入库
  assert.equal(a.planned_start, '2026-08-25T08:00'); // 拒绝不破坏既有数据
});

test('B8 合法非补零时间放行；缺省 planned_start 的更新不擦除既有数据；显式清空仍合法', () => {
  const db = freshDB();
  const r = E.createActivity(db, { title: 'A', plan_ids: [], planned_start: '2026-8-23T07:30', planned_minutes: 30 });
  assert.equal(r.ok, true);
  const a = db.activities[0];
  const u = E.updateActivity(db, a.id, { title: 'A', note: '', plan_ids: [], planned_minutes: 45 }); // 未触碰时间字段
  assert.equal(u.ok, true);
  assert.equal(a.planned_start, '2026-8-23T07:30');
  assert.equal(a.planned_date, '2026-8-23');
  assert.equal(a.planned_end, '2026-08-23T08:15');
  E.updateActivity(db, a.id, { title: 'A', note: '', plan_ids: [], planned_start: '' }); // 显式清空
  assert.equal(a.planned_start, null);
  assert.equal(a.planned_date, null);
});

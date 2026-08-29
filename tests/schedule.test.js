// ============================================================
// tests/schedule.test.js
// 日程扫描单元测试：整点取整 / 到期事件 / 提醒 / 超时 / 已结束 / 顺延
// 运行：npm test  (node --test)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedDB } from '../src/store/db.js';
import * as E from '../src/domain/engine.js';
import * as S from '../src/domain/schedule.js';

// 最小化的干净库（独立于演示数据，夹具手法同 domain.test.js）
function freshDB() {
  const db = seedDB();
  db.resources = [{ id: 'r1', name: 'Token', unit: 'Token', initial: 100, status: 'Active', created: 0 }];
  db.rules = []; db.goals = []; db.plans = []; db.activities = []; db.txs = []; db.outputs = []; db.valueflows = []; db.goods = [];
  db.seq = { r: 1, ru: 0, g: 0, p: 0, a: 0, t: 0, o: 0, v: 0, gd: 0 };
  return db;
}

// 'YYYY-MM-DDTHH:MM' → 本地毫秒时间戳（测试专用手工解析，避免时区歧义）
const msOf = (s) => {
  const m = s.match(/^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
};

// 造一个 Started 活动并固定其实际起点（摆脱真实时钟）
function seedStarted(db, title, startStr, minutes, actualStartMs) {
  E.createActivity(db, { title, planned_start: startStr, planned_minutes: minutes });
  const a = db.activities.find((x) => x.title === title);
  E.startActivity(db, a.id);
  a.actual_start = actualStartMs;
  return a;
}

// ---- roundUp5：向上取整到 5 分钟格点 ----
test('roundUp5：分钟向上进位到下一个 5 分钟格点', () => {
  assert.equal(S.roundUp5(msOf('2026-08-21T14:01')), '2026-08-21T14:05');
  assert.equal(S.roundUp5(msOf('2026-08-21T14:04')), '2026-08-21T14:05');
  // 表单预填别名同款行为
  assert.equal(S.defaultStartPrefill(msOf('2026-08-21T14:03')), '2026-08-21T14:05');
});

test('roundUp5：恰在格点上保持不变', () => {
  assert.equal(S.roundUp5(msOf('2026-08-21T14:00')), '2026-08-21T14:00');
  assert.equal(S.roundUp5(msOf('2026-08-21T14:55')), '2026-08-21T14:55');
});

test('roundUp5：跨小时与跨日纯数学进位', () => {
  assert.equal(S.roundUp5(msOf('2026-08-21T14:56')), '2026-08-21T15:00');
  assert.equal(S.roundUp5(msOf('2026-08-21T23:55')), '2026-08-21T23:55'); // 格点上不跨日
  assert.equal(S.roundUp5(msOf('2026-08-21T23:58')), '2026-08-22T00:00'); // ≥23:56 → 次日零点
});

// ---- scanDueEvents.dueStarts：今日已到期且无阻碍的 Planned ----
test('dueStarts：今天已过开始时间的 Planned 计入', () => {
  const db = freshDB();
  E.createActivity(db, { title: '晨读', planned_start: '2026-08-21T08:00', planned_minutes: 30 });
  const a = db.activities[0];
  const r = S.scanDueEvents(db, msOf('2026-08-21T09:00'));
  assert.deepEqual(r.dueStarts, [{ id: a.id, title: '晨读' }]);
  assert.deepEqual(r.skipped, []);
});

test('dueStarts：弹性活动（无开始时间或零时长）不计入', () => {
  const db = freshDB();
  E.createActivity(db, { title: '弹性', planned_date: '2026-8-21' });
  E.createActivity(db, { title: '零时长', planned_start: '2026-08-21T08:00', planned_minutes: 0 });
  const r = S.scanDueEvents(db, msOf('2026-08-21T09:00'));
  assert.deepEqual(r.dueStarts, []);
  assert.deepEqual(r.skipped, []);
});

test('dueStarts：捆绑对手仍在排 → 进 skipped(conflict)，对手正常计入', () => {
  const db = freshDB();
  E.createActivity(db, { title: 'A', planned_start: '2026-08-21T10:00', planned_minutes: 60 });
  E.createActivity(db, { title: 'B', planned_start: '2026-08-21T10:30', planned_minutes: 30, keep_conflict: true });
  const a = db.activities.find((x) => x.title === 'A');
  const b = db.activities.find((x) => x.title === 'B');
  a.conflicts = [b.id]; b.conflicts = []; // 单向捆绑，镜像 startActivity 仲裁读取的形态
  const r = S.scanDueEvents(db, msOf('2026-08-21T10:30'));
  assert.deepEqual(r.skipped, [{ id: a.id, title: 'A', reason: 'conflict' }]);
  assert.deepEqual(r.dueStarts, [{ id: b.id, title: 'B' }]);
});

test('dueStarts：关联计划预算耗尽 → 进 skipped(budget)', () => {
  const db = freshDB();
  E.createGoal(db, { title: 'g', desc: '' });
  E.createPlan(db, { goal_id: db.goals[0].id, title: 'p', budget: 10 });
  const pid = db.plans[0].id;
  // 先用一笔完成活动打满预算（夹具手法同 domain.test.js 不变量4）
  E.createActivity(db, { title: '烧钱', note: '', plan_ids: [pid] });
  E.startActivity(db, db.activities[0].id);
  assert.equal(E.quickComplete(db, db.activities[0].id, { expense: { resource_id: 'r1', amount: 10 }, outputTitle: 'o' }).ok, true);
  // 待扫活动挂在已冻结的计划上
  E.createActivity(db, { title: '受阻', note: '', plan_ids: [pid], planned_start: '2026-08-21T08:00', planned_minutes: 30 });
  const a = db.activities[1];
  const r = S.scanDueEvents(db, msOf('2026-08-21T09:00'));
  assert.deepEqual(r.skipped, [{ id: a.id, title: '受阻', reason: 'budget' }]);
  assert.deepEqual(r.dueStarts, []);
});

test('dueStarts：昨日逾期不补扫（追办仅限同一本地日）', () => {
  const db = freshDB();
  E.createActivity(db, { title: '昨日欠账', planned_start: '2026-08-20T08:00', planned_minutes: 30 });
  const r = S.scanDueEvents(db, msOf('2026-08-21T09:00'));
  assert.deepEqual(r.dueStarts, []);
  assert.deepEqual(r.skipped, []);
});

test('dueStarts/skipped：Completed 与 Started 均不出现', () => {
  const db = freshDB();
  seedStarted(db, '进行中', '2026-08-21T08:00', 30, msOf('2026-08-21T08:00'));
  E.createActivity(db, { title: '已完成', planned_start: '2026-08-21T07:00', planned_minutes: 30 });
  E.startActivity(db, db.activities[1].id);
  E.quickComplete(db, db.activities[1].id, { expense: { resource_id: 'r1', amount: 5 }, outputTitle: 'o' });
  const r = S.scanDueEvents(db, msOf('2026-08-21T09:00'));
  assert.deepEqual(r.dueStarts, []);
  assert.deepEqual(r.skipped, []);
});

// ---- scanDueEvents.preRemind：临近开始的提醒窗 [start-remind, start) ----
test('preRemind：进入提醒窗即返回并携带 atMs', () => {
  const db = freshDB();
  E.createActivity(db, { title: '站会', planned_start: '2026-08-21T10:00', planned_minutes: 15 });
  const a = db.activities[0];
  const r = S.scanDueEvents(db, msOf('2026-08-21T09:50')); // 09:45 起进入窗口
  assert.deepEqual(r.preRemind, [{ id: a.id, title: '站会', atMs: msOf('2026-08-21T09:45') }]);
  assert.deepEqual(r.dueStarts, []);
});

test('preRemind：过早 / 已到开始时刻均不提醒', () => {
  const db = freshDB();
  E.createActivity(db, { title: '站会', planned_start: '2026-08-21T10:00', planned_minutes: 15 });
  assert.deepEqual(S.scanDueEvents(db, msOf('2026-08-21T09:44')).preRemind, []);
  // 到点即转为到期，不再属于「即将开始」
  const r = S.scanDueEvents(db, msOf('2026-08-21T10:00'));
  assert.deepEqual(r.preRemind, []);
  assert.deepEqual(r.dueStarts.map((x) => x.title), ['站会']);
});

test('preRemind：自定义 remindBeforeMin 生效', () => {
  const db = freshDB();
  E.createActivity(db, { title: '深潜', planned_start: '2026-08-21T10:00', planned_minutes: 60 });
  const a = db.activities[0];
  const r = S.scanDueEvents(db, msOf('2026-08-21T09:40'), { remindBeforeMin: 30 });
  assert.deepEqual(r.preRemind, [{ id: a.id, title: '深潜', atMs: msOf('2026-08-21T09:30') }]);
});

// ---- scanDueEvents.overtime：进行中超时 ----
test('overtime：超过 实际开始+时长 即超时，overMin 为整分钟数', () => {
  const db = freshDB();
  const a = seedStarted(db, '专注', '2026-08-21T08:00', 60, msOf('2026-08-21T08:00'));
  const r = S.scanDueEvents(db, msOf('2026-08-21T09:30')); // 实际起点 08:00 + 60min → 09:00 起超时
  assert.deepEqual(r.overtime, [{ id: a.id, title: '专注', overMin: 30 }]);
});

test('overtime：恰好抵达时长边界不算超时（严格大于）', () => {
  const db = freshDB();
  seedStarted(db, '专注', '2026-08-21T08:00', 60, msOf('2026-08-21T09:00'));
  const r = S.scanDueEvents(db, msOf('2026-08-21T10:00'));
  assert.deepEqual(r.overtime, []);
});

test('overtime：零时长 / 非 Started 一概不计', () => {
  const db = freshDB();
  E.createActivity(db, { title: '无时长', planned_start: '2026-08-21T08:00', planned_minutes: 0 });
  const z = db.activities[0];
  E.startActivity(db, z.id);
  z.actual_start = msOf('2026-08-21T07:00');
  E.createActivity(db, { title: '未开始', planned_start: '2026-08-21T08:00', planned_minutes: 30 });
  const r = S.scanDueEvents(db, msOf('2026-08-21T09:00'));
  assert.deepEqual(r.overtime, []);
});

// ---- scanDueEvents.ended：进行中但计划时段已过 ----
test('ended：Started 且 planned_end 已过计入，未来时段不计', () => {
  const db = freshDB();
  const a = seedStarted(db, '过期场', '2026-08-21T08:00', 60, msOf('2026-08-21T09:00'));
  seedStarted(db, '未来场', '2026-08-21T12:00', 60, msOf('2026-08-21T09:00'));
  const r = S.scanDueEvents(db, msOf('2026-08-21T09:30'));
  assert.deepEqual(r.ended, [{ id: a.id, title: '过期场' }]);
});

// ---- engine.rescheduleStarted：Started 活动的窗口整体搬移 ----
test('rescheduleStarted：窗口搬到 now 并推算结束与计划日期', () => {
  const db = freshDB();
  E.createActivity(db, { title: '迁移', planned_start: '2026-08-21T08:00', planned_minutes: 60 });
  const a = db.activities[0];
  E.startActivity(db, a.id);
  const r = E.rescheduleStarted(db, a.id, { now: msOf('2026-08-21T14:20') });
  assert.equal(r.ok, true);
  assert.equal(r.moved_to, '2026-08-21T14:20');
  assert.equal(a.planned_start, '2026-08-21T14:20');
  assert.equal(a.planned_end, '2026-08-21T15:20');
  assert.equal(a.planned_date, '2026-8-21');
});

test('rescheduleStarted：非 Started / 未找到 / 无时长均拒绝', () => {
  const db = freshDB();
  E.createActivity(db, { title: '未开始', planned_start: '2026-08-21T08:00', planned_minutes: 60 });
  assert.equal(E.rescheduleStarted(db, db.activities[0].id, { now: msOf('2026-08-21T09:00') }).ok, false);
  assert.equal(E.rescheduleStarted(db, 'aX', {}).ok, false);
  E.createActivity(db, { title: '无时长', planned_minutes: 0 });
  const z = db.activities[1];
  E.startActivity(db, z.id);
  const rz = E.rescheduleStarted(db, z.id, {});
  assert.equal(rz.ok, false);
  assert.ok(String(rz.error).includes('无时长不可顺延'));
});

test('rescheduleStarted：目标槽被占 → 原子性再次顺延到空闲槽', () => {
  const db = freshDB();
  E.createActivity(db, { title: '占位者', planned_start: '2026-08-21T10:00', planned_minutes: 60 }); // 10:00–11:00
  E.createActivity(db, { title: '早鸟', planned_start: '2026-08-21T08:00', planned_minutes: 60 });
  const bird = db.activities.find((x) => x.title === '早鸟');
  E.startActivity(db, bird.id);
  const r = E.rescheduleStarted(db, bird.id, { now: msOf('2026-08-21T10:30') }); // 正撞占位者
  assert.equal(r.ok, true);
  assert.equal(bird.planned_start, '2026-08-21T11:00');
  assert.equal(bird.planned_end, '2026-08-21T12:00');
  assert.equal(r.moved_to, '2026-08-21T11:00');
});

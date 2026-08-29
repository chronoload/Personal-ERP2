// ============================================================
// tests/recurrence_probe.test.js
// 循环活动探针（2026-08-29：系列容器 + 期次数组模型）：
//   - 一条活动 = 一个循环，内部 occurrences[] 存全部期次；
//   - 列表/日历只出现这一条（不生成 N 份副本）；
//   - 完成/失败一期 → 标记该期次并推进到下一 pending 期次（planned_date 原地滚动）；
//   - weekday 跳过周末由 nextOccurrenceDate 处理；extendRecurrence 追加期次。
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedDB } from '../src/store/db.js';
import * as E from '../src/domain/engine.js';
import { scanDueEvents } from '../src/domain/schedule.js';

function freshDB() {
  const db = seedDB();
  db.resources = [{ id: 'r1', name: 'Token', unit: 'Token', initial: 100, status: 'Active', created: 0 }];
  db.rules = []; db.goals = []; db.plans = []; db.activities = []; db.txs = []; db.outputs = []; db.valueflows = []; db.goods = [];
  db.seq = { r: 1, ru: 0, g: 0, p: 0, a: 0, t: 0, o: 0, v: 0, gd: 0 };
  return db;
}

const msOf = (s) => {
  const m = s.match(/^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
};

// ---- S1：系列容器，1 条活动存全部期次 ----
test('S1 系列容器：创建循环只生成 1 条活动，期次存 occurrences[]', () => {
  const db = freshDB();
  E.createActivity(db, { title: '晨读', planned_start: '2026-08-23T07:30', planned_minutes: 30, repeat: 'daily' });
  assert.equal(db.activities.length, 1); // 不再生成 N 份副本
  const a = db.activities[0];
  assert.equal(a.occurrences.length, 30); // 无 until 默认 30 期
  assert.equal(a.occurrences[0].date, '2026-8-23');
  assert.equal(a.occurrences[1].date, '2026-8-24');
  assert.equal(a.planned_date, '2026-8-23'); // 当前期
  const w = E.activityWindow(a);
  assert.equal(w.start, msOf('2026-8-23T07:30'));
  assert.equal(w.end, w.start + 30 * 60000);
});

// ---- S2：repeat_until 边界（dateKey 归一化）期次到边界为止 ----
test('S2 探针：repeat_until 边界（dateKey 归一化）期次到边界为止', () => {
  const db = freshDB();
  E.createActivity(db, { title: '打卡', planned_date: '2026-9-9', repeat: 'daily', repeat_until: '2026-09-10' });
  assert.equal(db.activities.length, 1);
  assert.equal(db.activities[0].occurrences.length, 2); // 9-9 + 9-10，越界即停
  assert.equal(db.activities[0].occurrences[1].date, '2026-9-10');
});

// ---- S3：monthly 从月末出发 → 钳制到目标月最后一日 ----
test('S3 探针：monthly 1月31日钳制到2月28日，随后按28号推进', () => {
  assert.equal(E.nextOccurrenceDate('2026-1-31', 'monthly'), '2026-2-28');
  assert.equal(E.nextOccurrenceDate('2026-2-28', 'monthly'), '2026-3-28');
});

// ---- S4：weekday 期次全部落在工作日 ----
test('S4 探针：weekday 期次全部落在工作日', () => {
  assert.equal(E.nextOccurrenceDate('2026-8-21', 'weekday'), '2026-8-24'); // 周五(21)→周一(24)
  const db = freshDB();
  E.createActivity(db, { title: '工作日任务', planned_date: '2026-8-20', repeat: 'weekday', repeat_until: '2026-8-31' });
  const occs = db.activities[0].occurrences;
  const msOfDay = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
  for (const o of occs) { const dow = new Date(msOfDay(o.date)).getDay(); assert.ok(dow >= 1 && dow <= 5, `${o.date} 必须为工作日`); }
  assert.equal(occs.length, 8); // 8-20 + 8-21,24,25,26,27,28,31
  assert.equal(occs[occs.length - 1].date, '2026-8-31');
});

// ---- S5：完成一期 → 标记 done + 推进到下一期（列表仍 1 条）----
test('S5 回归：完成一期 → 标记 done + 推进到下一期（列表仍 1 条）', () => {
  const db = freshDB();
  E.createActivity(db, { title: '每日复盘', planned_date: '2026-8-10', repeat: 'daily', repeat_until: '2026-8-15' });
  const a = db.activities[0];
  assert.equal(db.activities.length, 1);
  E.startActivity(db, a.id);
  const r = E.completeActivity(db, a.id, { expense: { resource_id: 'r1', amount: 1 }, output_title: 'o' });
  assert.equal(r.ok, true);
  assert.equal(r.advanced, true);
  assert.equal(db.activities.length, 1); // 仍是 1 条
  assert.equal(a.status, 'Planned');      // 推进后回 Planned
  assert.equal(a.planned_date, '2026-8-11');
  assert.equal(a.occurrences[0].status, 'done');
  assert.equal(a.occurrences[1].status, 'pending');
  // 全部完成 → 系列终态
  let guard = 0;
  while (a.occurrences.some((o) => o.status === 'pending') && guard++ < 20) {
    E.startActivity(db, a.id);
    const rr = E.completeActivity(db, a.id, { expense: { resource_id: 'r1', amount: 1 }, output_title: 'o' });
    assert.equal(rr.ok, true);
    if (!rr.advanced) break;
  }
  assert.equal(a.occurrences.every((o) => o.status === 'done'), true);
  assert.equal(a.status, 'Completed'); // 系列完成终态
});

// ---- S6：setActivityStatus 兜底不推进期次 ----
test('S6 探针：setActivityStatus 兜底落 Completed 不推进期次', () => {
  const db = freshDB();
  E.createActivity(db, { title: '潜伏循环', planned_date: '2026-8-20', repeat: 'daily', repeat_until: '2026-8-22' });
  const a = db.activities[0];
  E.startActivity(db, a.id);
  db.txs.push({ id: 't9', resource_id: 'r1', debit: 0, credit: 1, source_type: 'activity', source_id: a.id, reversal_of: null, created: 0 });
  db.outputs.push({ id: 'o9', title: 'o', tags: [], note: '', status: 'Draft', activity_id: a.id, created: 0 });
  const r = E.setActivityStatus(db, a.id, 'Completed');
  assert.equal(r.ok, true);
  assert.equal(a.occurrences[0].status, 'pending'); // 兜底路径不标记不推进
  assert.equal(a.planned_date, '2026-8-20');
});

// ---- S7：系列容器保留业务字段与 theme ----
test('S7 探针：系列容器保留业务字段与 theme', () => {
  const db = freshDB();
  E.createActivity(db, { title: '带主题循环', note: '备注', planned_start: '2026-08-23T09:00', planned_minutes: 45, repeat: 'weekly', theme: { type: 'gradient', value: 'linear-gradient(x)' } });
  const a = db.activities[0];
  assert.equal(a.title, '带主题循环');
  assert.equal(a.note, '备注');
  assert.equal(a.planned_minutes, 45);
  assert.equal(a.repeat, 'weekly');
  assert.equal(a.planned_start, '2026-08-23T09:00'); // 保留输入格式（补零）
  assert.equal(a.theme.type, 'gradient');
  assert.equal(a.theme.value, 'linear-gradient(x)');
  assert.equal(a.occurrences[0].date, '2026-8-23');
  assert.equal(a.occurrences[1].date, '2026-8-30'); // weekly 推进
  assert.deepEqual(a.time_logs, []);
  assert.deepEqual(a.conflicts, []);
});

// ---- S8：跨日陈旧活动对 AutoPilot/scanDueEvents 不可见 ----
test('S8 探针：昨日过期的活动不在 dueStarts 扫描结果中', () => {
  const db = freshDB();
  E.createActivity(db, { title: '昨日克隆', planned_start: '2026-8-24T08:00', planned_minutes: 30 });
  const scan = scanDueEvents(db, msOf('2026-8-25T09:00'));
  assert.deepEqual(scan.dueStarts, []);
  assert.deepEqual(scan.skipped, []);
});

// ---- S9：extendRecurrence 追加期次并解除 until 上限 ----
test('S9 探针：extendRecurrence 追加期次并解除 until 上限', () => {
  const db = freshDB();
  E.createActivity(db, { title: '续期', planned_date: '2026-8-20', repeat: 'daily', repeat_until: '2026-8-22' });
  const a = db.activities[0];
  assert.equal(a.occurrences.length, 3);
  const r = E.extendRecurrence(db, a.id, 3);
  assert.equal(r.ok, true);
  assert.equal(r.spawned, 3);
  assert.equal(a.occurrences.length, 6);
  assert.equal(a.occurrences[5].date, '2026-8-25');
  assert.equal(a.repeat_until, null); // 扩期解除 until
  // 非循环拒绝续生成
  E.createActivity(db, { title: '单次', planned_date: '2026-8-20' });
  const r2 = E.extendRecurrence(db, db.activities[1].id);
  assert.equal(r2.ok, false);
});

// ---- S11：跳过单个期次（日历展开的未来期次用）----
test('S11 探针：skipOccurrence 跳过未来期次 / 当前期推进 / Started 拒绝', () => {
  const db = freshDB();
  E.createActivity(db, { title: '每日', planned_date: '2026-8-10', repeat: 'daily', repeat_until: '2026-8-12' });
  const a = db.activities[0];
  // 跳过未来期次（8-11）：只标记，不推进
  let r = E.skipOccurrence(db, a.id, '2026-8-11');
  assert.equal(r.ok, true);
  assert.equal(a.occurrences[1].status, 'skipped');
  assert.equal(a.planned_date, '2026-8-10'); // 当前期不动
  assert.equal(a.status, 'Planned');
  // 跳过当前期（8-10）：推进到下一 pending（8-12，因 8-11 已跳过）
  r = E.skipOccurrence(db, a.id, '2026-8-10');
  assert.equal(r.ok, true);
  assert.equal(a.occurrences[0].status, 'skipped');
  assert.equal(a.planned_date, '2026-8-12');
  // Started 的当前期拒绝跳过
  E.startActivity(db, a.id);
  r = E.skipOccurrence(db, a.id, '2026-8-12');
  assert.equal(r.ok, false);
  // 完成后该期次不可再跳过
  const rc = E.completeActivity(db, a.id, { expense: { resource_id: 'r1', amount: 1 }, output_title: 'o' });
  assert.equal(rc.advanced, false); // 全部期次处理完 → 系列终态
  assert.equal(a.occurrences[2].status, 'done');
  r = E.skipOccurrence(db, a.id, '2026-8-12');
  assert.equal(r.ok, false);
  // 非循环拒绝
  E.createActivity(db, { title: '单次', planned_date: '2026-8-10' });
  r = E.skipOccurrence(db, db.activities[1].id, '2026-8-10');
  assert.equal(r.ok, false);
});

// ---- S10：编辑清空时间 → 循环系列不悬空（回落首个 pending 期次）----
test('S10 探针：清空计划时间不产生「无当前期」悬空态', () => {
  const db = freshDB();
  E.createActivity(db, { title: '清空测试', planned_start: '2026-8-23T09:00', planned_minutes: 30, repeat: 'daily', repeat_until: '2026-8-25' });
  const a = db.activities[0];
  // 完成一期 → 推进到 8-24
  E.startActivity(db, a.id);
  E.completeActivity(db, a.id, { expense: { resource_id: 'r1', amount: 1 }, output_title: 'o' });
  assert.equal(a.planned_date, '2026-8-24');
  // 编辑清空开始时间 → planned_start 清空，planned_date 回落首个 pending 期次（不悬空）
  const r = E.updateActivity(db, a.id, { title: '清空测试', plan_ids: [], planned_start: '' });
  assert.equal(r.ok, true);
  assert.equal(a.planned_start, null);
  assert.equal(a.planned_date, '2026-8-24'); // 回落，而非 null
  // 显式清空 planned_date 同样回落
  const r2 = E.updateActivity(db, a.id, { title: '清空测试', plan_ids: [], planned_date: null });
  assert.equal(r2.ok, true);
  assert.equal(a.planned_date, '2026-8-24');
  // 非循环清空仍为 null（原语义不变）
  E.createActivity(db, { title: '单次', planned_start: '2026-8-23T09:00' });
  const b = db.activities[1];
  E.updateActivity(db, b.id, { title: '单次', plan_ids: [], planned_start: '' });
  assert.equal(b.planned_date, null);
});

// tests/agenda.test.js
// 日程积压与自动状态：autoStartDue / unscheduledActivities / overdueActivities
import test from 'node:test';
import assert from 'node:assert/strict';
import { autoStartDue, unscheduledActivities, overdueActivities } from '../src/domain/engine.js';

function mkDb(activities = []) {
  return {
    seq: {}, resources: [], rules: [], goals: [], plans: [], activities,
    txs: [], outputs: [], valueflows: [], goods: [], journals: [],
    places: [], commutes: [], templates: [], capitalLock: false,
  };
}

function act(over = {}) {
  return {
    id: 'a1', title: '任务', note: '', plan_ids: [], planned_date: null, planned_start: null,
    planned_minutes: 30, repeat: null, repeat_until: null, occurrences: [], time_logs: [],
    theme: null, place_id: null, depth: null, preset_expenses: [], preset_incomes: [],
    conflicts: [], actual_start: null, actual_end: null, status: 'Planned',
    failedReason: null, retryCount: 0, maxRetries: 3, created: 1,
    ...over,
  };
}

// 固定「现在」：2026-11-10 12:00 本地时间
const NOW = new Date(2026, 10, 10, 12, 0, 0).getTime();

test('autoStartDue：已过钟点的 Planned → Started', () => {
  const db = mkDb([act({ id: 'a1', planned_start: '2026-11-10T09:00' })]);
  const r = autoStartDue(db, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.equal(db.activities[0].status, 'Started');
  assert.equal(db.activities[0].actual_start, null, '不伪造实际开始计时');
});

test('autoStartDue：未来活动 / 已完成 / 无排期都不动', () => {
  const db = mkDb([
    act({ id: 'future', planned_start: '2026-11-10T18:00' }),
    act({ id: 'done', planned_start: '2026-11-10T09:00', status: 'Completed' }),
    act({ id: 'loose' }),
  ]);
  const r = autoStartDue(db, NOW);
  assert.equal(r.count, 0);
  assert.deepEqual(db.activities.map((a) => a.status), ['Planned', 'Completed', 'Planned']);
});

test('autoStartDue：跨天超期（昨天没做）也进入进行中', () => {
  const db = mkDb([
    act({ id: 'y1', planned_date: '2026-11-9' }),
    act({ id: 'y2', planned_start: '2026-11-8T20:00' }),
  ]);
  const r = autoStartDue(db, NOW);
  assert.equal(r.count, 2);
});

test('autoStartDue：幂等——第二次扫描不再变化', () => {
  const db = mkDb([act({ id: 'a1', planned_start: '2026-11-10T09:00' })]);
  assert.equal(autoStartDue(db, NOW).count, 1);
  assert.equal(autoStartDue(db, NOW).count, 0);
  assert.equal(db.activities[0].status, 'Started');
});

test('unscheduledActivities：只取 Planned 且无任何排期', () => {
  const db = mkDb([
    act({ id: 'u1' }),
    act({ id: 'u2', planned_minutes: 60 }),
    act({ id: 'dated', planned_date: '2026-11-11' }),
    act({ id: 'clocked', planned_start: '2026-11-11T09:00' }),
    act({ id: 'done', status: 'Completed' }),
  ]);
  const ids = unscheduledActivities(db).map((a) => a.id);
  assert.deepEqual(ids, ['u1', 'u2']);
});

test('overdueActivities：早于今天且未完成', () => {
  const db = mkDb([
    act({ id: 'old', planned_date: '2026-11-9' }),
    act({ id: 'oldClock', planned_start: '2026-11-10T08:00' }), // 今天，不算延留
    act({ id: 'today', planned_date: '2026-11-10' }),
    act({ id: 'future', planned_date: '2026-11-12' }),
    act({ id: 'done', planned_date: '2026-11-9', status: 'Completed' }),
    act({ id: 'failed', planned_date: '2026-11-9', status: 'Failed' }),
    act({ id: 'started', planned_date: '2026-11-9', status: 'Started' }),
  ]);
  const ids = overdueActivities(db, NOW).map((a) => a.id);
  assert.deepEqual(ids, ['old', 'started']);
});

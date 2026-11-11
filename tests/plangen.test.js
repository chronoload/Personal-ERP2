// tests/plangen.test.js —— 空闲窗派生 + 日表贪心生成（SPEC §3 §7）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveAvailWindows, generateDayPlan, defaultWorkWindows } from '../src/domain/plangen.js';
import { CHRONOTYPES } from '../src/domain/attention.js';

const at = (h, m = 0) => new Date(2026, 9, 19, h, m).getTime();
const DAY_START = new Date(2026, 9, 19, 0, 0).getTime();

function mkDb() {
  return {
    goals: [{ id: 'g1', title: '成书', status: 'Active' }],
    plans: [
      { id: 'p1', title: '写作', goal_id: 'g1', status: 'Active' },
      { id: 'p2', title: '健身', goal_id: null, status: 'Active' },
    ],
    places: [
      { id: 'home', name: '家' }, { id: 'office', name: '工位' }, { id: 'gym', name: '健身房' },
    ],
    commutes: [
      { from_id: 'home', to_id: 'office', minutes: 30 },
      { from_id: 'office', to_id: 'gym', minutes: 20 },
    ],
    activities: [],
  };
}
const flex = (id, title, { place_id, minutes, plan = 'p1' }) => ({
  id, title, place_id, planned_minutes: minutes, plan_ids: plan ? [plan] : [],
  planned_start: null, planned_date: null, status: 'Planned',
});

test('deriveAvailWindows：当天已固定活动从工作窗中扣除', () => {
  const db = mkDb();
  db.activities.push({
    id: 'fixed', title: '站会', status: 'Started',
    planned_start: '2026-10-19T09:30', planned_minutes: 30, plan_ids: [],
  });
  const avail = deriveAvailWindows(db, DAY_START, defaultWorkWindows(DAY_START));
  // 9:00–9:30 剩 30 分，10:00 之后另成一段
  const first = avail[0];
  assert.equal((first.end - first.start) / 60000, 30);
  assert.equal(first.start, at(9));
});

test('日表：深度活动落上午高能窗；同计划活动同质连续打包', () => {
  const db = mkDb();
  db.activities.push(
    flex('a1', '写章节', { place_id: 'office', minutes: 50, plan: 'p1' }),
    flex('a2', '改稿', { place_id: 'office', minutes: 40, plan: 'p1' }),
  );
  const r = generateDayPlan(db, {
    date: DAY_START, now: at(8), currentPlaceId: 'office',
    profile: 'deep', peaks: CHRONOTYPES.lark,
  });
  const ids = r.assignments.map((x) => x.activityId);
  assert.deepEqual(ids, ['a1', 'a2']);
  // 同一窗口、连续（a2 开始 = a1 结束）
  assert.equal(r.assignments[0].windowIndex, r.assignments[1].windowIndex);
  assert.equal(r.assignments[1].start, r.assignments[0].end, '同质活动背靠背');
  // 落在上午高能窗（9–11）
  assert.ok(r.assignments[0].start >= at(9) && r.assignments[0].start < at(11));
});

test('地点门控：健身房活动当前在工位不可行 → unplaced(place)', () => {
  const db = mkDb();
  db.activities.push(
    flex('a1', '写章节', { place_id: 'office', minutes: 60 }),
    flex('a4', '撸铁', { place_id: 'gym', minutes: 60, plan: 'p2' }),
  );
  const r = generateDayPlan(db, {
    date: DAY_START, now: at(8), currentPlaceId: 'office',
    profile: 'deep', peaks: CHRONOTYPES.lark,
  });
  assert.ok(r.assignments.some((x) => x.activityId === 'a1'));
  assert.ok(!r.assignments.some((x) => x.activityId === 'a4'));
  assert.equal(r.unplaced.find((x) => x.activityId === 'a4')?.reason, 'place');
});

test('通勤：从家出发首个工位活动不早于 9:30；跨地点背靠背无间隔 → unplaced(commute-gap)', () => {
  const db = mkDb();
  db.activities.push(
    flex('a1', '写章节', { place_id: 'office', minutes: 90, plan: 'p1' }),
    flex('a4', '撸铁', { place_id: 'gym', minutes: 60, plan: 'p2' }),
  );
  const r = generateDayPlan(db, {
    date: DAY_START, now: at(8), currentPlaceId: 'home',
    profile: 'deep', peaks: CHRONOTYPES.lark,
  });
  const a1 = r.assignments.find((x) => x.activityId === 'a1');
  assert.ok(a1.start >= at(9, 30), `首个活动含 30 分通勤，实际 ${new Date(a1.start).getHours()}:${new Date(a1.start).getMinutes()}`);
  // a4 与 a1 跨地点且间隔不足 20 分 → 放不下
  const a4 = r.unplaced.find((x) => x.activityId === 'a4');
  assert.ok(a4, 'a4 应在 unplaced');
  assert.equal(a4.reason, 'commute-gap');
});

test('深度预算：深度需求超日预算 → rho=over，溢出活动进 unplaced(budget)', () => {
  const db = mkDb();
  // 6 个 60 分深度活动 = 360 分 > 300 预算
  for (let i = 1; i <= 6; i++) {
    db.activities.push(flex(`d${i}`, `任务${i}`, { place_id: 'office', minutes: 60 }));
  }
  const r = generateDayPlan(db, {
    date: DAY_START, now: at(8), currentPlaceId: 'office',
    profile: 'deep', peaks: CHRONOTYPES.lark,
  });
  assert.equal(r.rho.level, 'over');
  assert.ok(r.unplaced.some((x) => x.reason === 'budget'));
  const placedDepth = r.assignments.filter((x) => x.depth).reduce((s, x) => s + (x.end - x.start) / 60000, 0);
  assert.ok(placedDepth <= 300, `已排深度 ${placedDepth} 超预算`);
});

test('浅层活动进 shallow 窗，不占深度窗', () => {
  const db = mkDb();
  db.activities.push(
    flex('s1', '回消息', { place_id: 'office', minutes: 15, plan: null }),
  );
  const r = generateDayPlan(db, {
    date: DAY_START, now: at(8), currentPlaceId: 'office',
    profile: 'deep', peaks: CHRONOTYPES.lark,
  });
  const s1 = r.assignments.find((x) => x.activityId === 's1');
  assert.ok(s1);
  assert.equal(s1.depth, false);
});

// tests/activitygraph.test.js —— 战略图 Dijkstra 最短路（SPEC §1.2 §1.3）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildActivityGraph, shortestPathToGoal, actTemplateOf } from '../src/domain/activitygraph.js';

// 场景：目标 g1「成书」← 计划 p1「写作」；p2「健身」无目标归属。
// a1 写章节(office,60m,p1) / a2 改稿(home,30m,p1) / a3 撸铁(gym,45m,p2)
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
    commutes: [{ from_id: 'home', to_id: 'office', minutes: 30 }, { from_id: 'gym', to_id: 'home', minutes: 15 }],
    activities: [
      { id: 'a1', title: '写章节', place_id: 'office', planned_minutes: 60, plan_ids: ['p1'], status: 'Planned' },
      { id: 'a2', title: '改稿', place_id: 'home', planned_minutes: 30, plan_ids: ['p1'], status: 'Planned' },
      { id: 'a3', title: '撸铁', place_id: 'gym', planned_minutes: 45, plan_ids: ['p2'], status: 'Planned' },
    ],
  };
}

test('actTemplateOf：尾随数字归一（写作 2 → 写作）', () => {
  assert.equal(actTemplateOf('写作 2'), '写作');
  assert.equal(actTemplateOf('写章节'), '写章节');
});

test('START→活动边：成本含预计耗时 + 从当前地点的通勤', () => {
  const db = mkDb();
  const g = buildActivityGraph(db, { currentPlaceId: 'home' });
  // a2 在家：只算 30 分钟耗时；a1 在工位：60 + 30 通勤 = 90
  assert.equal(g.edgeCost('start', 'act:a2'), 30);
  assert.equal(g.edgeCost('start', 'act:a1'), 90);
});

test('活动→目标边：归属目标的计划为 0 成本可达；无归属的活动到不了任何 GOAL', () => {
  const db = mkDb();
  const g = buildActivityGraph(db, { currentPlaceId: 'home' });
  assert.equal(g.edgeCost('act:a1', 'goal:g1'), 0);
  assert.equal(g.edgeCost('act:a3', 'goal:g1'), null, '健身不归属任何目标');
});

test('最短路：当前在家 → 目标 g1，选家中的改稿（30）而非跨城去工位（90）', () => {
  const db = mkDb();
  const g = buildActivityGraph(db, { currentPlaceId: 'home' });
  const r = shortestPathToGoal(g, 'start', 'g1');
  assert.ok(r);
  assert.deepEqual(r.path, ['start', 'act:a2', 'goal:g1']);
  assert.equal(r.cost, 30);
});

test('最短路：不给定目标 → 取可达目标中成本最小者', () => {
  const db = mkDb();
  const g = buildActivityGraph(db, { currentPlaceId: 'office' });
  const r = shortestPathToGoal(g, 'start'); // 自动选 g1
  assert.ok(r);
  assert.equal(r.goalId, 'g1');
});

test('切换成本与连续性：跨计划 +15，同计划 +5；历史转移给连续性折扣', () => {
  const db = mkDb();
  db.activities.push(
    { id: 'a4', title: '提纲', place_id: 'home', planned_minutes: 20, plan_ids: ['p1'], status: 'Planned' },
  );
  // 无历史：a4→a2 同计划 = 30(耗时) + 5(切换)
  let g = buildActivityGraph(db, { currentPlaceId: 'home' });
  assert.equal(g.edgeCost('act:a4', 'act:a2'), 35);
  // 有 3 次「提纲→改稿」历史：连续性折扣 10 封顶 → 25
  db.activities.push(
    { id: 'h1', title: '提纲', status: 'Reviewed', actual_start: 1, actual_end: 100 },
    { id: 'h2', title: '改稿', status: 'Reviewed', actual_start: 2, actual_end: 200 },
    { id: 'h3', title: '提纲', status: 'Reviewed', actual_start: 3, actual_end: 300 },
    { id: 'h4', title: '改稿', status: 'Reviewed', actual_start: 4, actual_end: 400 },
    { id: 'h5', title: '提纲', status: 'Reviewed', actual_start: 5, actual_end: 500 },
    { id: 'h6', title: '改稿', status: 'Reviewed', actual_start: 6, actual_end: 600 },
  );
  g = buildActivityGraph(db, { currentPlaceId: 'home' });
  assert.equal(g.edgeCost('act:a4', 'act:a2'), 25);
});

test('边权永远非负（Dijkstra 安全）', () => {
  const db = mkDb();
  // 大量转移史也不会打出负边
  for (let i = 0; i < 10; i++) {
    db.activities.push(
      { id: `t${i}a`, title: '甲', status: 'Reviewed', actual_start: i * 10, actual_end: i * 10 + 1 },
      { id: `t${i}b`, title: '乙', status: 'Reviewed', actual_start: i * 10 + 2, actual_end: i * 10 + 3 },
    );
  }
  db.activities.push(
    { id: 'x1', title: '甲', place_id: 'home', planned_minutes: 1, plan_ids: ['p1'], status: 'Planned' },
    { id: 'x2', title: '乙', place_id: 'home', planned_minutes: 1, plan_ids: ['p1'], status: 'Planned' },
  );
  const g = buildActivityGraph(db, { currentPlaceId: 'home' });
  for (const [, outs] of g.adj) for (const e of outs) assert.ok(e.cost >= 0, `负边 ${e.cost}`);
});

test('地点门控：当前在健身房 → 只能先回家改稿；无通勤边的地方到不了目标', () => {
  const db = mkDb();
  const g = buildActivityGraph(db, { currentPlaceId: 'gym' });
  // 健身房→家 15 分，a2 30 分：首跳成本 45；a1 在工位但没有 gym→office 通勤边
  assert.equal(g.edgeCost('start', 'act:a2'), 45);
  const r = shortestPathToGoal(g, 'start', 'g1');
  assert.deepEqual(r.path, ['start', 'act:a2', 'goal:g1']);
  assert.equal(r.cost, 45);

  // 只把目标挂在工位时，且健身房没有通往任何地方的通勤边 → 到不了
  const db2 = mkDb();
  db2.commutes = [{ from_id: 'home', to_id: 'office', minutes: 30 }];
  db2.goals.push({ id: 'g2', title: '线下会', status: 'Active' });
  db2.plans.push({ id: 'p3', title: '会议', goal_id: 'g2', status: 'Active' });
  db2.activities.push({
    id: 'a6', title: '开会', place_id: 'office', planned_minutes: 30, plan_ids: ['p3'], status: 'Planned',
  });
  const g2 = buildActivityGraph(db2, { currentPlaceId: 'gym' });
  assert.equal(shortestPathToGoal(g2, 'start', 'g2'), null);
});

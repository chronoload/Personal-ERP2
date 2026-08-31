// tests/recommend.test.js
// L3 推荐机：scheduleScore / minRecommendGuarantee / slotIntoFreeTime / recommendNext（TDD）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleScore, minRecommendGuarantee, slotIntoFreeTime, recommendNext, ucbBonus, suggestHabitActivity } from '../src/domain/recommend.js';

function ms(s) {
  const [d, t] = s.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mi] = t.split(':').map(Number);
  return new Date(y, m - 1, dd, hh, mi).getTime();
}

const NOW = ms('2026-8-30T12:00');

// 一个成熟的 L2 特征集：p1 高完成率高发散、p2 低 n 冷启动
function sampleFeats() {
  return {
    biasModel: [
      { planId: 'p1', biasK: 1.5, n: 8 },
      { planId: 'p2', biasK: 1, n: 0 },
    ],
    completion: {
      byPlan: [
        { planId: 'p1', done: 7, failed: 1, total: 8, rate: 0.875 },
        { planId: 'p2', done: 0, failed: 0, total: 2, rate: 0 },
      ],
      byGoal: [],
    },
    yield: {
      byPlan: [
        { planId: 'p1', actsEnded: 8, spentMinutes: 480, vfCount: 6, outputCount: 5, yieldDensityFull: 6 / 480 },
        { planId: 'p2', actsEnded: 0, spentMinutes: 0, vfCount: 0, outputCount: 0, yieldDensityFull: 0 },
      ],
      byGoal: [],
    },
  };
}

test('L3: 评分单调性 —— 高完成率高发散高紧迫 > 低完成率低发散', () => {
  const hot = scheduleScore(
    { activityId: 'a-hot', planId: 'p1', plannedStart: NOW, deadline: NOW + 3600000, plannedMinutes: 30, n: 8, conflictsCount: 0 },
    sampleFeats(), { now: NOW });
  const cold = scheduleScore(
    { activityId: 'a-cold', planId: 'p2', plannedStart: NOW, deadline: NOW + 30 * 86400000, plannedMinutes: 60, n: 0, conflictsCount: 0 },
    sampleFeats(), { now: NOW });
  assert.ok(hot.score > cold.score, `hot=${hot.score} 应高于 cold=${cold.score}`);
});

test('L3: 冲突惩罚 —— 冲突越多分越低', () => {
  const a0 = scheduleScore({ activityId: 'x', planId: 'p1', plannedStart: NOW, plannedMinutes: 30, n: 8, conflictsCount: 0 }, sampleFeats(), { now: NOW });
  const a2 = scheduleScore({ activityId: 'x', planId: 'p1', plannedStart: NOW, plannedMinutes: 30, n: 8, conflictsCount: 2 }, sampleFeats(), { now: NOW });
  assert.ok(a2.score < a0.score, '冲突 2 处应显著低于 0 处');
  assert.ok(a2.reasons.some((r) => /冲突/.test(r)));
});

test('L3: biasK 校正 —— estMinutes = plannedMinutes × biasK', () => {
  const r = scheduleScore({ activityId: 'x', planId: 'p1', plannedStart: NOW, plannedMinutes: 60, n: 8, conflictsCount: 0 }, sampleFeats(), { now: NOW });
  // p1 biasK=1.5 → estMinutes = 90
  assert.equal(r.estMinutes, 90);
});

test('L3: UCB 探索 —— 低 n 候选获探索加分，验证 ucbBonus 单调性', () => {
  // ucbBonus：n=0 > n=2 > n=8
  assert.ok(ucbBonus(0, 10) > ucbBonus(2, 10));
  assert.ok(ucbBonus(2, 10) > ucbBonus(8, 10));
  // n=0 得分里含探索原因
  const cold = scheduleScore({ activityId: 'a-cold', planId: 'p2', plannedStart: NOW, plannedMinutes: 60, n: 0, conflictsCount: 0 }, sampleFeats(), { now: NOW });
  assert.ok(cold.reasons.some((r) => /新任务|探索/.test(r)), '冷启动候选应有探索原因');
});

test('L3: 保底浮现 —— 低 n 候选被拉高到 ≥60，新计划不会永远垫底', () => {
  const scored = [
    { activityId: 'h1', score: 95, n: 10, reasons: [] },
    { activityId: 'h2', score: 90, n: 9, reasons: [] },
    { activityId: 'new', score: 25, n: 0, reasons: [] },
  ];
  minRecommendGuarantee(scored, 2);
  assert.ok(scored.find((s) => s.activityId === 'new').score >= 60, '保底后新计划应 ≥60');
  assert.ok(scored.find((s) => s.activityId === 'new').guaranteed === true);
});

test('L3: slotIntoFreeTime —— 排进空闲时段并冲突避让', () => {
  const slots = [
    { start: NOW, end: NOW + 60 * 60000 }, // 09:00-10:00 一小时空
  ];
  const placed = slotIntoFreeTime(slots, [
    { activityId: 't1', duration: 30, score: 80 }, // 30 分钟，可放
    { activityId: 't2', duration: 45, score: 70 }, // 45 分钟，放不进去（已被 t1 占 30，剩 30）
  ], { now: NOW });
  assert.equal(placed.length, 1);
  assert.equal(placed[0].activityId, 't1');
  assert.equal(placed[0].slotStart, NOW);
});

test('L3: recommendNext —— 排序 + 探索 + 保底 + limit', () => {
  const recs = recommendNext([
    { activityId: 'h1', planId: 'p1', deadline: NOW + 3600000, plannedMinutes: 30, n: 8, conflictsCount: 0 },
    { activityId: 'new1', planId: 'p2', deadline: NOW + 30 * 86400000, plannedMinutes: 60, n: 0, conflictsCount: 0 },
    { activityId: 'h2', planId: 'p1', deadline: NOW + 2 * 86400000, plannedMinutes: 40, n: 8, conflictsCount: 0 },
  ], sampleFeats(), { now: NOW, limit: 3, k: 1 });
  assert.equal(recs.length, 3);
  // 分数降序
  for (let i = 1; i < recs.length; i++) assert.ok(recs[i - 1].score >= recs[i].score, '应降序');
  // 保底的新任务必须出现
  const newRec = recs.find((r) => r.activityId === 'new1');
  assert.ok(newRec && newRec.score >= 60, '保底新计划应出现且 ≥60');
});

test('L3: 空候选幂等 —— 返回空数组不抛', () => {
  assert.deepEqual(scheduleScore, scheduleScore); // sanity
  assert.deepEqual(recommendNext([], sampleFeats(), { now: NOW }), []);
  assert.deepEqual(slotIntoFreeTime([], [], { now: NOW }), []);
  assert.deepEqual(minRecommendGuarantee([], 2), []);
});

// ---- 习惯推导 suggestHabitActivity（按历史习惯快速生成新活动）----

function habitDB() {
  return {
    schemaVersion: 3, resources: [], rules: [], goals: [],
    plans: [
      { id: 'p-write', goal_id: 'g', title: '写作', budget: null, status: 'Active', created: 0 },
      { id: 'p-run', goal_id: 'g', title: '跑步', budget: null, status: 'Active', created: 0 },
      { id: 'p-new', goal_id: 'g', title: '新计划', budget: null, status: 'Active', created: 0 },
    ],
    outputs: [], valueflows: [], txs: [], goods: [], seq: {},
    // 写作：稳定习惯，3 次，常 09:00，60 分钟，最近 2 天前完成
    // 跑步：2 次，常 18:30，30 分钟，最近 6 天前完成（更该补）
    activities: [
      { id: 'w1', title: '写作', plan_ids: ['p-write'], status: 'Completed', planned_minutes: 60, planned_start: '2026-8-26T09:00', actual_start: ms('2026-8-26T09:00'), actual_end: ms('2026-8-26T10:00'), created: 0 },
      { id: 'w2', title: '写作', plan_ids: ['p-write'], status: 'Completed', planned_minutes: 60, planned_start: '2026-8-24T09:00', actual_start: ms('2026-8-24T09:00'), actual_end: ms('2026-8-24T10:00'), created: 0 },
      { id: 'w3', title: '写作', plan_ids: ['p-write'], status: 'Reviewed', planned_minutes: 60, planned_start: '2026-8-28T09:00', actual_start: ms('2026-8-28T09:00'), actual_end: ms('2026-8-28T10:00'), created: 0 },
      { id: 'r1', title: '跑步', plan_ids: ['p-run'], status: 'Completed', planned_minutes: 30, planned_start: '2026-8-24T18:30', actual_start: ms('2026-8-24T18:30'), actual_end: ms('2026-8-24T19:00'), created: 0 },
      { id: 'r2', title: '跑步', plan_ids: ['p-run'], status: 'Completed', planned_minutes: 30, planned_start: '2026-8-25T18:30', actual_start: ms('2026-8-25T18:30'), actual_end: ms('2026-8-25T19:00'), created: 0 },
    ],
  };
}

test('L3: 习惯推导 —— 稳定习惯聚合 频次/时长/时段，优先推荐最近没做的', () => {
  const db = habitDB();
  const now = ms('2026-8-30T12:00');
  const rec = suggestHabitActivity(db, { now });
  // 跑步最近完成 8-25（now 8-30 → 4 天前）；写作最近 8-28（2 天前）→ 应推荐跑步
  assert.equal(rec.planId, 'p-run');
  assert.equal(rec.title, '跑步');
  assert.equal(rec.count, 2);
  assert.equal(rec.minutes, 30);
  assert.equal(rec.at, '18:30');
  assert.equal(rec.daysSince, 4);
});

test('L3: 习惯推导 —— 无完成记录（< minCount）不构成习惯，返回 null', () => {
  const db = habitDB();
  db.activities = []; // 无完成历史
  const rec = suggestHabitActivity(db, { now: ms('2026-8-30T12:00') });
  assert.equal(rec, null);
});

test('L3: 习惯推导 —— 未达 minCount 的计划被排除，只剩稳定习惯', () => {
  const db = habitDB();
  // 跑步只有 1 次完成 → minCount=2 下被排除；只剩写作
  db.activities = db.activities.filter((a) => !(a.plan_ids?.[0] === 'p-run'));
  const rec = suggestHabitActivity(db, { now: ms('2026-8-30T12:00') });
  assert.equal(rec.planId, 'p-write');
  assert.equal(rec.count, 3);
});

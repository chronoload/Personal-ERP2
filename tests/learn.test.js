// tests/learn.test.js
// L2 学习引擎：extractFeatures + stripFeatureIdentity（TDD）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFeatures, stripFeatureIdentity } from '../src/domain/learn.js';

function ms(s) {
  const [d, t] = s.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mi] = t.split(':').map(Number);
  return new Date(y, m - 1, dd, hh, mi).getTime();
}

// 固定 now，便于断言
const NOW = ms('2026-8-30T12:00');

function freshDB() {
  return {
    plans: [
      { id: 'p1', goal_id: 'g1', title: '写论文', budget: 100, status: 'Active', created: 0 },
      { id: 'p2', goal_id: null, title: '锻炼', budget: null, status: 'Active', created: 0 },
      { id: 'p3', goal_id: 'g1', title: '新计划（无实际数据/冷启动）', budget: 50, status: 'Active', created: 0 },
    ],
    goals: [{ id: 'g1', title: '完成毕业论文', desc: '', status: 'Active', created: 0 }],
    activities: [
      // p1：两期，常 60 计划 -> 实际 90（bias 1.5）、实际 120（bias 2.0）→ Σactual 210/Σplanned 120 = 1.75
      { id: 'a1', title: '写', plan_ids: ['p1'], status: 'Completed', planned_minutes: 60, planned_start: '2026-8-25T09:00', time_logs: [{ start: ms('2026-8-25T09:00'), end: ms('2026-8-25T10:30') }], actual_start: ms('2026-8-25T09:00'), conflicts: [], retryCount: 0, created: NOW - 5 * 86400000 },
      { id: 'a2', title: '写2', plan_ids: ['p1'], status: 'Completed', planned_minutes: 60, planned_start: '2026-8-27T09:00', time_logs: [{ start: ms('2026-8-27T09:00'), end: ms('2026-8-27T11:00') }], actual_start: ms('2026-8-27T09:00'), conflicts: [], retryCount: 0, created: NOW - 3 * 86400000 },
      // p2：失败活动，有实际（bias 30/30=1），n=1
      { id: 'a3', title: '跑', plan_ids: ['p2'], status: 'Failed', planned_minutes: 30, planned_start: '2026-8-26T08:00', time_logs: [{ start: ms('2026-8-26T08:00'), end: ms('2026-8-26T08:30') }], conflicts: ['ax'], retryCount: 2, created: NOW - 4 * 86400000 },
      // 弹性活动（无计划时长）
      { id: 'a4', title: '散步', plan_ids: ['p2'], status: 'Completed', planned_minutes: 0, planned_start: null, time_logs: [], conflicts: [], retryCount: 0, created: NOW - 2 * 86400000 },
    ],
    outputs: [
      { id: 'o1', activity_id: 'a1', title: '草稿', tags: [], status: 'Published', created: 0 },
      { id: 'o2', activity_id: 'a2', title: '修改稿', tags: [], status: 'Published', created: 0 },
    ],
    valueflows: [
      { id: 'v1', output_id: 'o1', status: 'Closed', created: 0 },
      { id: 'v2', output_id: 'o2', status: 'Pending', created: 0 },
      { id: 'v3', output_id: 'o1', status: 'Pending', created: 0 },
    ],
  };
}

test('L2: 冷启动 —— 无实际数据计划 biasK=1, n=0（L3 不信任）', () => {
  const feats = extractFeatures(freshDB());
  const p3 = feats.biasModel.find((e) => e.planId === 'p3');
  assert.ok(p3, '冷启动计划应出现在 biasModel');
  assert.equal(p3.biasK, 1);
  assert.equal(p3.n, 0);
});

test('L2: biasK 收敛 —— 单计划多期 Σactual/Σplanned（浮点全精度）', () => {
  const feats = extractFeatures(freshDB());
  const p1 = feats.biasModel.find((e) => e.planId === 'p1');
  // Σactual = 90 + 120 = 210；Σplanned = 60 + 60 = 120；biasK = 1.75
  assert.equal(p1.biasK, 1.75);
  assert.equal(p1.n, 2);
  // p2：Σactual 30 / Σplanned 30 = 1
  const p2 = feats.biasModel.find((e) => e.planId === 'p2');
  assert.equal(p2.biasK, 1);
  assert.equal(p2.n, 1);
});

test('L2: 孤儿计划清理 —— 被删除/归档的计划累计不进入 biasModel/completion', () => {
  const db = freshDB();
  // 往 a1 追加一个已被删除的计划 pX 的 time_log 承载：给 a1 加 plan_ids pX（pX 不在 db.plans）
  db.activities[0].plan_ids = ['p1', 'pX'];
  const feats = extractFeatures(db);
  const orphans = feats.biasModel.filter((e) => e.planId === 'pX');
  assert.equal(orphans.length, 0, '孤儿计划不应出现在 biasModel');
  assert.ok(!feats.completion.byPlan.some((e) => e.planId === 'pX'), '孤儿计划不应出现在 completion');
  // 现存计划用额外一条贡献要正确累加（p1 现 n=2 不变，因 pX 被跳过但 p1 仍在）
  const p1 = feats.biasModel.find((e) => e.planId === 'p1');
  assert.equal(p1.n, 2);
});

test('L2: 精度红线 —— yieldDensityFull 是浮点全精度，非 ×1000 取整展示值', () => {
  const feats = extractFeatures(freshDB());
  const p1y = feats.yield.byPlan.find((e) => e.planId === 'p1');
  // vfCount for p1 = v1 + v2 + v3 (o1 has 2 vf, o2 has 1 vf) = 3；spentMinutes = 90+120 = 210
  // yieldDensityFull = 3/210 ≈ 0.0142857...（未取整）
  assert.equal(p1y.spentMinutes, 210);
  assert.equal(p1y.vfCount, 3);
  assert.ok(p1y.yieldDensityFull > 0.014 && p1y.yieldDensityFull < 0.015, '浮点全精度不应被圆整丢失');
});

test('L2: sched —— 冲突/守约/定时计数', () => {
  const feats = extractFeatures(freshDB());
  assert.equal(feats.sched.total, 4);
  assert.equal(feats.sched.actsWithConflict, 1);      // a3
  assert.equal(feats.sched.totalConflicts, 1);
  assert.equal(feats.sched.timedActs, 3);              // a1,a2,a3（有计划时长+开始）
  assert.equal(feats.sched.flexibleActs, 1);           // a4
  assert.equal(feats.sched.adheredActs, 3);            // a1,a2,a3 均在计划日当天开始
});

test('L2: stripFeatureIdentity 去身份 —— 无 planId/goalId，纯数字', () => {
  const feats = extractFeatures(freshDB());
  const s = stripFeatureIdentity(feats);
  assert.doesNotThrow(() => JSON.stringify(s));
  const str = JSON.stringify(s);
  assert.ok(!/planId|goalId/.test(str), '去身份后不应有 planId/goalId');
  assert.ok(Array.isArray(s.biasRate));
  assert.ok(s.biasRate[0].biasK === 1.75);
  assert.ok(Array.isArray(s.completion.byPlan));
  assert.ok(Array.isArray(s.yield.byGoal));
  assert.equal(s.budget.overspendCount, 0);
  // planId 应在 extractFeatures 原值里存在（L3 同进程用）
  const raw = extractFeatures(freshDB());
  assert.ok(raw.biasModel.some((e) => e.planId === 'p1'));
});

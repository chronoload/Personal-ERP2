// tests/recommend.test.js
// L3 推荐机：scheduleScore / minRecommendGuarantee / slotIntoFreeTime / recommendNext（TDD）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleScore, minRecommendGuarantee, slotIntoFreeTime, recommendNext, ucbBonus, suggestNextActivity, suggestNextActivities } from '../src/domain/recommend.js';

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

// ---- 活动级顺序推荐 suggestNextActivities（按完成时间序列 + 历史关联性）----

// mkActs(seqs)：seqs = [[title, day, hh, mm, minutes], ...] 数组顺序即「完成时间序列」
function mkActs(seqs) {
  return {
    schemaVersion: 3, resources: [], rules: [], goals: [], plans: [],
    outputs: [], valueflows: [], txs: [], goods: [], seq: {},
    activities: seqs.map(([title, d, h, m, min], i) => ({
      id: 'a' + i, title, plan_ids: [], status: 'Completed', planned_minutes: min,
      planned_start: `2026-8-${d}T${h}:${m}`,
      actual_start: ms(`2026-8-${d}T${h}:${m}`),
      actual_end: ms(`2026-8-${d}T${h}:${m}`) + min * 60000, created: 0,
    })),
  };
}
const T = { run: '跑步', read: '阅读', write: '写作' };

test('L3: 活动级 —— 最近完成活动无历史后继 → 降级为最近完成活动（有候选可弹）', () => {
  // 序列 写作→跑步→阅读（最后完成=阅读，阅读后无历史转移）
  const db = mkActs([[T.write, 1, 9, 0, 60], [T.run, 1, 18, 30, 30], [T.read, 2, 9, 0, 40]]);
  const rec = suggestNextActivity(db, { now: ms('2026-8-4T12:00') });
  assert.ok(rec, '无转移时降级，仍应有推荐');
  assert.equal(rec.title, T.read); // 最近完成的活动
  assert.equal(rec.degraded, true);
});

test('L3: 活动级 —— 学转移关联推最强后继', () => {
  // 序列 写作→跑步→阅读→跑步→阅读→跑步（最后完成=跑步）
  // 转移：w→r, r→rd, rd→r, r→rd, rd→r；r→rd ×2 → 推荐阅读
  const db = mkActs([
    [T.write, 1, 9, 0, 60], [T.run, 1, 18, 30, 30], [T.read, 2, 9, 0, 40],
    [T.run, 2, 18, 30, 30], [T.read, 3, 9, 0, 40], [T.run, 3, 18, 30, 30],
  ]);
  const rec = suggestNextActivity(db, { now: ms('2026-8-4T12:00') });
  assert.equal(rec.title, T.read);
  assert.equal(rec.fromTitle, T.run);
  assert.equal(rec.transCount, 2);
  assert.equal(rec.minutes, 40); // 阅读历史时长均值
  assert.equal(rec.at, '09:00'); // 阅读两次都在 09:00
  assert.equal(rec.daysSince, 1); // 最近阅读 8-3，now 8-4
  assert.equal(rec.degraded, false);
});

test('L3: 活动级 —— 循环连做（相邻相同模板）不计入转移', () => {
  // 序列 写作→写作→跑步→阅读→跑步→阅读→跑步（开头相邻相同应跳过）
  // 转移仍 w→r, r→rd, rd→r, r→rd, rd→r；最近完成=跑步 → 推荐阅读（r→rd 2 次不受污染）
  const db = mkActs([
    [T.write, 1, 8, 0, 60], [T.write, 1, 9, 0, 60], [T.run, 1, 18, 30, 30], [T.read, 2, 9, 0, 40],
    [T.run, 2, 18, 30, 30], [T.read, 3, 9, 0, 40], [T.run, 3, 18, 30, 30],
  ]);
  const rec = suggestNextActivity(db, { now: ms('2026-8-4T12:00') });
  assert.equal(rec.title, T.read);
  assert.equal(rec.transCount, 2);
});

test('L3: 活动级 —— 标题模板归一：尾随数字合并为同一模板', () => {
  // 「写作 1」「写作 2」视为同一模板「写作」→ 序列 跑步→写作→写作（相邻同模板跳过）
  const db = mkActs([
    [T.run, 1, 9, 0, 30], ['写作 1', 1, 18, 30, 60], ['写作 2', 2, 9, 0, 60],
  ]);
  // 最近完成=写作，无后继转移 → 降级返回写作（模板归一后 transCount=2）
  const rec = suggestNextActivity(db, { now: ms('2026-8-4T12:00') });
  assert.ok(rec);
  assert.equal(rec.title, '写作');
  assert.equal(rec.transCount, 2); // 降级时 = 完成次数
});

test('L3: 活动级 —— 无任何完成历史返回空', () => {
  const db = mkActs([]); // 无完成记录
  assert.deepEqual(suggestNextActivities(db, { now: ms('2026-8-4T12:00') }), []);
  assert.equal(suggestNextActivity(db, { now: ms('2026-8-4T12:00') }), null);
});

test('L3: 活动级 —— 降级：无转移关联时按「最近完成活动」兜底，transCount=完成次数', () => {
  // 三条完成记录，标题各不相同（无 A→B 重复 → 无转移关联）
  const db = mkActs([[T.write, 1, 9, 0, 60], [T.run, 2, 18, 30, 30], [T.read, 3, 9, 0, 40]]);
  const recs = suggestNextActivities(db, { now: ms('2026-8-4T12:00'), k: 3 });
  assert.equal(recs.length, 3);
  assert.ok(recs.every((r) => r.degraded === true));
  assert.equal(recs[0].title, T.read); // 最近完成的在前
  assert.equal(recs[0].transCount, 1); // 完成 1 次
  assert.equal(recs[0].fromTitle, ''); // 无转移上下文
});

test('L3: top-k —— 多个后继按转移关联降序返回前 k', () => {
  // 序列 跑步→阅读→跑步→写作→跑步→阅读→跑步→写作→跑步
  // 转移：r→rd, rd→r, r→w, w→r, r→rd, rd→r, r→w, w→r
  // 最近完成=跑步；从跑步出发：r→rd ×2、r→w ×2 → 应返回 [阅读, 写作]
  const db = mkActs([
    [T.run, 1, 8, 0, 30], [T.read, 1, 9, 0, 40], [T.run, 1, 18, 0, 30], [T.write, 2, 9, 0, 60],
    [T.run, 2, 18, 0, 30], [T.read, 3, 9, 0, 40], [T.run, 3, 18, 0, 30], [T.write, 4, 9, 0, 60],
    [T.run, 4, 18, 0, 30],
  ]);
  const recs = suggestNextActivities(db, { now: ms('2026-8-5T12:00'), k: 3 });
  assert.equal(recs.length, 2); // 两个后继都 ≥1 次
  assert.equal(recs[0].title, T.read); // 阅读：转移 2 次
  assert.equal(recs[0].transCount, 2);
  assert.equal(recs[1].title, T.write); // 写作：转移 2 次
  assert.equal(recs[1].transCount, 2);
});

test('L3: top-k —— k 截断', () => {
  // 序列 跑步→阅读 重复 3 轮，最后一条=跑步 → r→rd ×3；k=1 → 只返回阅读
  const db = mkActs([
    [T.run, 1, 8, 0, 30], [T.read, 1, 9, 0, 40],
    [T.run, 2, 8, 0, 30], [T.read, 2, 9, 0, 40],
    [T.run, 3, 8, 0, 30], [T.read, 3, 9, 0, 40],
    [T.run, 4, 18, 0, 30], // 最近完成=跑步
  ]);
  const recs = suggestNextActivities(db, { now: ms('2026-8-5T12:00'), k: 1 });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].title, T.read);
  assert.equal(recs[0].transCount, 3);
});

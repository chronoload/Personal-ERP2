// tests/attention.test.js —— 注意力窗口骨架 / 深度预算 / ρ / 自适应提前量
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FOCUS_PROFILES, CHRONOTYPES, buildFocusSkeleton, classifyDepth,
  rhoReport, adaptiveLeadMinutes, templateLeadMinutes,
} from '../src/domain/attention.js';

const DAY = new Date(2026, 9, 19); // 2026-10-19 周一
const at = (h, m = 0) => new Date(2026, 9, 19, h, m).getTime();

test('参数表：深度窗 60–90 / 休息 15–20 / 日预算 300 / 2 窗后长休', () => {
  const d = FOCUS_PROFILES.deep;
  assert.deepEqual(d.focus, [60, 90]);
  assert.equal(d.dailyBudgetMin, 300);
  assert.equal(d.longRestAfter, 2);
  assert.ok(d.longRestMin >= 30);
});

test('骨架：9:00–18:00（中间不断）产出 90 分深度窗 + 20 分休息，第 3 个窗后是 30 分长休', () => {
  const items = buildFocusSkeleton([{ start: at(9), end: at(18) }], 'deep', { date: DAY.getTime(), peaks: CHRONOTYPES.lark });
  const f1 = items[0];
  assert.equal(f1.kind, 'focus');
  assert.equal((f1.end - f1.start) / 60000, 90);
  const r1 = items[1];
  assert.equal(r1.kind, 'rest');
  assert.equal((r1.end - r1.start) / 60000, 20);
  // f2 9:00+90+20=11:20–12:50；r2 20 → 13:10；f3 13:10–14:40；其后长休 30
  const rests = items.filter((i) => i.kind === 'rest');
  assert.equal((rests[2].end - rests[2].start) / 60000, 30, '第 3 次休息是长休');
});

test('日深度预算 300 封顶：用完后的时间降级为 shallow 自由窗', () => {
  const items = buildFocusSkeleton([{ start: at(9), end: at(18) }], 'deep', { date: DAY.getTime(), peaks: CHRONOTYPES.lark });
  const focusMin = items.filter((i) => i.kind === 'focus').reduce((s, i) => s + (i.end - i.start), 0) / 60000;
  assert.ok(focusMin <= 300, `深度总量 ${focusMin} 超预算`);
  assert.ok(items.some((i) => i.kind === 'shallow'), '预算耗尽后应有浅层自由窗');
});

test('peakFactor：9–11 高能时段的窗标 1.0，下午窗低于上午窗', () => {
  const items = buildFocusSkeleton([{ start: at(9), end: at(18) }], 'deep', { date: DAY.getTime(), peaks: CHRONOTYPES.lark });
  const morning = items.find((i) => i.kind === 'focus' && i.start < at(11));
  assert.ok(morning.peakFactor >= 0.9, `上午窗 peakFactor=${morning.peakFactor}`);
});

test('短于下限的残段（如工作窗末端 30 分）不开深度窗，转 shallow', () => {
  const items = buildFocusSkeleton([{ start: at(9), end: at(10, 30) }], 'deep', { date: DAY.getTime(), peaks: CHRONOTYPES.lark });
  assert.equal(items.filter((i) => i.kind === 'focus').length, 1, '90 分只够 1 个窗');
  assert.ok(items.some((i) => i.kind === 'shallow'));
});

test('classifyDepth：≥45 分钟为深度，可显式 depth 标记覆盖', () => {
  assert.equal(classifyDepth({ planned_minutes: 90 }), true);
  assert.equal(classifyDepth({ planned_minutes: 25 }), false);
  assert.equal(classifyDepth({ planned_minutes: 20, depth: true }), true);
});

test('ρ：0.85 / 1 两条边界分 ok / tight / over', () => {
  assert.equal(rhoReport({ scheduledMin: 80, availMin: 100, depthDemandMin: 100, budgetMin: 300 }).level, 'ok');
  assert.equal(rhoReport({ scheduledMin: 95, availMin: 100, depthDemandMin: 100, budgetMin: 300 }).level, 'tight');
  const over = rhoReport({ scheduledMin: 100, availMin: 100, depthDemandMin: 320, budgetMin: 300 });
  assert.equal(over.level, 'over');
  assert.ok(over.depthOverMin >= 20);
});

test('自适应提前量：样本不足用默认；迟到 10 分中位 → 提前量 25', () => {
  assert.equal(adaptiveLeadMinutes([], 15), 15);
  assert.equal(adaptiveLeadMinutes([{ lateMin: 2 }, { lateMin: -5 }], 15), 15, '只有 2 个样本不动');
  // 3 个样本，迟到量 8/10/30，中位 10 → 提前 25
  assert.equal(adaptiveLeadMinutes([{ lateMin: 8 }, { lateMin: 10 }, { lateMin: 30 }], 15), 25);
});

test('templateLeadMinutes：按活动模板（尾随数字归一）聚合历史迟到', () => {
  const db = {
    activities: [
      { title: '写章节 1', planned_start: at(9), actual_start: at(9, 20), status: 'Reviewed' },
      { title: '写章节 2', planned_start: at(10), actual_start: at(10, 20), status: 'Reviewed' },
      { title: '写章节 3', planned_start: at(11), actual_start: at(11, 20), status: 'Reviewed' },
    ],
  };
  assert.equal(templateLeadMinutes(db, '写章节 9', 15), 35, '归一后 3 个样本，迟到中位 20 → 35');
});

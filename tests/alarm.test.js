// tests/alarm.test.js
// 闹钟服务纯逻辑：desiredSchedule —— 为 Planned 活动按 planned_start 计算期望闹钟集合（可 node 测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desiredSchedule, parsePlannedStart } from '../src/services/alarm.js';

const NOW = new Date(2026, 8, 7, 12, 0, 0).getTime(); // 2026-9-7 12:00

function mkDB(acts) {
  return { activities: acts, goals: [], plans: [] };
}

test('alarm: parsePlannedStart 解析 YYYY-M-DTHH:MM 与无钟点形态', () => {
  assert.equal(parsePlannedStart('2026-9-8T09:00'), new Date(2026, 8, 8, 9, 0).getTime());
  assert.equal(parsePlannedStart('2026-9-8'), new Date(2026, 8, 8, 0, 0).getTime());
  assert.equal(parsePlannedStart(null), null);
  assert.equal(parsePlannedStart('bad'), null);
});

test('alarm: desiredSchedule 只为「未来 7 天内 + Planned + 有计划时间」的活动建闹钟', () => {
  const db = mkDB([
    { id: 'a5', title: '写大纲', status: 'Planned', planned_start: '2026-9-7T14:00' },    // 今天 14:00 → 未来
    { id: 'a6', title: '跑', status: 'Planned', planned_start: '2026-9-8T09:00' },         // 明天 → 未来
    { id: 'a7', title: '已开始', status: 'Started', planned_start: '2026-9-8T09:00' },     // 非 Planned → 不建
    { id: 'a8', title: '已完成', status: 'Completed', planned_start: '2026-9-8T09:00' },   // 非 Planned → 不建
    { id: 'a9', title: '无时间', status: 'Planned', planned_start: null },                 // 无时间 → 不建
    { id: 'a10', title: '已过期', status: 'Planned', planned_start: '2026-9-6T09:00' },    // 过去 → 不建
    { id: 'a11', title: '八天后', status: 'Planned', planned_start: '2026-9-15T09:00' },   // 超 7 天窗口 → 不建
  ]);
  const sched = desiredSchedule(db, NOW);
  assert.deepEqual(Object.keys(sched).sort(), ['3005', '3006'], '只命中 a5/a6');
  assert.equal(sched['3005'].title, '⏰ 写大纲');
  assert.equal(sched['3005'].at, new Date(2026, 8, 7, 14, 0).getTime());
  assert.equal(sched['3006'].at, new Date(2026, 8, 8, 9, 0).getTime());
});

test('alarm: desiredSchedule 活动 id 无数字部分时用 0 兜底不冲突', () => {
  const db = mkDB([{ id: 'h_abc', title: '哈希id', status: 'Planned', planned_start: '2026-9-8T10:00' }]);
  const sched = desiredSchedule(db, NOW);
  assert.ok(sched['3000'], '无数字 id → 3000 兜底');
  assert.equal(sched['3000'].title, '⏰ 哈希id');
});

test('alarm: desiredSchedule 边界 —— 恰在窗口末尾与恰在过去不建', () => {
  const at = NOW + 7 * 86400000; // 恰 7 天后
  const db = mkDB([{ id: 'a1', title: '边缘', status: 'Planned', planned_start: new Date(at).toISOString().slice(0, 16).replace('T', 'T') }]);
  assert.deepEqual(desiredSchedule(db, at), {}, 'at <= now → 不建');
});

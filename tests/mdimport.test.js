// tests/mdimport.test.js
// 手打 Markdown 批量速录 → 实体候选解析规则（TDD）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMdImport } from '../src/domain/mdimport.js';

const NOW = new Date(2026, 7, 30, 12, 0, 0).getTime(); // 2026-8-30 周日

test('mdimport: 目标/计划/活动 层级归属', () => {
  const md = `# 写一本书
把方法论整理成书

## 第一章
- [ ] 写大纲
- [ ] 写初稿
- 收集素材

## 第二章
- [ ] 校对
`;
  const r = parseMdImport(md, { now: NOW });
  assert.equal(r.goals.length, 1);
  assert.equal(r.goals[0].title, '写一本书');
  assert.equal(r.goals[0].desc, '把方法论整理成书');
  assert.equal(r.plans.length, 2);
  assert.equal(r.plans[0].title, '第一章');
  assert.equal(r.plans[0].goal_key, r.goals[0].key);
  assert.equal(r.plans[1].title, '第二章');
  assert.equal(r.activities.length, 4);
  assert.equal(r.activities[0].plan_key, r.plans[0].key);
  assert.equal(r.activities[2].plan_key, r.plans[0].key); // 普通项也归第一章
  assert.equal(r.activities[3].plan_key, r.plans[1].key);
  assert.equal(r.activities[0].status, 'Planned');
  assert.equal(r.activities[1].status, 'Planned');
  assert.deepEqual(r.warnings, []);
});

test('mdimport: [x] 已完成 + 无排程', () => {
  const r = parseMdImport('# 目标\n- [x] 已完成的事\n- 普通项', { now: NOW });
  assert.equal(r.activities[0].status, 'Completed');
  assert.equal(r.activities[0].planned_start, null);
  assert.equal(r.activities[1].status, 'Planned');
});

test('mdimport: @ 时间指令 —— 明天 9:00 60分钟', () => {
  const r = parseMdImport('# 目标\n- [ ] 写论文 @ 明天 9:00 60分钟', { now: NOW });
  const a = r.activities[0];
  assert.equal(a.title, '写论文');
  assert.equal(a.planned_start, '2026-8-31T09:00'); // 明天 = 8-31（周一）
  assert.equal(a.planned_minutes, 60);
});

test('mdimport: 时间词 —— 今天/后天/周X/月-日', () => {
  const r = parseMdImport(
    '# 目标\n' +
    '- a @ 今天 14:30 30m\n' +
    '- b @ 后天 8:00 1小时\n' +
    '- c @ 周三 9点 45分钟\n' +
    '- d @ 9-2 18:30 2h\n' +
    '- e @ 2026-9-3 10:00',
    { now: NOW });
  const s = (i) => r.activities[i].planned_start;
  assert.equal(s(0), '2026-8-30T14:30'); // 今天
  assert.equal(s(1), '2026-9-1T08:00'); // 后天
  assert.equal(s(2), '2026-9-2T09:00'); // 下周三（今天周日 → 周三 9-2）
  assert.equal(s(3), '2026-9-2T18:30'); // 9-2
  assert.equal(s(4), '2026-9-3T10:00'); // 完整日期
  assert.equal(r.activities[1].planned_minutes, 60); // 1小时
  assert.equal(r.activities[2].planned_minutes, 45);
  assert.equal(r.activities[3].planned_minutes, 120); // 2h
});

test('mdimport: 显式 (计划) 归属 + #标签', () => {
  const r = parseMdImport('# 目标\n## 默认计划\n- [ ] 写 @ 明天 9:00 (写作) #重点', { now: NOW });
  const a = r.activities[0];
  assert.equal(a.title, '写');
  assert.equal(a.note, '#重点');
  assert.equal(a.plan_title, undefined);
  const plan = r.plans.find((p) => p.title === '写作');
  assert.ok(plan, '应创建显式计划「写作」');
  assert.equal(a.plan_key, plan.key);
});

test('mdimport: frontmatter default 全局默认计划/时长', () => {
  const md = `---
default: { plan: 读书计划, minutes: 30 }
---
# 目标
- 晨读
- 晚读 @ 21:00
`;
  const r = parseMdImport(md, { now: NOW });
  assert.equal(r.plans[0].title, '读书计划');
  assert.equal(r.activities[0].plan_key, r.plans[0].key);
  assert.equal(r.activities[0].planned_minutes, 30); // 默认时长
  assert.equal(r.activities[1].planned_start, '2026-8-30T21:00'); // 只给钟点 → 今天
});

test('mdimport: 无法解析的时间指令进 warnings，不阻塞', () => {
  const r = parseMdImport('# 目标\n- [ ] 干活 @ 有空的时候 30m', { now: NOW });
  assert.equal(r.activities.length, 1);
  assert.equal(r.activities[0].planned_start, null); // 无法解析 → 无排程
  assert.equal(r.activities[0].planned_minutes, 30); // 时长仍解析
  assert.ok(r.warnings.length >= 1, '应有解析警告');
});

test('mdimport: 周X 支持 下/下下 前缀', () => {
  const r = parseMdImport('# 目标\n- a @ 周三 9:00\n- b @ 下周三 9:00\n- c @ 下下周三 9:00', { now: NOW });
  const s = (i) => r.activities[i].planned_start;
  assert.equal(s(0), '2026-9-2T09:00'); // 本周三（8-30 周日 → 9-2）
  assert.equal(s(1), '2026-9-9T09:00'); // 下周三
  assert.equal(s(2), '2026-9-16T09:00'); // 下下周三
});

test('mdimport: 空输入 → 空候选', () => {
  const r = parseMdImport('', { now: NOW });
  assert.deepEqual(r.goals, []);
  assert.deepEqual(r.plans, []);
  assert.deepEqual(r.activities, []);
  assert.deepEqual(r.warnings, []);
});

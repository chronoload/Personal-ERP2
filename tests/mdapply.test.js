// tests/mdapply.test.js
// 双向写回：md 候选 → db（带 id 更新 / 无 id 新建）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMdImport, serializeDbToMd } from '../src/domain/mdimport.js';
import { applyCandidates } from '../src/domain/mdapply.js';

const NOW = new Date(2026, 7, 30, 12, 0, 0).getTime();

function freshDB() {
  return {
    schemaVersion: 3, resources: [], rules: [],
    goals: [], plans: [], activities: [],
    txs: [], outputs: [], valueflows: [], goods: [],
    seq: { r: 0, ru: 0, g: 0, p: 0, a: 0, t: 0, o: 0, v: 0, gd: 0 },
  };
}

test('mdapply: 手打 md（无 id）→ 新建 目标/计划/活动，层级关联正确', () => {
  const db = freshDB();
  const md = `# 写一本书\n方法论成书。\n\n## 第一章\n- [ ] 写大纲 @ 明天 9:00 60分钟\n- 收集素材\n`;
  const r = parseMdImport(md, { now: NOW });
  const stat = applyCandidates(db, r);
  assert.equal(stat.created, 4); // 1 目标 + 1 计划 + 2 活动
  assert.equal(stat.updated, 0);
  assert.equal(db.goals.length, 1);
  assert.equal(db.goals[0].title, '写一本书');
  assert.equal(db.goals[0].desc, '方法论成书。');
  assert.equal(db.plans.length, 1);
  assert.equal(db.plans[0].goal_id, db.goals[0].id);
  assert.equal(db.activities.length, 2);
  const a1 = db.activities[0];
  assert.equal(a1.plan_ids[0], db.plans[0].id);
  assert.equal(a1.planned_start, '2026-8-31T09:00');
  assert.equal(a1.planned_minutes, 60);
  assert.equal(a1.status, 'Planned');
});

test('mdapply: 双向 round-trip —— 导回按 id 更新而非复制', () => {
  const db = freshDB();
  // 先用一般方式创建
  const md1 = `# 写一本书\n\n## 第一章\n- [ ] 写大纲 @ 明天 9:00 60分钟\n`;
  applyCandidates(db, parseMdImport(md1, { now: NOW }));
  assert.equal(db.activities.length, 1);
  const before = db.activities[0].id;

  // 导出 md → 手改标题/时间 → 导回
  const md2 = serializeDbToMd(db);
  const edited = md2.replace('写大纲', '写大纲（改）').replace('2026-8-31 09:00', '2026-8-31 10:30');
  const stat = applyCandidates(db, parseMdImport(edited, { now: NOW }));
  assert.equal(db.activities.length, 1, '应更新而非复制');
  assert.equal(db.activities[0].id, before, 'id 保持不变');
  assert.equal(db.activities[0].title, '写大纲（改）');
  assert.equal(db.activities[0].planned_start, '2026-8-31T10:30');
  assert.equal(db.goals.length, 1, '目标也应更新而非复制');
  assert.equal(db.plans.length, 1);
});

test('mdapply: [x] 完成态不绕过状态机 —— 创建为 Planned 并提示走完成流程', () => {
  const db = freshDB();
  const r = parseMdImport('# 目标\n## 计划\n- [x] 已完成的事', { now: NOW });
  const stat = applyCandidates(db, r);
  const a = db.activities[0];
  assert.equal(a.status, 'Planned'); // Completed 需经 Started+完成流程，不直设
  assert.ok(stat.warnings.some((w) => w.includes('完成')), '应提示完成态未生效');
});

test('mdapply: 无关联计划的活动 plan_key 为空 → plan_ids 为空数组', () => {
  const db = freshDB();
  const r = parseMdImport('- 顶层活动（无目标无计划）', { now: NOW });
  applyCandidates(db, r);
  assert.equal(db.activities.length, 1);
  assert.deepEqual(db.activities[0].plan_ids, []);
});

test('mdapply: round-trip 幂等 —— 导回后再次导出结构稳定', () => {
  const db = freshDB();
  const md1 = `# 目标A\n描述。\n\n## 计划A\n- [ ] 任务 @ 明天 9:00 30分钟\n`;
  applyCandidates(db, parseMdImport(md1, { now: NOW }));
  const mdA = serializeDbToMd(db);
  applyCandidates(db, parseMdImport(mdA, { now: NOW })); // 二次导回
  const mdB = serializeDbToMd(db);
  assert.equal(mdB, mdA, '二次 round-trip 后 md 稳定（不产生漂移）');
});

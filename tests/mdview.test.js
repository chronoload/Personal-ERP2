// tests/mdview.test.js
// 「视图」= db 重排成不同语义 md（日/周/月组织器）+ 日期组解析 + 视图局部同步
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as eng from '../src/domain/engine.js';
import { parseMdImport, serializeEntityLine, replaceEntityLine } from '../src/domain/mdimport.js';
import { applyCandidates } from '../src/domain/mdapply.js';
import { organizeDay, organizeWeek, organizeMonth } from '../src/views/mdviews.js';

const NOW = new Date(2026, 8, 2, 12, 0, 0).getTime(); // 2026-9-2 周三

function freshDB() {
  return {
    schemaVersion: 3, resources: [], rules: [],
    goals: [], plans: [], activities: [],
    txs: [], outputs: [], valueflows: [], goods: [],
    seq: { r: 0, ru: 0, g: 0, p: 0, a: 0, t: 0, o: 0, v: 0, gd: 0 },
  };
}
function seedDB() {
  const db = freshDB();
  eng.createGoal(db, { title: '写一本书', desc: '' });
  eng.createPlan(db, { goal_id: db.goals[0].id, title: '第一章', budget: null });
  eng.createActivity(db, { title: '写大纲', note: '', plan_ids: [db.plans[0].id], planned_start: '2026-9-2T09:00', planned_minutes: 60 });
  eng.createActivity(db, { title: '校对', note: '', plan_ids: [db.plans[0].id], planned_start: '2026-9-3T18:00', planned_minutes: 45 });
  eng.createActivity(db, { title: '随便想想', note: '', plan_ids: [], planned_start: null, planned_minutes: 0 });
  return db;
}

test('mdview: 周视图组织器 —— db 重排成按日期分组 md（含 view 标记 + 隐藏式 id）', () => {
  const db = seedDB();
  const md = organizeWeek(db, null, NOW);
  assert.ok(md.startsWith('---\nview: week'), '应带 view: week 标记');
  assert.ok(md.includes('# 本周 · 2026-8-31 ~ 2026-9-6'), '周范围 2026-9-2 所在周（周一 8-31）');
  assert.ok(md.includes('## 2026-9-2 周三'), '9-2 分组');
  assert.ok(md.includes('- [ ] 写大纲 @ 09:00 60分钟 (第一章) <!--id:a1-->'), '活动行（钟点由日期组承载）');
  assert.ok(md.includes('## 2026-9-3 周四'));
  assert.ok(md.includes('## 未排程'));
  assert.ok(md.includes('- [ ] 随便想想 <!--id:a3-->'));
});

test('mdview: 日期组标题 → 活动补默认日期；view 标记被解析', () => {
  const db = seedDB();
  const md = organizeWeek(db, null, NOW);
  const r = parseMdImport(md, { now: NOW });
  assert.equal(r.view, 'week', '解析应识别 view');
  const a1 = r.activities.find((x) => x.id === 'a1');
  assert.equal(a1.title, '写大纲');
  assert.equal(a1.planned_start, '2026-9-2T09:00', '「## 2026-9-2」组 + @ 09:00 → 补日期');
  const a2 = r.activities.find((x) => x.id === 'a2');
  assert.equal(a2.planned_start, '2026-9-3T18:00');
  const a3 = r.activities.find((x) => x.id === 'a3');
  assert.equal(a3.planned_start, null, '未排程组不补日期');
  assert.equal(a1.plan_title, undefined);
});

test('mdview: 视图局部同步 —— 改标题/时间只更新该活动，完全不干扰其他', () => {
  const db = seedDB();
  const md = organizeWeek(db, null, NOW);
  // 模拟用户直接编辑文本：改 a1 标题 + 时间
  const edited = md.replace('写大纲', '写大纲（改）').replace('@ 09:00', '@ 10:30');
  const r = parseMdImport(edited, { now: NOW });
  const stat = applyCandidates(db, r);
  assert.equal(stat.updated, 1, '只更新被编辑的活动');
  const a1 = db.activities.find((x) => x.id === 'a1');
  assert.equal(a1.title, '写大纲（改）', '改名绑定同一对象');
  assert.equal(a1.planned_start, '2026-9-2T10:30');
  // 其他完全不动
  assert.equal(db.activities.length, 3, '不新增不删除');
  assert.equal(db.goals.length, 1, '不创建「未分类」目标');
  assert.equal(db.plans.length, 1, '不创建/复制计划');
  assert.equal(db.activities.find((x) => x.id === 'a2').planned_start, '2026-9-3T18:00');
  assert.deepEqual(stat.deletions, [], '视图局部同步不缺失即删');
  assert.equal(stat.created, 0);
});

test('mdview: 月视图组织器 —— 只列本月活动，跨月活动不出现', () => {
  const db = seedDB();
  const md = organizeMonth(db, null, NOW);
  assert.ok(md.startsWith('---\nview: month'));
  assert.ok(md.includes('# 本月 · 2026年9月'));
  assert.ok(md.includes('## 2026-9-2 周三'));
  assert.ok(md.includes('## 2026-9-3 周四'));
  // 9-3 在 9 月内 ✓；10 月活动不应出现
  eng.createActivity(db, { title: '下月事', note: '', plan_ids: [], planned_start: '2026-10-5T10:00', planned_minutes: 30 });
  const md2 = organizeMonth(db, null, NOW);
  assert.ok(!md2.includes('下月事'), '跨月活动不应出现在本月视图');
});

test('mdview: 日视图组织器 —— 仅 anchor 所在日；可切换日期', () => {
  const db = seedDB();
  const md = organizeDay(db, null, NOW);
  assert.ok(md.startsWith('---\nview: day'));
  assert.ok(md.includes('# 今日 · 2026-9-2 周三'));
  assert.ok(md.includes('- [ ] 写大纲 @ 09:00'), '9-2 的活动在今日视图');
  assert.ok(!md.includes('校对'), '9-3 活动不在今日视图');
  // 切到 9-3（锚点）
  const md3 = organizeDay(db, '2026-9-3', NOW);
  assert.ok(md3.includes('# 今日 · 2026-9-3 周四'));
  assert.ok(md3.includes('校对'), '切到 9-3 显示 9-3 活动');
  assert.ok(!md3.includes('写大纲'), '9-2 活动不在 9-3 视图');
});

test('mdview: 单行序列化 + 局部替换（serializeEntityLine / replaceEntityLine）', () => {
  const db = seedDB();
  const line = serializeEntityLine(db, db.activities[0]);
  assert.ok(line.includes('- [ ] 写大纲 @ 2026-9-2 09:00 60分钟 (第一章) <!--id:a1-->'), '单行完整含隐藏式 id');
  const md = `# 写一本书 <!--id:g1-->\n\n## 第一章 <!--id:p1-->\n\n${line}\n`;
  const replaced = replaceEntityLine(md, 'a1', '- [ ] 写大纲（改） <!--id:a1-->');
  assert.ok(replaced.includes('写大纲（改）'), '替换目标行');
  assert.ok(replaced.includes('<!--id:g1-->'), '其他行不受影响');
  // 删行
  const removed = replaceEntityLine(md, 'a1', '');
  assert.ok(!removed.includes('写大纲'), '删除目标行');
  assert.ok(removed.includes('# 写一本书'), '其他行保留');
  // lute 链接式 id 也能定位替换
  const mdL = '- [ ] 任务 [!--id:a9--](!--id:a9--)\n';
  assert.ok(replaceEntityLine(mdL, 'a9', '- [ ] 任务2 <!--id:a9-->').includes('任务2'));
});

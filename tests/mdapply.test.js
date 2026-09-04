// tests/mdapply.test.js
// 双向写回：md 候选 → db（名称+所属匹配 / hash 稳定 id / 状态对齐 / 镜像缺失即删）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMdImport, serializeDbToMd, repairIdMarkers } from '../src/domain/mdimport.js';
import { applyCandidates, applyDeletions } from '../src/domain/mdapply.js';
import * as eng from '../src/domain/engine.js';

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

test('mdapply: 双向 round-trip —— 改标题+时间，按隐藏式 id 绑定更新同一对象（改名不断链）', () => {
  const db = freshDB();
  // 先用一般方式创建
  const md1 = `# 写一本书\n\n## 第一章\n- [ ] 写大纲 @ 明天 9:00 60分钟\n`;
  applyCandidates(db, parseMdImport(md1, { now: NOW }));
  assert.equal(db.activities.length, 1);
  const before = db.activities[0].id;

  // 导出 md（带隐藏式 id 绑定）→ 改标题+时间 → 导回：按 id 命中已有实体，不改名不断链
  const md2 = serializeDbToMd(db);
  assert.ok(md2.includes('<!--id:'), '导出 md 应带隐藏式 id 绑定标记');
  const edited = md2
    .replace('2026-8-31 09:00', '2026-8-31 10:30')
    .replace('- [ ] 写大纲', '- [ ] 写大纲（改）');
  const stat = applyCandidates(db, parseMdImport(edited, { now: NOW }));
  assert.equal(db.activities.length, 1, '应更新而非复制');
  assert.equal(db.activities[0].id, before, 'id 保持不变（改名不断链）');
  assert.equal(db.activities[0].title, '写大纲（改）');
  assert.equal(db.activities[0].planned_start, '2026-8-31T10:30');
  assert.equal(db.goals.length, 1, '目标也应更新而非复制');
  assert.equal(db.plans.length, 1);
  assert.equal(stat.created, 0, '全部命中已有实体，不应新建');
  assert.equal(stat.updated, 3, '目标/计划/活动各更新一次');
  assert.deepEqual(stat.deletions, [], '改名绑定不应触发删除');
});

test('mdapply: 手打 md 改名（无 id）→ 一律新建（新增语义），原实体保留', () => {
  const db = freshDB();
  const md1 = `# 写一本书\n\n## 第一章\n- [ ] 写大纲\n`;
  applyCandidates(db, parseMdImport(md1, { now: NOW }));
  assert.equal(db.activities.length, 1);
  const before = db.activities[0].id;

  // 手打（无 id）改名 → 无 id 一律新建（目标/计划/活动各新建），原实体保留
  const stat = applyCandidates(db, parseMdImport('# 写一本书\n## 第一章\n- [ ] 写大纲（改）', { now: NOW }));
  assert.equal(stat.created, 3, '目标/计划/活动各新建');
  assert.equal(db.activities.length, 2, '手打无绑定 → 改名 = 新实体');
  assert.equal(db.activities[0].id, before);
  const nw = db.activities.find((a) => a.title === '写大纲（改）');
  assert.ok(nw.id && nw.id !== before, '新建 id 由 db 授予（非内容推导），与原实体不同');
  assert.deepEqual(stat.deletions, [], '非镜像不删');
});

test('mdapply: 完整镜像缺失即删 —— 删行后目标/计划/活动同步收集待删并删除', () => {
  const db = freshDB();
  const md1 = `# 目标A\n\n## 计划A\n- [ ] 任务\n## 计划B\n- [ ] 别的事\n`;
  applyCandidates(db, parseMdImport(md1, { now: NOW }));
  assert.equal(db.activities.length, 2);
  assert.equal(db.plans.length, 2);

  // 导出的镜像里删掉「计划B + 别的事」→ 应用收集待删（不实际删），确认后删除
  const md2 = serializeDbToMd(db);
  const reduced = md2.replace(/## 计划B[^\n]*\n- \[ \] 别的事[^\n]*\n?/, '');
  assert.notEqual(reduced, md2, '应成功删去计划B段');
  const stat = applyCandidates(db, parseMdImport(reduced, { now: NOW }));
  assert.equal(stat.created, 0);
  assert.ok(stat.deletions.some((d) => d.type === 'activity' && d.title === '别的事'), '活动进待删');
  assert.ok(stat.deletions.some((d) => d.type === 'plan' && d.title === '计划B'), '计划进待删');

  const del = applyDeletions(db, stat.deletions);
  assert.equal(del.deleted, 2, '计划B + 别的事 删除');
  assert.equal(db.activities.length, 1);
  assert.equal(db.plans.length, 1);
  assert.equal(db.plans[0].title, '计划A');
});

test('mdapply: 非镜像（手打）不删除 —— 删行后缺失实体保留', () => {
  const db = freshDB();
  const md1 = `# 目标A\n## 计划A\n- [ ] 任务`;
  applyCandidates(db, parseMdImport(md1, { now: NOW }));
  // 手打一段不完整的 md（无 mirror）→ 不触发缺失即删
  const r = parseMdImport('# 目标A\n## 计划A', { now: NOW });
  assert.equal(r.mirror, false);
  const stat = applyCandidates(db, r);
  assert.deepEqual(stat.deletions, [], '手打 md 不应收集删除');
  assert.equal(db.activities.length, 1, '活动应保留');
});

test('mdapply: 状态对齐 —— 带 id 行修改状态，合法流转生效，非法流转 warning 不绕过', () => {
  const db = freshDB();
  applyCandidates(db, parseMdImport('# 目标\n## 计划\n- [ ] 任务', { now: NOW }));
  assert.equal(db.activities[0].status, 'Planned');
  const md = serializeDbToMd(db); // 带隐藏式 id 的镜像（编辑器内行）
  // (进行中) → Planned→Started 合法流转
  const st = applyCandidates(db, parseMdImport(md.replace('- [ ] 任务', '- [ ] 任务 (进行中)'), { now: NOW }));
  assert.equal(db.activities[0].status, 'Started', '带 id 行 (进行中) 合法流转应生效');
  // (归档) → Started→Archived 非法 → warning，状态不动
  const st2 = applyCandidates(db, parseMdImport(md.replace('- [ ] 任务', '- [ ] 任务 (归档)'), { now: NOW }));
  assert.equal(db.activities[0].status, 'Started', '非法流转不应生效');
  assert.ok(st2.warnings.some((w) => w.includes('未生效')), '应提示状态未生效');
});

test('mdapply: 镜像 round-trip 状态不漂移 —— 归档实体导回仍归档、无待删', () => {
  // 已有归档账本（模拟历史数据）：目标/活动已是 Archived
  const db = {
    goals: [{ id: 'g1', title: '目标A', status: 'Archived', desc: '' }],
    plans: [{ id: 'p1', goal_id: 'g1', title: '计划A', status: 'Active' }],
    activities: [{ id: 'a1', title: '任务', plan_ids: ['p1'], status: 'Archived', planned_start: null, planned_minutes: 0 }],
    resources: [], rules: [], txs: [], outputs: [], valueflows: [], goods: [], seq: {},
  };
  const mdA = serializeDbToMd(db);
  assert.ok(mdA.includes('# 目标A (归档)'));
  assert.ok(mdA.includes('- [ ] 任务 (计划A) (归档)'));
  const s = applyCandidates(db, parseMdImport(mdA, { now: NOW }));
  assert.deepEqual(s.deletions, [], '镜像 round-trip 不应有待删');
  // 候选 status === db status → 跳过状态对齐，不漂移
  assert.equal(db.goals[0].status, 'Archived');
  assert.equal(db.activities[0].status, 'Archived');
  const mdB = serializeDbToMd(db);
  assert.equal(mdB, mdA, 'round-trip 后 md 稳定');
});

test('mdapply: 无 id 新增行不覆写已有同名对象（防覆写）', () => {
  const db = freshDB();
  // 先有一份「写大纲」（无 id 手打 → 新建）
  applyCandidates(db, parseMdImport('# 目标\n## 计划\n- [ ] 写大纲', { now: NOW }));
  assert.equal(db.activities.length, 1);
  const beforeId = db.activities[0].id;
  // 再手打一行同名（无 id）→ 视为新增，不按名称匹配覆写已有对象
  const stat = applyCandidates(db, parseMdImport('# 目标\n## 计划\n- [ ] 写大纲', { now: NOW }));
  assert.equal(stat.created, 3, '无 id 一律新建（目标/计划/活动）');
  assert.equal(db.activities.length, 2, '不覆写，新增一条');
  assert.ok(db.activities.some((x) => x.id === beforeId), '原对象保留');
  assert.equal(db.goals.length, 2);
  assert.equal(db.plans.length, 2);
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

test('mdapply: 稳健化 —— 空标题/相邻重复/同 id 重复 不产生错乱；同内容两行得不同 id', () => {
  // D1：回车空项（- [ ] 无标题）不落库
  let db = freshDB();
  applyCandidates(db, parseMdImport('# 目标\n## 计划\n- [ ] 写\n- [ ]', { now: NOW }));
  assert.equal(db.activities.length, 1, '空标题行不落库（D1）');
  // D2：相邻内容完全相同（回车/复制误操作）→ 只建一个
  db = freshDB();
  const st2 = applyCandidates(db, parseMdImport('# 目标\n## 计划\n- [ ] 读 @ 9:00\n- [ ] 读 @ 9:00', { now: NOW }));
  assert.equal(db.activities.length, 1, '相邻相同行只建一个（D2）');
  assert.ok(st2.warnings.some((w) => w.includes('合并')), '合并有提示');
  // 身份不可推导：非相邻同内容 → 两个独立活动，id 不同
  db = freshDB();
  const st3 = applyCandidates(db, parseMdImport('# 目标\n## 计划\n- [ ] 运动\n- [ ] 喝水\n- [ ] 运动', { now: NOW }));
  assert.equal(db.activities.length, 3, '非相邻同内容 → 各自独立活动');
  const ids3 = db.activities.map((a) => a.id);
  assert.equal(new Set(ids3).size, ids3.length, '无重复 id（身份由 db 授予，非内容推导）');
  // D3：同 id 两行（编辑器复制了隐藏 id）→ 第二个忽略
  db = freshDB();
  const st4 = applyCandidates(db, parseMdImport(`# 目标\n## 计划\n- [ ] 唯一事 <!--id:dup1-->\n- [ ] 唯一事 <!--id:dup1-->`, { now: NOW }));
  assert.equal(db.activities.filter((a) => a.id === 'dup1').length, 1, '同 id 只保留一个（D3）');
  assert.ok(st4.warnings.some((w) => w.includes('重复 id')), '同 id 重复有提示');
});

test('mdapply: 空标题带 id 残留行不触发缺失即删（ghostIds 防误删）', () => {
  const db = freshDB();
  eng.createActivity(db, { title: '写', note: '', plan_ids: [], planned_start: '2026-8-30T09:00', planned_minutes: 30 });
  const a1 = db.activities[0];
  // 回车副本残留：镜像里 a1 只剩「空标题但带 id」的行 → 该 id 仍被引用，不得判缺失
  const md = `---
mirror: true
---

# 目标
- [ ] <!--id:${a1.id}-->
`;
  const st = applyCandidates(db, parseMdImport(md, { now: NOW }));
  assert.ok(!st.deletions.some((d) => d.type === 'activity' && d.id === a1.id), '空标题带 id 残留行 → a1 不判缺失即删');
  assert.equal(db.activities.find((x) => x.id === a1.id)?.title, '写', 'a1 实体保留');
});

test('mdapply: 回车空待办继承前一个 id 不产生副本 —— 空行 id 归还给原行', () => {
  // 模拟 db 已有活动 a5「写大纲」
  const db = freshDB();
  eng.createActivity(db, { title: '写大纲', note: '', plan_ids: [], planned_start: null, planned_minutes: 30 });
  const a5 = db.activities[0];
  // Vditor 回车后：原行 `- [ ] 写大纲` 丢了 id，新空待办行 `- [ ]` 带着 <!--id:a5-->
  const md = `---
mirror: true
---

- [ ] 写大纲
- [ ] <!--id:${a5.id}-->
`;
  const st = applyCandidates(db, parseMdImport(md, { now: NOW }));
  assert.equal(db.activities.length, 1, '空行继承的 id 归还给原行 → 不复制副本');
  assert.equal(db.activities[0].id, a5.id, '原行绑定回 a5');
  assert.equal(db.activities[0].title, '写大纲', '原行内容保留');
  assert.equal(st.created, 0, '不新建副本');
  assert.deepEqual(st.deletions, [], '不误删');
});

test('mdapply: 空待办重复继承同一 id（纯复制，Shape A）不产生错乱', () => {
  const db = freshDB();
  eng.createActivity(db, { title: '写大纲', note: '', plan_ids: [], planned_start: null, planned_minutes: 30 });
  const a5 = db.activities[0];
  // 纯复制：原行仍带 id，空行也复制了同一 id → 只保留一个实体，不判缺失
  const md = `---
mirror: true
---

- [ ] 写大纲 <!--id:${a5.id}-->
- [ ] <!--id:${a5.id}-->
`;
  const st = applyCandidates(db, parseMdImport(md, { now: NOW }));
  assert.equal(db.activities.filter((a) => a.id === a5.id).length, 1, '同一 id 只有一个实体');
  assert.equal(db.activities.length, 1);
  assert.equal(st.created, 0);
  assert.deepEqual(st.deletions, [], '不误删');
});

test('mdimport: repairIdMarkers 把回车下移的空行 id 归还给原行（文本级错位修复）', () => {
  const md = `# 目标\n- [ ] 写大纲\n- [ ] <!--id:a5-->`;
  const out = repairIdMarkers(md);
  assert.ok(out.includes('- [ ] 写大纲 <!--id:a5-->'), '写大纲行被补回 id');
  assert.ok(!out.includes('- [ ] <!--id:a5-->'), '空行不再携带 id');
  assert.ok(!out.includes('- [ ]  <!--id:a5-->'), '空行仅剩无 id 的 `- [ ]`');
  // 幂等：修复后再跑不变化
  assert.equal(repairIdMarkers(out), out, '修复幂等');
});

test('mdimport: repairIdMarkers 纯复制（Shape A）只去掉空行的重复 id', () => {
  const md = `# 目标\n- [ ] 写大纲 <!--id:a5-->\n- [ ] <!--id:a5-->`;
  const out = repairIdMarkers(md);
  assert.equal((out.match(/<!--id:a5-->/g) || []).length, 1, '同一 id 只保留一份');
  assert.ok(out.includes('- [ ] 写大纲 <!--id:a5-->'), '原行 id 保留');
});

test('mdapply: 裸 id 残余（WYSIWYG 退化形态）被剥离，不产生以 ID 为名的活动/计划/目标', () => {
  // Vditor WYSIWYG 的 getValue() 把 HTML 注释 `<!--id:x-->` 退化输出为裸文本 `!--id:x--`，
  // 若不剥离会被当成标题内容 → 创建出「以 a5/p1/g1 为名」的垃圾实体。
  const r = parseMdImport('# 目标A !--id:g1--\n## 计划A !--id:p1--\n- [ ] 写大纲 !--id:a5--', { now: NOW });
  assert.equal(r.goals[0].title, '目标A', '目标名不含裸 id 残余');
  assert.equal(r.goals[0].id, 'g1', '目标绑定到 g1');
  assert.equal(r.plans[0].title, '计划A', '计划名不含裸 id 残余');
  assert.equal(r.plans[0].id, 'p1', '计划绑定到 p1');
  assert.equal(r.activities[0].title, '写大纲', '活动名不含裸 id 残余');
  assert.equal(r.activities[0].id, 'a5', '活动绑定到 a5');
  for (const ent of [...r.goals, ...r.plans, ...r.activities]) {
    assert.ok(!String(ent.title).includes('!--id'), `「${ent.title}」不应含裸 id 标记`);
  }
  // 空待办只剩裸 id（回车错位）：不应成为以 id 为名的活动，且不误删
  const db = freshDB();
  eng.createActivity(db, { title: '写', note: '', plan_ids: [], planned_start: null, planned_minutes: 30 });
  const a = db.activities[0];
  const st = applyCandidates(db, parseMdImport(`---
mirror: true
---

- [ ] 写 !--id:${a.id}--
- [ ] !--id:${a.id}--
`, { now: NOW }));
  assert.equal(db.activities.length, 1, '不新增以 a.id 为名的活动');
  assert.ok(!db.activities.some((x) => x.title.includes(a.id)), '没有以 `${a.id}` 为名的活动');
  assert.equal(db.activities[0].title, '写', '原活动保留');
  assert.deepEqual(st.deletions, [], '不误删');
});

test('mdapply: 视图内添加 —— 无 id 新行新建活动并返回 createdRefs（可补 id 绑定）', () => {
  const db = freshDB();
  eng.createActivity(db, { title: '已有', note: '', plan_ids: [], planned_start: '2026-8-30T09:00', planned_minutes: 30 });
  // 视图 md：带 id 的已有活动 + 无 id 新行
  const viewMd = `---
view: day
updated: 2026-8-30
---

# 今日 · 2026-8-30 周日

## 2026-8-30 周日
- [ ] 已有 @ 09:00 <!--id:${db.activities[0].id}-->
- [ ] 新增 @ 10:00 45分钟
`;
  const r = parseMdImport(viewMd, { now: NOW });
  const st = applyCandidates(db, r);
  assert.equal(st.created, 1, '无 id 新行 → 新建');
  assert.equal(st.updated, 0, '带 id 行与 db 无差异 → 不触碰（视图只同步实际变更）');
  assert.equal(st.createdRefs.length, 1);
  const created = db.activities.find((a) => a.title === '新增');
  assert.ok(created, '「新增」已入库');
  assert.equal(created.planned_start, '2026-8-30T10:00');
  assert.equal(created.planned_minutes, 45);
  assert.equal(st.createdRefs[0].id, created.id, 'createdRefs 返回新 id 供补绑定');
  assert.equal(st.deletions.length, 0, '视图内都有 → 无待删');
  // 重复应用同视图（新行已补 id）→ 不再重复创建
  const viewMd2 = `---
view: day
updated: 2026-8-30
---

# 今日 · 2026-8-30 周日

## 2026-8-30 周日
- [ ] 已有 @ 09:00 <!--id:${db.activities[0].id}-->
- [ ] 新增 @ 10:00 45分钟 <!--id:${created.id}-->
`;
  const st2 = applyCandidates(db, parseMdImport(viewMd2, { now: NOW }));
  assert.equal(st2.created, 0, '补 id 后重复应用不重复创建');
});

test('mdapply: 视图内删除 —— 范围内缺失即删、范围外完全不碰', () => {
  const db = freshDB();
  eng.createActivity(db, { title: '今天的事', note: '', plan_ids: [], planned_start: '2026-8-30T09:00', planned_minutes: 30 });
  eng.createActivity(db, { title: '明天的事', note: '', plan_ids: [], planned_start: '2026-8-31T09:00', planned_minutes: 30 });
  const today = db.activities[0];
  // 日视图（只含今天）但删掉了「今天的事」行 → 范围内缺失即删；「明天的事」在范围外不受影响
  const viewMd = `---
view: day
updated: 2026-8-30
---

# 今日 · 2026-8-30 周日

## 2026-8-30 周日
- [ ] 另一件事 @ 09:00
`;
  const st = applyCandidates(db, parseMdImport(viewMd, { now: NOW }));
  assert.equal(st.deletions.length, 1, '范围内缺失 1 条');
  assert.equal(st.deletions[0].id, today.id, '待删为今天的事');
  assert.ok(!st.deletions.some((d) => d.title === '明天的事'), '范围外（明天）不删');
});

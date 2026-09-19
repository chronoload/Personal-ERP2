// tests/md_sync_dup.test.js
// 移动端 md 同步稳健性：「分钟条目不断被重复」根因守卫（TDD 先行）。
//   R1 匹配优先：无 id 行在作用域内按「规范标题+排程」匹配既有活动 → 绑定既有 id，不新建（幂等）
//   R2 绑定回执：匹配既有 id 时返回 bindRefs（与 createdRefs 同构），供编辑器把既有 id 补到行上
//   R3 bindEntityLine 容忍缩进/有序列表任务行
//   R4 repairIdMarkers 识别裸残余 id（!--id:x--）文本级修复
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMdImport, repairIdMarkers, bindEntityLine, serializeDbToMd } from '../src/domain/mdimport.js';
import { organizeDay } from '../src/views/mdviews.js';
import { applyCandidates } from '../src/domain/mdapply.js';
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

const dayView = (rows) => `---
view: day
updated: 2026-8-30
---

# 今日 · 2026-8-30 周日

## 2026-8-30 周日
${rows}
`;

test('R1 匹配优先：id 丢失的无 id 行按「标题+排程」匹配既有活动 → 不新建副本', () => {
  const db = freshDB();
  eng.createActivity(db, { title: '阅读', note: '', plan_ids: [], planned_start: '2026-8-30T09:00', planned_minutes: 30 });
  const before = db.activities.length;
  // 移动端 WebView 场景：行的隐藏式 id 在编辑器中丢失（行尾无 <!--id:-->）
  const st = applyCandidates(db, parseMdImport(dayView('- [ ] 阅读 @ 09:00 30分钟'), { now: NOW }));
  assert.equal(db.activities.length, before, '不新建副本');
  assert.equal(st.created, 0, 'created=0');
  assert.ok((st.createdRefs || []).some((x) => x.id === db.activities[0].id && x.bind), 'bindRefs 返回既有 id 供补绑定');
});

test('R1b 幂等：同一份视图 md 连续应用两次 → 第二次零新建（重复守卫收敛）', () => {
  const db = freshDB();
  eng.createActivity(db, { title: '阅读', note: '', plan_ids: [], planned_start: '2026-8-30T09:00', planned_minutes: 30 });
  const r = parseMdImport(dayView('- [ ] 阅读 @ 09:00 30分钟'), { now: NOW });
  applyCandidates(db, r);
  const n1 = db.activities.length;
  const st2 = applyCandidates(db, parseMdImport(dayView('- [ ] 阅读 @ 09:00 30分钟'), { now: NOW }));
  assert.equal(db.activities.length, n1, '第二次应用不新增');
  assert.equal(st2.created, 0, '第二次 created=0');
});

test('R1c 绑定失败也不重复：编辑器未补上 id 的行再次同步 → 仍匹配既有不新建', () => {
  const db = freshDB();
  eng.createActivity(db, { title: '写作', note: '', plan_ids: [], planned_start: '2026-8-30T09:00', planned_minutes: 25 });
  // 日期组内的行（时间匹配既有）id 丢失：连续三次同步，一行也不该复制出三份。
  //（此前该断言靠标题污染「写作 25分钟」碰巧通过；裸时长解析修复后按本意校验）
  const r = () => parseMdImport(dayView('- [ ] 写作 @ 09:00 25分钟'), { now: NOW });
  applyCandidates(db, r());
  applyCandidates(db, r());
  applyCandidates(db, r());
  assert.equal(db.activities.filter((a) => a.title === '写作').length, 1, '同内容只保留一份');
});

test('R1d 匹配不误伤：同标题但不同时间 → 仍新建', () => {
  const db = freshDB();
  eng.createActivity(db, { title: '阅读', note: '', plan_ids: [], planned_start: '2026-8-30T09:00', planned_minutes: 30 });
  const before = db.activities.length;
  const st = applyCandidates(db, parseMdImport(dayView('- [ ] 阅读 @ 14:00 30分钟'), { now: NOW }));
  assert.equal(db.activities.length, before + 1, '不同排程 → 新建');
  assert.equal(st.created, 1);
});

test('R1e 作用域隔离：日视图里的无 id 行不得匹配范围外（其他日期）活动', () => {
  const db = freshDB();
  eng.createActivity(db, { title: '阅读', note: '', plan_ids: [], planned_start: '2026-8-31T09:00', planned_minutes: 30 });
  const before = db.activities.length;
  const st = applyCandidates(db, parseMdImport(dayView('- [ ] 阅读 @ 09:00 30分钟'), { now: NOW }));
  assert.equal(db.activities.length, before + 1, '范围外不匹配 → 新建今天的新活动');
  assert.equal(st.created, 1);
});

test('R1f 镜像模式同样守卫：无 id 行匹配既有活动不新建', () => {
  const db = freshDB();
  eng.createGoal(db, { title: '成长', desc: '' });
  const gid = db.goals[db.goals.length - 1].id;
  eng.createPlan(db, { goal_id: gid, title: '每日阅读', budget: null });
  const pid = db.plans[db.plans.length - 1].id;
  eng.createActivity(db, { title: '阅读', note: '', plan_ids: [pid], planned_start: '2026-8-30T09:00', planned_minutes: 30 });
  const before = db.activities.length;
  const md = `---
mirror: true
---

# 成长 <!--id:${gid}-->

## 每日阅读 <!--id:${pid}-->

- [ ] 阅读 @ 2026-8-30 09:00 30分钟
`;
  const st = applyCandidates(db, parseMdImport(md, { now: NOW }));
  assert.equal(db.activities.length, before, '镜像里 id 丢失行也不新建');
  assert.equal(st.created, 0);
  assert.ok((st.createdRefs || []).some((x) => x.bind), 'bindRefs 返回既有 id');
});

test('R3 bindEntityLine：缩进任务行可补 id', () => {
  const md = '- [ ] 父项\n  - [ ] 阅读 @ 09:00 30分钟';
  const out = bindEntityLine(md, 'activity', '阅读', 'a9');
  assert.ok(/- \[ \] 父项/.test(out), '父行不动');
  assert.ok(/^\s*- \[ \] 阅读[^\n]*<!--id:a9-->$/m.test(out), '缩进行补上 id');
});

test('R3c bindEntityLine：同标题已绑定行在前，无 id 行在后 → 必须绑到无 id 行（g 标志回归）', () => {
  // 无 g 时 replace 只访问第一个同标题行（已绑定）→ 后面的无 id 行永远轮不到 → 每轮同步复制副本
  const md = '- [ ] 阅读 @ 09:00 30分钟 (未分类) [!--id:a1--](!--id:a1--)\n- [ ] 阅读 @ 09:00 30分钟';
  const out = bindEntityLine(md, 'activity', '阅读', 'a2', 0);
  assert.ok(out.includes('阅读 @ 09:00 30分钟 <!--id:a2-->'), '无 id 行补上 a2');
  assert.equal(out.match(/!--id:a1--/g).length, 2, '已绑定行不动');
});

test('R3d bindEntityLine：无 id 行是第 N 个未绑定行时按 occurrence 对齐', () => {
  const md = '- [ ] 阅读 (未分类) [!--id:a1--](!--id:a1--)\n- [ ] 阅读 [!--id:a2--](!--id:a2--)\n- [ ] 阅读\n- [ ] 阅读';
  const out = bindEntityLine(md, 'activity', '阅读', 'a3', 0);
  assert.ok(out.includes('阅读 <!--id:a3-->'), '第一个无 id 行绑 a3');
  const out2 = bindEntityLine(md, 'activity', '阅读', 'a4', 1);
  assert.ok(/- \[ \] 阅读 <!--id:a4-->/.test(out2), '第二个无 id 行绑 a4');
});

test('R3b bindEntityLine：有序列表任务行可补 id', () => {
  const md = '1. [ ] 阅读 @ 09:00 30分钟';
  const out = bindEntityLine(md, 'activity', '阅读', 'a9');
  assert.ok(out.includes('<!--id:a9-->'), '有序列表行补上 id');
});

test('R4 repairIdMarkers：裸残余 id 的空待办行 → 归还给上一内容行', () => {
  const md = '- [ ] 写\n- [ ] !--id:a1--';
  const out = repairIdMarkers(md);
  assert.ok(/- \[ \] 写 <!--id:a1-->/.test(out), 'id 归还给上一内容行');
  assert.equal(out.split('\n')[1].trim(), '- [ ]', '空行只剩裸 checkbox');
});

test('R4b 裸残余 id 的内容行被视为已绑定：修复不再追加第二个 id', () => {
  const md = '- [ ] 写 !--id:a1--\n- [ ] !--id:a1--';
  const out = repairIdMarkers(md);
  const first = out.split('\n')[0];
  assert.equal((first.match(/!--id:a1--/g) || []).length, 1, '内容行只有一个 id 标记');
});

test('R5 mirror 往返：orphan 活动的「## 未分类」区段不凭空创建 目标/计划', () => {
  const db = freshDB();
  eng.createActivity(db, { title: '独行的活动', note: '', plan_ids: [], planned_start: null, planned_minutes: 10 });
  const md1 = serializeDbToMd(db);
  applyCandidates(db, parseMdImport(md1, { now: NOW }));
  assert.equal(db.goals.length, 0, '不创建（未分类）目标');
  assert.equal(db.plans.length, 0, '不创建 未分类 计划');
  assert.equal(db.activities.length, 1, '活动保留且保持 orphan');
  assert.deepEqual(db.activities[0].plan_ids, []);
  const md2 = serializeDbToMd(db);
  assert.equal(md2, md1, '往返幂等');
});

// ===== R6 时间/时长解析不污染标题（「日/周/月视图时间丢 @、时长被追加进活动名」根因守卫）=====
// 触发场景：活动只有时长、无起始时间 → actToViewLine 序列化 `- [ ] 晨跑 30分钟`（无 @），
// 解析端若不剥裸时长，`30分钟` 残留进标题 → 写回 db → 下一轮 `晨跑 30分钟 30分钟` 逐轮追加。
test('R6a 裸时长（无 @）解析为时长，不残留进标题', () => {
  const r = parseMdImport('- [ ] 晨跑 30分钟', { now: NOW });
  assert.equal(r.activities[0].title, '晨跑', '标题不含时长');
  assert.equal(r.activities[0].planned_minutes, 30, '时长入账');
  assert.equal(r.activities[0].planned_start, null, '无起始时间');
  const r2 = parseMdImport('- [ ] 学习 1小时', { now: NOW });
  assert.equal(r2.activities[0].title, '学习', '小时单位不进标题');
  assert.equal(r2.activities[0].planned_minutes, 60, '小时换算为分钟');
  const r3 = parseMdImport('- [ ] 冲刺 45m', { now: NOW });
  assert.equal(r3.activities[0].title, '冲刺');
  assert.equal(r3.activities[0].planned_minutes, 45, 'h 单位换算');
});

test('R6b 带 @ 的行：时长在时间前/后都解析，标题干净且时间落地', () => {
  // clock 是解析内部字段（供日期组补全），透传面是 planned_start —— 用「明天」断言落地值
  const a = parseMdImport('- [ ] 晨跑 @ 明天 07:30 30分钟', { now: NOW }).activities[0];
  assert.equal(a.title, '晨跑');
  assert.equal(a.planned_start, '2026-8-31T07:30');
  assert.equal(a.planned_minutes, 30);
  const b = parseMdImport('- [ ] 晨跑 30分钟 @ 明天 07:30', { now: NOW }).activities[0];
  assert.equal(b.title, '晨跑', '时长写在 @ 之前也不进标题');
  assert.equal(b.planned_start, '2026-8-31T07:30');
  assert.equal(b.planned_minutes, 30);
});

test('R6c 日视图 round-trip：只有时长的活动不复制、不追加（幂等）', () => {
  const db = freshDB();
  eng.createActivity(db, { title: '晨跑', note: '', plan_ids: [], planned_start: null, planned_minutes: 30 });
  const step = () => applyCandidates(db, parseMdImport(organizeDay(db, '2026-9-19', NOW), { now: NOW, view: 'day' }));
  step();
  assert.equal(db.activities.length, 1, '不复制副本');
  assert.equal(db.activities[0].title, '晨跑', '标题干净（不含 30分钟）');
  assert.equal(db.activities[0].planned_minutes, 30, '时长保留');
  step(); // 第二轮（编辑器不回填 id 的最恶劣情形）
  assert.equal(db.activities.length, 1, '第二轮仍一份（多重集对账收敛）');
  assert.equal(db.activities[0].title, '晨跑');
});

test('R6d mirror round-trip：只有时长的活动（`@ 30分钟` 形态）不污染不误报', () => {
  const db = freshDB();
  eng.createActivity(db, { title: '晨跑', note: '', plan_ids: [], planned_start: null, planned_minutes: 30 });
  const md1 = serializeDbToMd(db); // `- [ ] 晨跑 @ 30分钟`
  const r = parseMdImport(md1, { now: NOW });
  assert.equal(r.activities[0].title, '晨跑');
  assert.equal(r.activities[0].planned_minutes, 30);
  assert.deepEqual(r.warnings, [], '纯时长指令不算「时间指令无法解析」');
  applyCandidates(db, r);
  const md2 = serializeDbToMd(db);
  assert.equal(md2, md1, 'mirror 往返幂等');
});

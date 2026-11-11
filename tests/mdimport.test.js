// tests/mdimport.test.js
// 手打 Markdown 批量速录 → 实体候选解析规则（TDD）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMdImport, serializeDbToMd } from '../src/domain/mdimport.js';

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

test('mdimport: 大写 [X] 也识别为完成（lute 会把 [x] 规范化为 [X]）', () => {
  const r = parseMdImport('# 目标\n- [X] 已完成编辑的事\n- [ ] 未完成', { now: NOW });
  assert.equal(r.activities.length, 2, '两行都应是活动（[X] 不被误判为描述）');
  assert.equal(r.activities[0].status, 'Completed', '[X] = 已完成');
  assert.equal(r.activities[1].status, 'Planned');
  assert.equal(r.goals[0].desc, '', '[X] 行不应落入目标描述');
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

test('mdimport: 指令顺序宽容 —— (计划)/#标签 在 @ 前后均可剥离、不混入活动名', () => {
  // 指令在 @ 之后（行尾）
  let r = parseMdImport('# 目标\n## 默认计划\n- [ ] 写 @ 明天 9:00 (写作) #重点', { now: NOW });
  let a = r.activities[0];
  assert.equal(a.title, '写');
  assert.equal(a.note, '#重点');
  assert.ok(r.plans.some((p) => p.title === '写作'), '@ 后 (计划) 仍提取');
  assert.equal(a.planned_start, '2026-8-31T09:00');
  // 指令在 @ 之前
  r = parseMdImport('# 目标\n## 默认计划\n- [ ] 读 (阅读) #轻 @ 今天 10:00', { now: NOW });
  a = r.activities[0];
  assert.equal(a.title, '读', '指令在 @ 前也不混入活动名');
  assert.equal(a.note, '#轻');
  assert.ok(r.plans.some((p) => p.title === '阅读'), '@ 前 (计划) 仍提取');
  assert.equal(a.planned_start, '2026-8-30T10:00');
});

test('mdimport: 视图标题不污染 —— 日视图中 #今日/##日期 不解析成目标/计划', () => {
  const viewMd = `---
view: day
updated: 2026-8-30
---

# 今日 · 2026-8-30 周日

## 2026-8-30 周日
- [ ] 写大纲 @ 09:00 30分钟
（未排程）
- [ ] 整理笔记 @ 今天 10:00
`;
  const r = parseMdImport(viewMd, { now: NOW });
  assert.equal(r.view, 'day', '识别视图标记');
  assert.equal(r.goals.length, 0, '视图顶部 # 标题不建目标');
  const datePlans = r.plans.filter((p) => p.dateBase);
  assert.equal(datePlans.length, 1, '日期 ## 作为分组基线（仅 1 个日期组）');
  assert.ok(!r.plans.some((p) => !p.dateBase && p.title.includes('今日')), '不产生「今日」计划');
  assert.equal(r.activities.length, 2, '活动正常解析');
  const a = r.activities[0];
  assert.equal(a.title, '写大纲');
  assert.equal(a.planned_start, '2026-8-30T09:00', '日期组下活动补默认日期');
  // 显式传 view 覆盖（防 frontmatter 被编辑器剥离）
  const r2 = parseMdImport(mdimportsClean(viewMd), { now: NOW, view: 'day' });
  assert.equal(r2.view, 'day', '显式 view 生效');
  assert.equal(r2.goals.length, 0);
});

test('mdimport: 备注语法 —— ；全角分号后为自由备注，与 #标签 并存，round-trip 保留', () => {
  const r = parseMdImport('# 目标\n## 计划A\n- [ ] 写 @ 明天 9:00 30分钟；记得带上论文模板 #重点', { now: NOW });
  const a = r.activities[0];
  assert.equal(a.title, '写');
  assert.equal(a.note, '#重点 记得带上论文模板', '；备注 与 #标签 合并进 note');
  assert.equal(a.planned_start, '2026-8-31T09:00');
  assert.equal(a.planned_minutes, 30);
  // 纯备注（无标签）
  const r2 = parseMdImport('# 目标\n## 计划A\n- [ ] 读 @ 9:00；静下心来', { now: NOW });
  assert.equal(r2.activities[0].note, '静下心来');
  // round-trip：serializeDbToMd 输出 ；备注 → parse 回来保留
  const db0 = {
    schemaVersion: 3, resources: [], rules: [],
    goals: [{ id: 'g1', title: '目标', desc: '', status: 'Active', created: 0 }],
    plans: [{ id: 'p1', goal_id: 'g1', title: '计划A', status: 'Active', created: 0 }],
    activities: [{ id: 'a1', title: '写', note: '记得带上论文模板', plan_ids: ['p1'], planned_start: '2026-8-31T09:00', planned_minutes: 30, status: 'Planned', created: 0 }],
    txs: [], outputs: [], valueflows: [], goods: [], seq: {},
  };
  const md = serializeDbToMd(db0);
  assert.ok(md.includes('；记得带上论文模板'), '序列化输出 ；备注');
  const back = parseMdImport(md, { now: NOW });
  assert.equal(back.activities[0].note, '记得带上论文模板', 'round-trip 备注保留');
});

test('mdimport: 日期组下直添活动默认排到当期 —— 无时间也排到该日(09:00)，有钟点用钟点', () => {
  const base = `---
view: day
---

# 今日 · 2026-8-30 周日

## 2026-8-30 周日
`;
  const r = parseMdImport(base + '- [ ] 随手记', { now: NOW, view: 'day' });
  assert.equal(r.activities[0].planned_start, '2026-8-30T09:00', '日期组下无时间 → 排到该日 09:00');
  const r2 = parseMdImport(base + '- [ ] 随手记 @ 15:30', { now: NOW, view: 'day' });
  assert.equal(r2.activities[0].planned_start, '2026-8-30T15:30', '日期组下有钟点 → 用钟点');
  // 未排程块（## 未排程）下直添 → 仍保持未排程（curDateBase 被清空）
  const r3 = parseMdImport(base + '- [ ] 已排 @ 10:00\n\n## 未排程\n- [ ] 未排的事', { now: NOW, view: 'day' });
  const un = r3.activities.find((a) => a.title === '未排的事');
  assert.equal(un.planned_start, null, '未排程块下直添无时间 → 保持未排程');
  assert.equal(r3.activities.find((a) => a.title === '已排').planned_start, '2026-8-30T10:00');
});

// 去掉 frontmatter（模拟编辑器剥离后仍显式传 view）
function mdimportsClean(md) {
  return md.replace(/^---\n[\s\S]*?\n---\n/, '');
}

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

// ---- 双向：实体 → md → 实体（round-trip，id 对齐）----

function rtDB() {
  return {
    goals: [{ id: 'g1', title: '写一本书', desc: '方法论成书。', status: 'Active' }],
    plans: [
      { id: 'p1', goal_id: 'g1', title: '第一章', status: 'Active' },
      { id: 'p2', goal_id: 'g1', title: '第二章', status: 'Active' },
    ],
    activities: [
      { id: 'a1', title: '写大纲', plan_ids: ['p1'], planned_start: '2026-8-31T09:00', planned_minutes: 60, status: 'Planned' },
      { id: 'a2', title: '写初稿', plan_ids: ['p1'], planned_start: '2026-9-1T14:30', planned_minutes: 90, status: 'Completed' },
      { id: 'a3', title: '校对', plan_ids: ['p2'], planned_start: '2026-9-2T18:00', planned_minutes: 45, status: 'Planned' },
    ],
  };
}

test('mdimport 双向: db → md → 候选，字段保真（隐藏式 id 绑定 + mirror 完整镜像）', () => {
  const db = rtDB();
  const md = serializeDbToMd(db);
  // 完整镜像：frontmatter 声明 mirror（缺失即删语义）
  assert.ok(md.startsWith('---\nmirror: true'), '应带 mirror: true 完整镜像标记');
  // 可读性：目标/计划/活动 + 时间/时长/完成态/归属/隐藏式 id 绑定都在
  assert.ok(md.includes('# 写一本书 <!--id:g1-->'));
  assert.ok(md.includes('## 第一章 <!--id:p1-->'));
  assert.ok(md.includes('- [ ] 写大纲 @ 2026-8-31 09:00 60分钟 (第一章) <!--id:a1-->'));
  assert.ok(md.includes('- [x] 写初稿 @ 2026-9-1 14:30 90分钟 (第一章) <!--id:a2-->'));

  const r = parseMdImport(md, { now: NOW });
  assert.equal(r.mirror, true, '解析应识别 mirror');
  assert.equal(r.goals[0].title, '写一本书');
  assert.equal(r.goals[0].desc, '方法论成书。');
  assert.equal(r.goals[0].status, 'Active');
  assert.equal(r.goals[0].id, 'g1', '目标携带隐藏式 id');
  assert.equal(r.plans.length, 2);
  assert.equal(r.plans[0].id, 'p1');
  // 活动：字段保真 + id 绑定
  const a1 = r.activities.find((a) => a.title === '写大纲');
  assert.ok(a1, '按名称定位候选');
  assert.equal(a1.id, 'a1', '活动携带隐藏式 id（改名仍绑定）');
  assert.equal(a1.planned_start, '2026-8-31T09:00');
  assert.equal(a1.planned_minutes, 60);
  assert.equal(a1.status, 'Planned');
  const a2 = r.activities.find((a) => a.title === '写初稿');
  assert.equal(a2.id, 'a2');
  assert.equal(a2.status, 'Completed');
  assert.equal(a2.planned_start, '2026-9-1T14:30');
  assert.equal(a2.planned_minutes, 90);
  const a3 = r.activities.find((a) => a.title === '校对');
  assert.equal(a3.planned_start, '2026-9-2T18:00');
  // 计划归属：a1 应归「第一章」
  const p1 = r.plans.find((p) => p.title === '第一章');
  assert.equal(a1.plan_key, p1.key);
  assert.deepEqual(r.warnings, []);
});

test('mdimport 双向: lute 链接式 id 标记也能解析（Vditor 渲染后 getValue 的形式）', () => {
  const md = '# 目标A [!--id:g1--](!--id:g1--)\n\n## 计划A [!--id:p1--](!--id:p1--)\n\n- [ ] 任务 [!--id:a1--](!--id:a1--)\n';
  const r = parseMdImport(md, { now: NOW });
  assert.equal(r.goals[0].id, 'g1');
  assert.equal(r.plans[0].id, 'p1');
  assert.equal(r.activities[0].id, 'a1');
  assert.equal(r.activities[0].title, '任务', '链接式标记应被剥离');
});

test('mdimport 双向: 状态标注往返 —— 归档/完成/暂停/进行中/失败 同构', () => {
  const db = {
    goals: [
      { id: 'g1', title: '在跑目标', status: 'Active', desc: '' },
      { id: 'g2', title: '旧目标', status: 'Archived', desc: '' },
      { id: 'g3', title: '已结目标', status: 'Completed', desc: '' },
    ],
    plans: [
      { id: 'p1', goal_id: 'g1', title: '孵化计划', status: 'Incubating' },
      { id: 'p2', goal_id: 'g1', title: '暂停计划', status: 'Paused' },
      { id: 'p3', goal_id: 'g1', title: '归档计划', status: 'Archived' },
    ],
    activities: [
      { id: 'a1', title: '进行中的事', plan_ids: ['p1'], status: 'Started', planned_start: '2026-8-31T09:00' },
      { id: 'a2', title: '失败的事', plan_ids: ['p1'], status: 'Failed', planned_start: '2026-8-31T09:00' },
      { id: 'a3', title: '归档的事', plan_ids: ['p1'], status: 'Archived', planned_start: '2026-8-31T09:00' },
    ],
  };
  const md = serializeDbToMd(db);
  assert.ok(md.includes('# 旧目标 (归档)'));
  assert.ok(md.includes('# 已结目标 (完成)'));
  assert.ok(md.includes('## 孵化计划 (孵化)'));
  assert.ok(md.includes('## 暂停计划 (暂停)'));
  assert.ok(md.includes('## 归档计划 (归档)'));
  assert.ok(md.includes('- [ ] 进行中的事 @ 2026-8-31 09:00 (孵化计划) (进行中)'));
  assert.ok(md.includes('- [ ] 失败的事 @ 2026-8-31 09:00 (孵化计划) (失败)'));
  assert.ok(md.includes('- [ ] 归档的事 @ 2026-8-31 09:00 (孵化计划) (归档)'));

  const r = parseMdImport(md, { now: NOW });
  const byTitle = (arr, t) => arr.find((x) => x.title === t);
  assert.equal(byTitle(r.goals, '旧目标').status, 'Archived');
  assert.equal(byTitle(r.goals, '已结目标').status, 'Completed');
  assert.equal(byTitle(r.plans, '孵化计划').status, 'Incubating');
  assert.equal(byTitle(r.plans, '暂停计划').status, 'Paused');
  assert.equal(byTitle(r.plans, '归档计划').status, 'Archived');
  assert.equal(byTitle(r.activities, '进行中的事').status, 'Started');
  assert.equal(byTitle(r.activities, '失败的事').status, 'Failed');
  assert.equal(byTitle(r.activities, '归档的事').status, 'Archived');
});

test('mdimport 双向: 手打无 id 标记 → 候选 id 为 null（应用时名称匹配或 hash 新建）', () => {
  const r = parseMdImport('# 目标\n- [ ] 新活动 @ 明天 9:00 30分钟', { now: NOW });
  assert.equal(r.activities.length, 1);
  assert.equal(r.activities[0].id, null, '无 id 标记 → 无绑定，走名称匹配/hash');
  assert.equal(r.goals[0].id, null);
  assert.equal(r.mirror, false, '手打 md 无 mirror，保持增量语义');
});

test('mdimport 双向: 未挂计划的活动序列化到「未分类」（带隐藏式 id）', () => {
  const db = rtDB();
  db.activities.push({ id: 'a9', title: '散步', plan_ids: [], planned_start: '2026-9-3T19:00', planned_minutes: 30, status: 'Planned' });
  const md = serializeDbToMd(db);
  assert.ok(md.includes('## 未分类'));
  assert.ok(md.includes('- [ ] 散步 @ 2026-9-3 19:00 30分钟 <!--id:a9-->'));
});

test('回归：无起始时间仅持续时间的活动，时长不残留进标题（round-trip 不再累积）', () => {
  const md = '- [ ] 晨跑 30分钟';
  const r = parseMdImport(md, { now: NOW });
  assert.equal(r.activities.length, 1);
  assert.equal(r.activities[0].title, '晨跑');
  assert.equal(r.activities[0].planned_minutes, 30);
  assert.equal(r.activities[0].planned_start, null);
});

test('回归：行尾裸分钟 30分 也能剥离', () => {
  const md = '- [ ] 写代码 90分';
  const r = parseMdImport(md, { now: NOW });
  assert.equal(r.activities[0].title, '写代码');
  assert.equal(r.activities[0].planned_minutes, 90);
});

// tests/ics.test.js
// ICS 解析（parseICS 纯函数）+ 期次完成（completeOccurrence 引擎）——日历互通与分期操作
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseICS, importActivities, buildICS } from '../src/services/ics.js';
import * as eng from '../src/domain/engine.js';

function freshDB() {
  return {
    schemaVersion: 3, resources: [], rules: [],
    goals: [], plans: [], activities: [],
    txs: [], outputs: [], valueflows: [], goods: [],
    seq: { r: 0, ru: 0, g: 0, p: 0, a: 0, t: 0, o: 0, v: 0, gd: 0 },
  };
}

const VEVENT_SINGLE = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:1@x
SUMMARY:写大纲
DTSTART:20260908T090000
DTEND:20260908T100000
END:VEVENT
END:VCALENDAR`;

test('ics: parseICS 单次事件 → planned_start / minutes 正确', () => {
  const { candidates, warnings } = parseICS(VEVENT_SINGLE);
  assert.equal(candidates.length, 1);
  assert.equal(warnings.length, 0);
  const c = candidates[0];
  assert.equal(c.title, '写大纲');
  assert.equal(c.planned_date, '2026-9-8');
  assert.equal(c.planned_start, '2026-9-8T09:00');
  assert.equal(c.planned_minutes, 60);
  assert.equal(c.repeat, null);
});

test('ics: parseICS 全天事件（无时间）→ planned_start null', () => {
  const md = VEVENT_SINGLE.replace('DTSTART:20260908T090000', 'DTSTART;VALUE=DATE:20260908')
    .replace('DTEND:20260908T100000', 'DTEND;VALUE=DATE:20260909');
  const { candidates } = parseICS(md);
  assert.equal(candidates[0].planned_date, '2026-9-8');
  assert.equal(candidates[0].planned_start, null);
});

test('ics: parseICS RRULE WEEKLY+UNTIL → 展开循环活动', () => {
  const md = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:2@x
SUMMARY:每周例会
DTSTART:20260907T090000
RRULE:FREQ=WEEKLY;UNTIL=20260927T000000Z
END:VEVENT
END:VCALENDAR`;
  const { candidates } = parseICS(md);
  assert.equal(candidates.length, 1);
  const c = candidates[0];
  assert.equal(c.repeat, 'weekly');
  assert.equal(c.repeat_until, '2026-9-27');
  // 2026-9-7 起每周，直到 9-27：9/7, 9/14, 9/21（9/28 > 9/27 停）
  assert.deepEqual(c.dates, ['2026-9-7', '2026-9-14', '2026-9-21']);
});

test('ics: parseICS RRULE COUNT → 精确期数', () => {
  const md = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:3@x
SUMMARY:每日站会
DTSTART:20260908T093000
RRULE:FREQ=DAILY;COUNT=3
END:VEVENT
END:VCALENDAR`;
  const { candidates } = parseICS(md);
  const c = candidates[0];
  assert.equal(c.repeat, 'daily');
  assert.deepEqual(c.dates, ['2026-9-8', '2026-9-9', '2026-9-10']);
});

test('ics: parseICS 不支持规则（FREQ=YEARLY）→ 降级首期 + warning', () => {
  const md = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:4@x
SUMMARY:年度体检
DTSTART:20260909T090000
RRULE:FREQ=YEARLY;INTERVAL=1
END:VEVENT
END:VCALENDAR`;
  const { candidates, warnings } = parseICS(md);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].repeat, null);
  assert.deepEqual(candidates[0].dates, ['2026-9-9']);
  assert.ok(warnings.some((w) => w.includes('YEARLY')), '应提示不支持规则');
});

test('ics: importActivities 落库 → 循环活动 occurrences 精确覆盖', () => {
  const db = freshDB();
  const { candidates } = parseICS(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:5@x
SUMMARY:跑步
DTSTART:20260908T070000
RRULE:FREQ=WEEKLY;COUNT=2
END:VEVENT
END:VCALENDAR`);
  const created = importActivities(db, candidates);
  assert.equal(created.created, 1);
  assert.equal(db.activities.length, 1);
  const a = db.activities[0];
  assert.equal(a.title, '跑步');
  assert.equal(a.repeat, 'weekly');
  assert.equal(a.planned_date, '2026-9-8');
  assert.equal(a.occurrences.length, 2, 'COUNT=2 → 精确两期');
  assert.equal(a.occurrences[1].date, '2026-9-15');
});

// ---- 期次完成（分期活动只有跳过、缺完成 —— 补齐对偶操作） ----
function mkRecurringDB() {
  const db = freshDB();
  eng.createActivity(db, {
    title: '晨跑', note: '', plan_ids: [],
    planned_date: '2026-9-8', planned_minutes: 30, repeat: 'daily',
  });
  return db;
}

test('engine: completeOccurrence 完成未来期次 → 该期 done，当前期不动', () => {
  const db = mkRecurringDB();
  const a = db.activities[0];
  assert.equal(a.occurrences.length, 30);
  const target = a.occurrences[5].date; // 未来期次
  const r = eng.completeOccurrence(db, a.id, target);
  assert.ok(r.ok, r.error);
  const occ = a.occurrences.find((o) => o.date === target);
  assert.equal(occ.status, 'done');
  assert.equal(a.planned_date, a.occurrences[0].date, '当前期不推进');
});

test('engine: completeOccurrence 完成当前 pending 期 → 推进到下一 pending', () => {
  const db = mkRecurringDB();
  const a = db.activities[0];
  const cur = a.planned_date;
  const r = eng.completeOccurrence(db, a.id, cur);
  assert.ok(r.ok);
  assert.equal(a.occurrences.find((o) => o.date === cur).status, 'done');
  assert.equal(a.planned_date, a.occurrences[1].date, '推进到下一期');
  assert.equal(a.status, 'Planned');
});

test('engine: completeOccurrence 完成已跳过期 → 拒绝', () => {
  const db = mkRecurringDB();
  const a = db.activities[0];
  const target = a.occurrences[2].date;
  eng.skipOccurrence(db, a.id, target);
  const r = eng.completeOccurrence(db, a.id, target);
  assert.ok(!r.ok);
  assert.ok(r.error.includes('跳过'), '应提示不可完成已跳过期次');
});

// ---- ICS 导出：循环活动 → RRULE 对齐（而非展开事件） ----
function recurringAct(title, repeat, until, marked = {}) {
  const db = freshDB();
  eng.createActivity(db, {
    title, note: '', plan_ids: [],
    planned_date: '2026-9-7', planned_start: '2026-9-7T09:00',
    planned_minutes: 30, repeat, repeat_until: until || null,
  });
  const a = db.activities[0];
  for (const [idx, st] of Object.entries(marked)) {
    const i = Number(idx);
    if (a.occurrences[i]) a.occurrences[i].status = st;
  }
  return db;
}

test('ics: buildICS 循环活动 → 单条 RRULE 而非展开', () => {
  const db = recurringAct('晨跑', 'daily', '2026-9-10');
  const { text, count } = buildICS(db);
  assert.equal(count, 1, '循环导出为单条重复事件');
  assert.ok(text.includes('RRULE:FREQ=DAILY;UNTIL=20260910T235959'), 'RRULE 含 FREQ+UNTIL');
  assert.ok(text.includes('SUMMARY:晨跑'));
  // 不应再展开为多个独立 VEVENT
  assert.equal((text.match(/BEGIN:VEVENT/g) || []).length, 1, '只有一条 VEVENT');
});

test('ics: buildICS 循环活动 → weekday 用 BYDAY，跳过/完成期次进 EXDATE', () => {
  const db = recurringAct('背单词', 'weekday', null, { 2: 'skipped', 3: 'done' });
  const { text } = buildICS(db);
  assert.ok(text.includes('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'), 'weekday → BYDAY');
  assert.ok(text.includes('EXDATE:') && /EXDATE:\d{8}/.test(text), 'EXDATE 含补零日期值，排除非待办期次');
});

test('ics: 导入去重对齐 —— 同类循环重复导入不重复创建，合并期次', () => {
  const db = freshDB();
  const icsWk = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:8@x
SUMMARY:例会
DTSTART:20260907T090000
RRULE:FREQ=WEEKLY;COUNT=2
END:VEVENT
END:VCALENDAR`;
  const r1 = importActivities(db, parseICS(icsWk).candidates);
  const r2 = importActivities(db, parseICS(icsWk).candidates);
  assert.equal(r1.created, 1);
  assert.equal(r2.created, 0, '重复导入不再新建');
  assert.equal(r2.deduped, 1, '命中去重对齐');
  assert.equal(db.activities.length, 1, '仍只有一条循环活动');
  assert.equal(db.activities[0].occurrences.length, 2, '期次稳定两期');
});

test('ics: 导入去重对齐 —— 保留已有 done/skipped，仅补新增期次', () => {
  const db = freshDB();
  importActivities(db, parseICS(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:9@x
SUMMARY:跑步
DTSTART:20260907T070000
RRULE:FREQ=WEEKLY;COUNT=3
END:VEVENT
END:VCALENDAR`).candidates);
  eng.skipOccurrence(db, db.activities[0].id, '2026-9-14');
  const a0 = db.activities[0].occurrences.find((o) => o.date === '2026-9-14').status;
  assert.equal(a0, 'skipped', '先跳过 9/14');
  // 再导一次 COUNT=4（新增 9/28 期）
  const { created, deduped } = importActivities(db, parseICS(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:9@x
SUMMARY:跑步
DTSTART:20260907T070000
RRULE:FREQ=WEEKLY;COUNT=4
END:VEVENT
END:VCALENDAR`).candidates);
  assert.equal(created, 0);
  assert.equal(deduped, 1, '对齐到已有循环，不新建');
  const a = db.activities[0];
  assert.equal(a.occurrences.length, 4, '期次扩到 4');
  assert.equal(a.occurrences.find((o) => o.date === '2026-9-14').status, 'skipped', '已有的跳过状态保留');
});

// ---- 循环活动当期完成 → 账本按 occurrence_date 逐期可追溯 ----
function recDBWithResource(repeat = 'daily') {
  const db = freshDB();
  eng.createResource(db, { name: '价值元', unit: '元', initial: 100, color: null });
  eng.createActivity(db, {
    title: '晨跑', note: '', plan_ids: [],
    planned_date: '2026-9-8', planned_start: '2026-9-8T07:00', planned_minutes: 30, repeat,
  });
  return db;
}
// 完成循环活动的「当前期」：入账流水 + 产出 + 推进
function completeCurOcc(db, title, outTitle, expense) {
  const a = db.activities[0];
  eng.startActivity(db, a.id);
  const r = eng.completeActivity(db, a.id, {
    expenses: [{ resource_id: db.resources[0].id, amount: 5, note: '跑步消耗' }],
    incomes: [],
    output_title: outTitle,
    output_tags: ['默认'],
  });
  assert.ok(r.ok, JSON.stringify(r.error));
  return a;
}

test('engine: 循环活动当期完成 → 流水/产出带该期 occurrence_date', () => {
  const db = recDBWithResource('daily');
  const a0 = completeCurOcc(db, '晨跑', '晨跑产出');
  assert.equal(a0.occurrences.find((o) => o.status === 'done').date, '2026-9-8', '首期 9/8 标记 done');
  const tx = db.txs.filter((t) => t.source_id === a0.id);
  assert.ok(tx.length >= 1);
  assert.equal(tx[0].occurrence_date, '2026-9-8', '流水带首期日期');
  const out = db.outputs.find((o) => o.activity_id === a0.id);
  assert.equal(out.occurrence_date, '2026-9-8', '产出带首期日期');
  assert.equal(a0.planned_date, '2026-9-9', '推进到下一期');
});

test('engine: 逐期完成 → 各期账本可独立追溯、互不串期', () => {
  const db = recDBWithResource('daily');
  const a = db.activities[0];
  // 完成两期（自动推进）
  completeCurOcc(db, '晨跑', '产出1');
  completeCurOcc(db, '晨跑', '产出2');
  const txs = db.txs.filter((t) => t.source_id === a.id);
  const dates = txs.map((t) => t.occurrence_date);
  assert.equal(new Set(dates).size, 2, '两期各有一笔记账，日期不同');
  assert.ok(dates.includes('2026-9-8') && dates.includes('2026-9-9'), '逐期溯源到各自日期');
  // 产出也逐期
  const outs = db.outputs.filter((o) => o.activity_id === a.id).map((o) => o.occurrence_date);
  assert.deepEqual(new Set(outs), new Set(['2026-9-8', '2026-9-9']));
});

test('engine: 非循环活动完成 → occurrence_date 为 null（向后兼容）', () => {
  const db = freshDB();
  eng.createResource(db, { name: '价值元', unit: '元', initial: 100, color: null });
  eng.createActivity(db, { title: '临时任务', note: '', plan_ids: [], planned_date: '2026-9-8', planned_minutes: 30 });
  const a = db.activities[0];
  eng.startActivity(db, a.id);
  eng.completeActivity(db, a.id, {
    expenses: [{ resource_id: db.resources[0].id, amount: 3, note: '' }], incomes: [],
    output_title: '产出', output_tags: [],
  });
  const tx = db.txs[0];
  assert.equal(tx.occurrence_date, null, '非循环活动不带期次标记');
});

// ---- 按期次完成入账（对齐非循环：预设/手动台账落该期） ----
function ledgerDB(repeat = 'daily') {
  const db = freshDB();
  eng.createResource(db, { name: '价值元', unit: '元', initial: 100, color: null });
  eng.createActivity(db, {
    title: '晨跑', note: '', plan_ids: [],
    planned_date: '2026-9-8', planned_start: '2026-9-8T07:00', planned_minutes: 30, repeat,
  });
  return db;
}

test('engine: completeSeriesOccurrence 完成未来期 → 该期记账+done，不推进 series', () => {
  const db = ledgerDB('daily');
  const a = db.activities[0];
  const future = a.occurrences[5].date;
  const r = eng.completeSeriesOccurrence(db, a.id, future, {
    expenses: [{ resource_id: db.resources[0].id, amount: 5, note: '补给' }],
    incomes: [], output_title: '该期产出', output_tags: ['默认'],
  });
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.advanced, false, '未来期完成不推进当前期');
  assert.equal(a.occurrences.find((o) => o.date === future).status, 'done');
  assert.equal(a.planned_date, a.occurrences[0].date, 'series 当前期不动');
  const tx = db.txs.find((t) => t.source_id === a.id && t.occurrence_date === future);
  assert.ok(tx && tx.credit === 5, '该期流水挂对应 occurrence_date');
  const out = db.outputs.find((o) => o.activity_id === a.id && o.occurrence_date === future);
  assert.equal(out.title, '该期产出', '该期产出挂对应期');
});

test('engine: completeSeriesOccurrence 完成当前期 → 记账并推进下一期', () => {
  const db = ledgerDB('daily');
  const a = db.activities[0];
  const cur = a.planned_date;
  const r = eng.completeSeriesOccurrence(db, a.id, cur, {
    expenses: [{ resource_id: db.resources[0].id, amount: 5, note: '' }],
    incomes: [], output_title: '产出', output_tags: [],
  });
  assert.ok(r.ok);
  assert.equal(r.advanced, true, '当前期完成推进');
  assert.equal(a.planned_date, a.occurrences[1].date, '推进到下一期');
  assert.equal(a.occurrences.find((o) => o.date === cur).status, 'done');
});

test('engine: completeSeriesOccurrence 空台账 → 拒绝（不变量2）', () => {
  const db = ledgerDB('daily');
  const a = db.activities[0];
  const r = eng.completeSeriesOccurrence(db, a.id, a.occurrences[3].date, {
    expenses: [], incomes: [], output_title: 'x', output_tags: [],
  });
  assert.ok(!r.ok);
  assert.ok(r.error.includes('收支流水'), '必须至少一笔流水');
});

test('engine: completeSeriesOccurrence 完成已跳过期 → 拒绝', () => {
  const db = ledgerDB('daily');
  const a = db.activities[0];
  const t = a.occurrences[2].date;
  eng.skipOccurrence(db, a.id, t);
  const r = eng.completeSeriesOccurrence(db, a.id, t, {
    expenses: [{ resource_id: db.resources[0].id, amount: 1, note: '' }],
    incomes: [], output_title: 'y', output_tags: [],
  });
  assert.ok(!r.ok);
  assert.ok(r.error.includes('跳过'), '已跳过不可完成');
});

// ============================================================
// tests/ics.test.js
// iCalendar 导出（仅导出）：buildICS 纯函数——结构、转义、全天、循环展开、状态映射
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedDB } from '../src/store/db.js';
import * as E from '../src/domain/engine.js';
import { buildICS } from '../src/services/ics.js';

function freshDB() {
  const db = seedDB();
  db.resources = [{ id: 'r1', name: 'Token', unit: 'Token', initial: 100, status: 'Active', created: 0 }];
  db.rules = []; db.goals = []; db.plans = []; db.activities = []; db.txs = []; db.outputs = []; db.valueflows = []; db.goods = [];
  db.seq = { r: 1, ru: 0, g: 0, p: 0, a: 0, t: 0, o: 0, v: 0, gd: 0 };
  return db;
}

test('ICS：空库导出合法结构', () => {
  const db = freshDB();
  const { text, count } = buildICS(db);
  assert.equal(count, 0);
  assert.match(text, /^BEGIN:VCALENDAR\r\n/);
  assert.match(text, /VERSION:2\.0/);
  assert.match(text, /END:VCALENDAR\r?$/);
});

test('ICS：单次活动 → 一条 VEVENT，含时间窗与转义', () => {
  const db = freshDB();
  E.createActivity(db, { title: '写,分号;章\\节', note: '第一行\n第二行', planned_start: '2026-8-10T07:30', planned_minutes: 45 });
  const { text, count } = buildICS(db);
  assert.equal(count, 1);
  assert.match(text, /DTSTART:20260810T073000/);
  assert.match(text, /DTEND:20260810T081500/);
  assert.match(text, /SUMMARY:写\\,分号\\;章\\\\节/);
  assert.match(text, /DESCRIPTION:第一行\\n第二行/);
  assert.match(text, /STATUS:TENTATIVE/); // Planned 未开始
});

test('ICS：全天（无时间）→ 日期型 DTSTART 与次日 DTEND', () => {
  const db = freshDB();
  E.createActivity(db, { title: '全天事务', planned_date: '2026-8-10' });
  const { text } = buildICS(db);
  assert.match(text, /DTSTART:20260810\r\nDTEND:20260811/);
});

test('ICS：循环系列展开全部期次，skipped → CANCELLED / pending → TENTATIVE', () => {
  const db = freshDB();
  E.createActivity(db, { title: '每日', planned_start: '2026-8-10T07:30', planned_minutes: 30, repeat: 'daily', repeat_until: '2026-8-12' });
  const a = db.activities[0];
  E.skipOccurrence(db, a.id, '2026-8-11'); // 跳过中间期
  const { text, count } = buildICS(db);
  assert.equal(count, 3); // 三期为三次 VEVENT
  assert.equal((text.match(/BEGIN:VEVENT/g) || []).length, 3);
  const lines = text.split('\r\n');
  const blockOf = (date) => {
    const i = lines.findIndex((l) => l.includes('perp-') && l.includes(date));
    return lines.slice(i, i + 9);
  };
  assert.ok(blockOf('20260811').some((l) => l === 'STATUS:CANCELLED')); // 跳过
  assert.ok(blockOf('20260810').some((l) => l === 'STATUS:TENTATIVE')); // 未处理
});

test('ICS：完成当期 → CONFIRMED；含计划类别 CATEGORIES', () => {
  const db = freshDB();
  E.createGoal(db, { title: '健康' });
  E.createPlan(db, { goal_id: db.goals[0].id, title: '晨练计划', budget: null });
  const planId = db.plans[0].id;
  E.createActivity(db, { title: '晨跑', planned_start: '2026-8-10T06:30', planned_minutes: 30, plan_ids: [planId] });
  const a = db.activities[0];
  E.startActivity(db, a.id);
  E.completeActivity(db, a.id, { expense: { resource_id: 'r1', amount: 1 }, output_title: 'o' });
  const { text } = buildICS(db);
  assert.match(text, /STATUS:CONFIRMED/);
  assert.match(text, /CATEGORIES:晨练计划/);
});

// tests/report.test.js
// 周报/月报：周期边界 + buildReport 数据正确性（TDD）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodRange, buildReport } from '../src/domain/report.js';

function ms(s) {
  const [d, t] = s.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mi] = t.split(':').map(Number);
  return new Date(y, m - 1, dd, hh, mi).getTime();
}
function freshDB() {
  return {
    resources: [
      { id: 'r1', name: '价值元', unit: '元', initial: 100, status: 'Active', created: 0 },
      { id: 'r2', name: '精力', unit: '点', initial: 50, status: 'Active', created: 0 },
    ],
    plans: [{ id: 'p1', goal_id: null, title: '写作', budget: 100, status: 'Active', created: 0 }],
    activities: [
      { id: 'a1', title: '写稿', plan_ids: ['p1'], status: 'Completed', actual_start: ms('2026-8-25T09:00'), actual_end: ms('2026-8-25T10:00'), created: ms('2026-8-24T08:00') },
      { id: 'a2', title: '开会', plan_ids: [], status: 'Started', actual_start: ms('2026-8-26T09:00'), actual_end: null, created: ms('2026-8-26T08:00') },
      { id: 'a3', title: '旧活动', plan_ids: [], status: 'Completed', actual_start: ms('2026-8-20T09:00'), actual_end: ms('2026-8-20T10:00'), created: ms('2026-8-19T08:00') },
    ],
    txs: [
      { id: 't1', resource_id: 'r1', debit: 0, credit: 10, source_type: 'activity', source_id: 'a1', note: '支出', reversal_of: null, created: ms('2026-8-25T10:01') },
      { id: 't2', resource_id: 'r1', debit: 5, credit: 0, source_type: 'activity', source_id: 'a1', note: '收入', reversal_of: null, created: ms('2026-8-25T10:02') },
      { id: 't3', resource_id: 'r1', debit: 0, credit: 5, source_type: 'activity', source_id: 'a3', note: '支出', reversal_of: null, created: ms('2026-8-20T10:01') },
    ],
    outputs: [], valueflows: [], goods: [], rules: [], goals: [], seq: {},
  };
}

// ---- 周期边界 ----
test('periodRange: 周报周一 00:00 起 7 天，offset 回退', () => {
  const now = ms('2026-8-29T12:00'); // 周六
  const w = periodRange('week', 0, new Date(now));
  assert.equal(new Date(w.start).getDay(), 1); // 周一
  assert.equal(new Date(w.start).getDate(), 24);
  assert.equal(w.end - w.start, 7 * 864e5);
  const p = periodRange('week', -1, new Date(now));
  assert.equal(new Date(p.start).getDate(), 17); // 上一周周一
});

test('periodRange: 月报 1 日起整月，offset 回退', () => {
  const now = ms('2026-8-29T12:00');
  const m = periodRange('month', 0, new Date(now));
  assert.equal(new Date(m.start).getDate(), 1);
  assert.equal(new Date(m.start).getMonth(), 7); // 8月
  assert.equal(new Date(m.end).getDate(), 1); // 9月1日 00:00
  const p = periodRange('month', -1, new Date(now));
  assert.equal(new Date(p.start).getMonth(), 6); // 7月
});

// ---- 本周报告 ----
test('buildReport: 本周活动/收支/计划/余额/价值流', () => {
  const r = buildReport(freshDB(), { period: 'week', offset: 0, now: ms('2026-8-29T12:00') });
  // 活动：本周完成 a1，开始 a1+a2，新增 a1+a2
  assert.equal(r.activity.completed, 1);
  assert.equal(r.activity.started, 2);
  assert.equal(r.activity.created, 2);
  assert.deepEqual(r.activity.daily, { '2026-8-25': 1 });
  // 收支：本期仅 t1/t2（t3 在上一周）
  assert.equal(r.ledger.n, 2);
  assert.equal(r.ledger.incomeTotal, 5);
  assert.equal(r.ledger.expenseTotal, 10);
  const r1 = r.ledger.rows.find((x) => x.id === 'r1');
  assert.equal(r1.net, -5);
  // 计划：p1 本期投入 10（credit 支出，收入不计入）
  assert.equal(r.plan.length, 1);
  assert.equal(r.plan[0].spend, 10);
  // 余额：r1 期初 95（含上周 t3 支出）→ 期末 90，净 -5
  const b1 = r.balance.find((x) => x.id === 'r1');
  assert.equal(b1.before, 95);
  assert.equal(b1.after, 90);
  assert.equal(b1.net, -5);
  // 价值流：无
  assert.equal(r.vf.created, 0);
});

// ---- 本月报告（聚合上一周的活动与流水）----
test('buildReport: 本月聚合 8 月全部三条流水与活动', () => {
  const r = buildReport(freshDB(), { period: 'month', offset: 0, now: ms('2026-8-29T12:00') });
  assert.equal(r.activity.completed, 2); // a1 + a3
  assert.equal(r.activity.started, 3);
  assert.equal(r.activity.created, 3);
  assert.equal(r.ledger.n, 3);
  assert.equal(r.ledger.expenseTotal, 15);
  const b1 = r.balance.find((x) => x.id === 'r1');
  assert.equal(b1.before, 100);
  assert.equal(b1.after, 90);
  assert.equal(b1.net, -10);
});

// ---- 空周期（上月）----
test('buildReport: 上月无数据则各模块为空', () => {
  const r = buildReport(freshDB(), { period: 'month', offset: -1, now: ms('2026-8-29T12:00') });
  assert.equal(r.activity.completed, 0);
  assert.equal(r.activity.started, 0);
  assert.equal(r.ledger.n, 0);
  assert.deepEqual(r.ledger.rows, []);
  assert.deepEqual(r.plan, []);
});

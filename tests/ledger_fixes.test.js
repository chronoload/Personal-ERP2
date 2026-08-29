// ============================================================
// tests/ledger_fixes.test.js
// 台账修复回归：F1 有限金额守门 / F2 累计冲正上限 / F3 预算浮点容差 / F4 consumeGood 原子预检
// 运行：npm test  (node --test)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedDB } from '../src/store/db.js';
import * as E from '../src/domain/engine.js';

function freshDB() {
  const db = seedDB();
  db.resources = [{ id: 'r1', name: 'Token', unit: 'Token', initial: 100, status: 'Active', created: 0 }];
  db.rules = []; db.goals = []; db.plans = []; db.activities = []; db.txs = []; db.outputs = []; db.valueflows = []; db.goods = [];
  db.seq = { r: 1, ru: 0, g: 0, p: 0, a: 0, t: 0, o: 0, v: 0, gd: 0 };
  return db;
}

function mkPlan(db, budget) {
  E.createGoal(db, { title: 'g', desc: '' });
  const gid = db.goals[db.goals.length - 1].id;
  E.createPlan(db, { goal_id: gid, title: 'p', budget });
  return db.plans[db.plans.length - 1].id;
}

function runExpense(db, pid, amount) {
  E.createActivity(db, { title: 'a' + db.activities.length, note: '', plan_ids: pid ? [pid] : [] });
  const a = db.activities[db.activities.length - 1];
  E.startActivity(db, a.id);
  const r = E.completeActivity(db, a.id, { expense: { resource_id: 'r1', amount }, output_title: 'o', output_tags: [] });
  assert.equal(r.ok, true);
}

// ---- F1：五个金额入口全部拒绝 Infinity ----
test('F1：adjustResource 拒绝 Infinity（\'1e999\'）且余额不被毒化', () => {
  const db = freshDB();
  const r = E.adjustResource(db, 'r1', { direction: 'debit', amount: '1e999' });
  assert.equal(r.ok, false);
  assert.match(r.error, /金额/);
  assert.equal(E.balanceOf(db, 'r1'), 100);
});

test('F1：completeActivity 拒绝 Infinity 支出/收入', () => {
  const db = freshDB();
  E.createActivity(db, { title: 'a', note: '', plan_ids: [] });
  const a = db.activities[0];
  E.startActivity(db, a.id);
  let r = E.completeActivity(db, a.id, { expense: { resource_id: 'r1', amount: '1e999' }, output_title: 'o', output_tags: [] });
  assert.equal(r.ok, false);
  assert.match(r.error, /金额无效/);
  assert.equal(db.txs.filter((t) => t.source_type === 'activity').length, 0);
  // 收入侧同拒（活动仍是 Started，可重新完成）
  assert.equal(a.status, 'Started');
  r = E.completeActivity(db, a.id, { income: { resource_id: 'r1', amount: Infinity }, output_title: 'o', output_tags: [] });
  assert.equal(r.ok, false);
  assert.equal(db.txs.length, 0);
});

test('F1：consumeGood 拒绝 Infinity 数量', () => {
  const db = freshDB();
  E.createGood(db, { name: '咖啡', emoji: '☕', costs: [{ resource_id: 'r1', amount: 3 }], note: '' });
  const gid = db.goods[0].id;
  const before = db.txs.length;
  const r = E.consumeGood(db, gid, { qty: '1e999' });
  assert.equal(r.ok, false);
  assert.equal(db.txs.length, before);
});

test('F1：reverseTx 拒绝 Infinity 冲正额', () => {
  const db = freshDB();
  E.adjustResource(db, 'r1', { direction: 'credit', amount: 40 });
  const T = db.txs[db.txs.length - 1];
  const r = E.reverseTx(db, T.id, { amount: '1e999', reason: '' });
  assert.equal(r.ok, false);
  assert.match(r.error, /金额无效/);
  assert.equal(db.txs.length, 1);
});

test('F1：convert 拒绝 Infinity 兑换量', () => {
  const db = freshDB();
  db.resources.push({ id: 'r2', name: '精力', unit: '点', initial: 50, status: 'Active', created: 0 });
  E.createRule(db, { label: '换算', from: 'r2', to: 'r1', rate: 2 });
  const r = E.convert(db, db.rules[0].id, '1e999');
  assert.equal(r.ok, false);
  assert.match(r.error, /金额无效/);
  assert.equal(db.txs.length, 0);
});

// ---- F2：累计冲正上限 ----
test('F2：同一原单累计冲正超原额被拒，余额完好', () => {
  const db = freshDB();
  E.adjustResource(db, 'r1', { direction: 'credit', amount: 100 });
  const T = db.txs[db.txs.length - 1];
  const r1 = E.reverseTx(db, T.id, { amount: 60, reason: '第一笔' });
  assert.equal(r1.ok, true);
  const r2 = E.reverseTx(db, T.id, { amount: 60, reason: '第二笔同一原单' });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /累计冲正已超出原流水金额/);
  // 60 + 40 的合法补冲仍应放行（Σ=100 封顶）
  const r3 = E.reverseTx(db, T.id, { amount: 41, reason: '超限' });
  assert.equal(r3.ok, false);
  const r4 = E.reverseTx(db, T.id, { amount: 40, reason: '补满' });
  assert.equal(r4.ok, true);
  assert.equal(E.balanceOf(db, 'r1'), 100);
});

// ---- F3：预算门浮点容差 ----
test('F3：恰好花满预算（0.1+0.7 vs 0.8）后禁止开始新活动', () => {
  const db = freshDB();
  const pid = mkPlan(db, 0.8);
  runExpense(db, pid, 0.1);
  runExpense(db, pid, 0.7);
  assert.ok(Math.abs(E.planCost(db, pid) - 0.8) < 1e-12); // 浮点和确实 < 0.8
  E.createActivity(db, { title: 'a3', note: '', plan_ids: [pid] });
  const a3 = db.activities[db.activities.length - 1];
  const sr = E.startActivity(db, a3.id);
  assert.equal(sr.ok, false);
  assert.equal(E.isPlanBlocked(db, pid), true);
});

// ---- F4：consumeGood 执行时原子预检 ----
function poisonGoods(db) {
  // 模拟导入旁路：绕过 normalizeCosts 直接注入坏成本商品
  db.goods.push({ id: 'xg1', name: '负价', emoji: '💸', costs: [{ resource_id: 'r1', amount: -5 }], status: 'Active', created: 0 });
  db.goods.push({ id: 'xg2', name: 'NaN价', emoji: '🤷', costs: [{ resource_id: 'r1', amount: 'abc' }], status: 'Active', created: 0 });
  db.goods.push({ id: 'xg3', name: '幽灵资源', emoji: '👻', costs: [{ resource_id: 'ghost', amount: 3 }], status: 'Active', created: 0 });
}
for (const [gid, tag] of [['xg1', '负数'], ['xg2', 'NaN'], ['xg3', '幽灵资源']]) {
  test(`F4：坏成本(${tag})消费被拒且零流水`, () => {
    const db = freshDB();
    poisonGoods(db);
    const before = db.txs.length;
    const r = E.consumeGood(db, gid, { qty: 1 });
    assert.equal(r.ok, false);
    assert.match(r.error, /商品成本无效/);
    assert.equal(db.txs.length, before);
    assert.equal(E.balanceOf(db, 'r1'), 100);
  });
}

// ---- 回归：合法多成本消费不受影响 ----
test('回归：多成本商品批量消费照常入账', () => {
  const db = freshDB();
  E.createGood(db, { name: '双耗', emoji: '🛍️', costs: [{ resource_id: 'r1', amount: 3 }, { resource_id: 'r1', amount: 4 }], note: '' });
  const g = db.goods[0];
  const before = db.txs.length;
  const r = E.consumeGood(db, g.id, { qty: 2 });
  assert.equal(r.ok, true);
  assert.equal(db.txs.length - before, 2);
  assert.equal(E.balanceOf(db, 'r1'), 100 - (3 + 4) * 2);
});

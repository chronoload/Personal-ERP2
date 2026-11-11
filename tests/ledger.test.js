// tests/ledger.test.js — 记账命令语言与文本账单镜像（纯函数）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultResourceId, parseCommandLine, parseLedgerCommand, applyOps, serializeLedger, parseLedger, applyLedger } from '../src/domain/ledger.js';

function mkDb() {
  return {
    resources: [
      { id: 'r1', name: '价值元', unit: '元', status: 'Active', initial: 100 },
      { id: 'r2', name: '灵感', unit: '点', status: 'Active', initial: 10 },
      { id: 'r3', name: '停用元', unit: '元', status: 'Inactive', initial: 0 },
    ],
    txs: [],
  };
}
const engine = {
  adjustResource(db, rid, { direction, amount, note }) {
    const t = { id: 't' + (db.txs.length + 1), resource_id: rid, debit: direction === 'debit' ? amount : 0, credit: direction === 'credit' ? amount : 0, source_type: 'manual', source_id: 'manual', note, reversal_of: null, created: Date.now() };
    db.txs.push(t); return { ok: true };
  },
  reverseTx(db, id, { amount, reason }) {
    const orig = db.txs.find((x) => x.id === id);
    if (!orig) return { ok: false, error: '不存在' };
    db.txs.push({ id: 't' + (db.txs.length + 1), resource_id: orig.resource_id, debit: orig.credit ? amount : 0, credit: orig.debit ? amount : 0, source_type: 'reversal', source_id: id, note: reason + '（冲正 ' + id + '）', reversal_of: id, created: Date.now() });
    return { ok: true };
  },
  balanceOf(db, rid) {
    const r = db.resources.find((x) => x.id === rid);
    let d = 0, c = 0;
    for (const t of db.txs) { if (t.resource_id !== rid) continue; d += t.debit; c += t.credit; }
    return r.initial + d - c;
  },
};

test('默认资源：价值元优先，否则首个启用', () => {
  assert.equal(defaultResourceId(mkDb()), 'r1');
  const noV = mkDb(); noV.resources[0].name = '金钱';
  assert.equal(defaultResourceId(noV), 'r1');
});

test('解析单行命令：支出/收入/指定资源', () => {
  const db = mkDb();
  assert.deepEqual(parseCommandLine(db, '-8 早餐'), { ok: true, resource_id: 'r1', direction: 'credit', amount: 8, note: '早餐' });
  assert.deepEqual(parseCommandLine(db, '+100 工资'), { ok: true, resource_id: 'r1', direction: 'debit', amount: 100, note: '工资' });
  const withRes = parseCommandLine(db, '-5.5 咖啡 @灵感');
  assert.equal(withRes.resource_id, 'r2');
  assert.equal(withRes.amount, 5.5);
  assert.equal(withRes.note, '咖啡');
});

test('解析批量命令：空行/注释跳过；无命令段行被忽略', () => {
  const db = mkDb();
  const r = parseLedgerCommand(db, '\n-8 早餐\n# 注释\n+100 工资\nbad line');
  assert.equal(r.ops.length, 2);
  assert.equal(r.errors.length, 0); // 'bad line' 无 [+-]数字 前缀，不构成命令段 → 忽略
});

test('执行命令：入账后余额变化', () => {
  const db = mkDb();
  const { ops } = parseLedgerCommand(db, '-8 早餐\n+10 灵感 @灵感');
  const r = applyOps(db, engine, ops);
  assert.equal(r.done, 2);
  assert.equal(engine.balanceOf(db, 'r1'), 92);
  assert.equal(engine.balanceOf(db, 'r2'), 20);
});

test('文本账单：序列化→解析→镜像新增/冲正闭环', () => {
  const db = mkDb();
  applyOps(db, engine, [{ resource_id: 'r1', direction: 'credit', amount: 8, note: '早餐' }, { resource_id: 'r2', direction: 'credit', amount: 5, note: '咖啡' }]);
  const s = serializeLedger(db);
  assert.ok(s.md.includes('-8'));
  assert.ok(s.md.includes('@灵感'));
  const { rows } = parseLedger(s.md);
  assert.equal(rows.length, 2);
  const stat = applyLedger(db, engine, rows);
  assert.equal(stat.created, 0);
  assert.equal(stat.reversed, 0);
});

test('镜像：删除一行 → 冲正原单（不物理删除）', () => {
  const db = mkDb();
  applyOps(db, engine, [{ resource_id: 'r1', direction: 'credit', amount: 8, note: '早餐' }, { resource_id: 'r1', direction: 'credit', amount: 5, note: '咖啡' }]);
  const s = serializeLedger(db);
  let { rows } = parseLedger(s.md);
  rows = rows.filter((r) => r.note === '早餐');
  const stat = applyLedger(db, engine, rows);
  assert.equal(stat.reversed, 1);
  assert.equal(engine.balanceOf(db, 'r1'), 92); // 100-8-5+5
  assert.ok(db.txs.some((t) => t.source_type === 'reversal'));
});

test('镜像：改金额 → 冲正原单 + 新流水', () => {
  const db = mkDb();
  applyOps(db, engine, [{ resource_id: 'r1', direction: 'credit', amount: 8, note: '早餐' }]);
  const s = serializeLedger(db);
  let { rows } = parseLedger(s.md);
  rows[0].amount = 10;
  const stat = applyLedger(db, engine, rows);
  assert.equal(stat.reversed, 1);
  assert.equal(stat.created, 1);
  assert.equal(engine.balanceOf(db, 'r1'), 90); // 100-8+8-10
});
test('多类支出：商品多资源成本 → 展开多行 DSL → 双资源入账', () => {
  const db = mkDb();
  // 商品「咖啡」成本 = 价值元 8 + 灵感 5（多资源）
  const good = { id: 'gd1', name: '咖啡', note: '咖啡', costs: [{ resource_id: 'r1', amount: 8 }, { resource_id: 'r2', amount: 5 }] };
  // 键盘端展开逻辑：costs.forEach → 每资源一行 DSL
  const lines = good.costs.map((c) => {
    const r = db.resources.find((x) => x.id === c.resource_id);
    return '-' + Number(c.amount) + ' ' + (good.note || good.name).trim() + (r ? ' @' + r.name : '');
  });
  const dsl = lines.join('\n');
  assert.equal(dsl, '-8 咖啡 @价值元\n-5 咖啡 @灵感');
  const { ops, errors } = parseLedgerCommand(db, dsl);
  assert.equal(errors.length, 0);
  assert.equal(ops.length, 2);
  const r = applyOps(db, engine, ops);
  assert.equal(r.done, 2);
  assert.equal(engine.balanceOf(db, 'r1'), 92); // 100-8
  assert.equal(engine.balanceOf(db, 'r2'), 5);  // 10-5
});
test('一行多命令：-8 早餐 +10 工资 → 两条命令', () => {
  const db = mkDb();
  const { ops, errors } = parseLedgerCommand(db, '-8 早餐 +10 工资');
  assert.equal(errors.length, 0);
  assert.equal(ops.length, 2);
  assert.equal(ops[0].amount, 8);
  assert.equal(ops[0].direction, 'credit');
  assert.equal(ops[1].amount, 10);
  assert.equal(ops[1].direction, 'debit');
});

test('一行多命令带资源：-8 早餐 @灵感 +5 咖啡 → 双命令各指定资源', () => {
  const db = mkDb();
  const { ops } = parseLedgerCommand(db, '-8 早餐 @灵感 +5 咖啡');
  assert.equal(ops.length, 2);
  assert.equal(ops[0].resource_id, 'r2'); // 灵感
  assert.equal(ops[1].resource_id, 'r1'); // 价值元（缺省）
});

test('混合多行：每行可多条，空行/注释跳过', () => {
  const db = mkDb();
  const { ops, errors } = parseLedgerCommand(db, '-8 早餐 +10 工资\n# 注释\n-5 咖啡 @灵感 +3 茶');
  assert.equal(errors.length, 0);
  assert.equal(ops.length, 4);
});

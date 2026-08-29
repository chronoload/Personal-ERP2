// ============================================================
// tests/importmerge.test.js
// 增量合并导入单元测试：商品成本重映射 / 同批去重 / 字段规范化兜底
// 运行：node --test tests/importmerge.test.js
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedDB } from '../src/store/db.js';
import { mergeImport, inspectImport } from '../src/domain/importMerge.js';
import * as E from '../src/domain/engine.js';

// 最小化的干净库（独立于演示数据）
function freshDB() {
  const db = seedDB();
  db.resources = [{ id: 'r1', name: '价值元', unit: '价值元', initial: 100, status: 'Active', created: 0 }];
  db.rules = []; db.goals = []; db.plans = []; db.activities = []; db.txs = []; db.outputs = []; db.valueflows = []; db.goods = [];
  db.seq = { r: 1, g: 0, p: 0, a: 0, t: 0, o: 0, v: 0, gd: 0 };
  return db;
}

test('导入同名资源时 goods.costs.resource_id 正确重映射到本地资源 id', () => {
  const db = freshDB();
  const incoming = {
    resources: [
      { id: 'x1', name: '价值元', unit: '价值元', initial: 999, status: 'Active' }, // 同名 → 复用 r1
      { id: 'x2', name: '精力', unit: '点', initial: 10, status: 'Active' },        // 新增
    ],
    goods: [{
      id: 'xgd', name: '咖啡', emoji: '☕',
      costs: [{ resource_id: 'x1', amount: 12 }, { resource_id: 'x2', amount: 2 }],
      note: '', status: 'Active', created: 0,
    }],
    rules: [], goals: [], plans: [], activities: [], txs: [], outputs: [], valueflows: [],
  };
  const prev = inspectImport(db, incoming);
  assert.equal(prev.sameRes, 1);
  assert.equal(prev.goods, 1);
  const res = mergeImport(db, incoming);
  assert.equal(res.reusedRes, 1);
  assert.equal(res.addedRes, 1);
  assert.equal(db.goods.length, 1);
  // 商品成本引用全部重映射：x1→r1（复用），x2→r2（新增分配的 id）
  const r2id = db.resources.find((r) => r.name === '精力').id;
  assert.deepEqual(
    db.goods[0].costs.map((c) => c.resource_id).sort(),
    ['r1', r2id].sort(),
  );
  // 消费商品不产生幽灵流水：两条流水均指向真实存在的资源
  const ok = E.consumeGood(db, db.goods[0].id, { qty: 1 });
  assert.equal(ok.ok, true);
  assert.equal(db.txs.length, 2);
  for (const t of db.txs) {
    assert.ok(db.resources.some((r) => r.id === t.resource_id), `流水 ${t.id} 指向不存在的资源`);
  }
});

test('同批含重复 id 只入一条', () => {
  const db = freshDB();
  const act = { id: 'xa', title: 'a', note: '', plan_ids: [], status: 'Planned', created: 0 };
  const tx = { id: 'xt', resource_id: 'r1', debit: 0, credit: 5, source_type: 'manual', source_id: null, note: '', reversal_of: null, created: 1 };
  const incoming = {
    resources: [],
    rules: [], goals: [], plans: [],
    activities: [act, { ...act, title: 'a-重复' }],
    txs: [tx, { ...tx, credit: 99 }],
    outputs: [], valueflows: [], goods: [],
  };
  const res = mergeImport(db, incoming);
  assert.equal(res.activities, 1); // 第二条被跳过
  assert.equal(res.txs, 1);
  assert.equal(db.activities.length, 1);
  assert.equal(db.txs.length, 1);
  assert.equal(db.txs[0].credit, 5); // 保留先到的那条，未被后一条覆盖

  // 再次导入同批 → 与库内已有 id 去重，仍只入一条
  const res2 = mergeImport(db, incoming);
  assert.equal(res2.activities, 0);
  assert.equal(res2.txs, 0);
  assert.equal(db.activities.length, 1);
  assert.equal(db.txs.length, 1);
});

test('缺 plan_ids/time_logs/conflicts 字段的旧格式活动导入后字段齐全', () => {
  const db = freshDB();
  const incoming = {
    resources: [],
    rules: [], goals: [], plans: [],
    activities: [{ id: 'xa', title: '旧格式活动', status: 'Planned', created: 0 }], // 无 plan_ids/time_logs/conflicts/theme
    txs: [], outputs: [], valueflows: [], goods: [],
  };
  const res = mergeImport(db, incoming);
  assert.equal(res.activities, 1);
  const a = db.activities[0];
  assert.deepEqual(a.plan_ids, []);
  assert.deepEqual(a.time_logs, []);
  assert.deepEqual(a.conflicts, []);
  assert.equal(a.theme, null);
  // 引擎安全读取：planCost / 冲突仲裁等不再抛 TypeError
  E.startActivity(db, a.id);
  assert.equal(a.status, 'Started');
  E.completeActivity(db, a.id, { expense: { resource_id: 'r1', amount: 1, note: '' }, output_title: 'o', output_tags: [] });
  assert.equal(a.status, 'Completed');

  // outputs / valueflows / txs 缺字段同理兜底
  const db2 = freshDB();
  const inc2 = {
    resources: [],
    rules: [], goals: [], plans: [], activities: [],
    outputs: [{ id: 'xo', title: '旧产出', created: 0 }],            // 缺 tags/activity_id
    valueflows: [{ id: 'xv', created: 0 }],                          // 缺 output_id
    txs: [{ id: 'xt', resource_id: 'r1', debit: 3, credit: 0, source_type: 'manual', note: '', created: 1 }], // 缺 reversal_of/source_id
    goods: [],
  };
  mergeImport(db2, inc2);
  assert.deepEqual(db2.outputs[0].tags, []);
  assert.equal(db2.outputs[0].activity_id, null);
  assert.equal(db2.valueflows[0].output_id, null);
  assert.equal(db2.txs[0].reversal_of, null);
  assert.equal(E.balanceOf(db2, 'r1'), 103);
});

// ---- 数据安全：合并失败绝不污染原库（事故回归：半残库被持久化→重启被种子覆盖） ----
test('结构不合格的备份直接拒绝，原库分毫不动', () => {
  const db = freshDB();
  const before = JSON.stringify(db);
  assert.throws(() => mergeImport(db, { rules: [] }), /resources/);      // 缺 resources
  assert.throws(() => mergeImport(db, null), /resources/);               // 整个为空
  assert.equal(JSON.stringify(db), before);                              // 原库零改动
});

test('incoming 含 null/缺 id 实体时防御跳过而非中途崩溃', () => {
  const db = freshDB();
  const incoming = {
    resources: [null, { id: 'x1', name: '灵感', initial: 0 }, 'garbage'],
    goals: [null, { id: 'xg', title: 'g' }, { title: '无id被跳过' }],
    activities: [null, { id: 'xa', title: 'a' }],
    txs: [null],
    rules: [], plans: [], outputs: [], valueflows: [], goods: [],
  };
  const res = mergeImport(db, incoming);
  assert.equal(res.addedRes, 1);
  assert.equal(res.goals, 1); // 无 id 的条目被过滤，只入 1 条
  assert.equal(res.activities, 1);
  assert.equal(db.goals.every((g) => g.id), true);
});

test('原有语义不回归：同名资源复用、按 id 去重、引用重映射', () => {  const db = freshDB();
  const incoming = {
    resources: [
      { id: 'x1', name: '价值元', unit: '价值元', initial: 999, status: 'Active' }, // 同名 → 复用 r1
      { id: 'x2', name: '灵感', unit: '点', initial: 10, status: 'Active' },
    ],
    rules: [{ id: 'xr', label: '规则', from: 'x1', to: 'x2', rate: 3, status: 'Active' }],
    goals: [{ id: 'xg', title: 'g', desc: '' }],
    plans: [{ id: 'xp', goal_id: 'xg', title: 'p', budget: null, status: 'Incubating' }],
    activities: [{ id: 'xa', title: 'a', note: '', plan_ids: ['xp'], status: 'Planned', created: 0 }],
    txs: [{ id: 'xt', resource_id: 'x1', debit: 0, credit: 5, source_type: 'manual', source_id: 'manual', note: '', reversal_of: null, created: 1 }],
    outputs: [], valueflows: [], goods: [],
  };
  const prev = inspectImport(db, incoming);
  assert.equal(prev.sameRes, 1);
  assert.equal(prev.newRes, 1);
  const res = mergeImport(db, incoming);
  assert.equal(res.reusedRes, 1);
  assert.equal(res.addedRes, 1);
  assert.equal(db.resources.length, 2);           // 同名未新增重复
  assert.equal(db.resources.some((r) => r.id === 'x1'), false);
  assert.equal(db.rules[0].from, 'r1');           // 规则引用重映射
  assert.equal(db.rules[0].to, 'r2');
  assert.equal(db.txs[0].resource_id, 'r1');      // 流水引用重映射
  assert.equal(E.balanceOf(db, 'r1'), 95);        // 并入既有账户余额
  assert.equal(db.goals.length, 1);
  assert.equal(db.plans[0].goal_id, 'xg');        // 非资源引用保持原 id
  assert.equal(db.activities[0].plan_ids[0], 'xp');
});

// ---- L5-1 回归：同批重复资源 id（异名）→ 首见为准，流水归属稳定 ----
test('同批重复资源 id 不同名：首见为准，流水归甲，乙不入库', () => {
  const db = freshDB();
  const incoming = {
    resources: [
      { id: 'x9', name: '甲账户', unit: '', initial: 0, status: 'Active' },
      { id: 'x9', name: '乙账户', unit: '', initial: 0, status: 'Active' }, // 重复 id，必须跳过
    ],
    rules: [], goals: [], plans: [], activities: [],
    txs: [{ id: 'xt', resource_id: 'x9', debit: 10, credit: 0, source_type: 'manual', source_id: 'manual', note: '', reversal_of: null, created: 1 }],
    outputs: [], valueflows: [], goods: [],
  };
  const res = mergeImport(db, incoming);
  assert.equal(res.skippedDupRes, 1);                                 // 跳过并计数
  assert.equal(res.addedRes, 1);                                      // 只新增甲
  assert.equal(db.resources.some((r) => r.name === '乙账户'), false); // 乙永不入库（无幻影账户）
  const jia = db.resources.find((r) => r.name === '甲账户');
  assert.equal(db.txs.length, 1);
  assert.equal(db.txs[0].resource_id, jia.id);                        // 流水归首见（甲），不随后写覆盖漂移
  assert.equal(E.balanceOf(db, jia.id), 10);
});

// ---- 正常路径回归：单一资源不受批内去重影响 ----
test('单一资源正常路径不受去重影响', () => {
  const db = freshDB();
  const incoming = {
    resources: [{ id: 'z1', name: '精力', unit: '点', initial: 7, status: 'Active' }],
    rules: [], goals: [], plans: [], activities: [],
    txs: [{ id: 'zt', resource_id: 'z1', debit: 3, credit: 0, source_type: 'manual', source_id: null, note: '', reversal_of: null, created: 1 }],
    outputs: [], valueflows: [], goods: [],
  };
  const res = mergeImport(db, incoming);
  assert.equal(res.addedRes, 1);
  assert.equal(res.skippedDupRes, 0);
  assert.equal(res.txs, 1);
  const zid = db.resources.find((r) => r.name === '精力').id;
  assert.equal(db.txs[0].resource_id, zid);
  assert.equal(E.balanceOf(db, zid), 10);
});

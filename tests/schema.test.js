// ============================================================
// tests/schema.test.js
// 库结构版本化单元测试：版本戳 / 遗留库迁移 / 未来版本保护 / 空存储初始化
// 运行：npm test  (node --test)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA_VERSION, seedDB, resetDB, loadDB, normalizeDB } from '../src/store/db.js';

// node:test 环境没有浏览器存储：装一个最小内存版 localStorage 桩
const memStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => { memStore.set(k, String(v)); },
  removeItem: (k) => { memStore.delete(k); },
  clear: () => { memStore.clear(); },
};

// ---- seedDB / resetDB：产出必须带当前版本戳 ----
test('seedDB：全新种子库盖章 schemaVersion = SCHEMA_VERSION', () => {
  const db = seedDB();
  assert.equal(SCHEMA_VERSION, 3);
  assert.equal(db.schemaVersion, SCHEMA_VERSION);
});

test('resetDB：重置后的库同样盖章为当前版本', () => {
  const db = resetDB();
  assert.equal(db.schemaVersion, SCHEMA_VERSION);
});

// ---- normalizeDB：遗留库（无 schemaVersion = v0）修复后盖章 ----
test('normalizeDB：遗留库补齐修复并盖章为当前版本', () => {
  const legacy = { resources: [{ id: 'r1', name: 123 }], activities: [{ id: 'a1', title: 'x' }] };
  normalizeDB(legacy);
  assert.equal(legacy.schemaVersion, SCHEMA_VERSION);
  // 修复语义保持不变：缺集合补空数组、实体字段补安全默认值
  assert.deepEqual(legacy.rules, []);
  assert.deepEqual(legacy.goods, []);
  assert.equal(legacy.resources[0].name, ''); // 非字符串名 → 安全默认值
  assert.equal(legacy.resources[0].status, 'Active');
  assert.deepEqual(legacy.activities[0].plan_ids, []);
});

// ---- normalizeDB：未来版本原样放行（不降级、不修复、不改动）----
test('normalizeDB：未来版本直接返回且完全不被改动', () => {
  const future = {
    schemaVersion: 99,
    resources: [{ id: 'r1' }],
    activities: '未知的新结构（非数组）',
  };
  const out = normalizeDB(future);
  assert.equal(out, future); // 原对象原样返回
  assert.equal(future.schemaVersion, 99); // 绝不降级
  assert.deepEqual(future.resources, [{ id: 'r1' }]); // 实体未被补字段
  assert.equal(future.goods, undefined); // 缺失集合未被补建
  assert.equal(future.activities, '未知的新结构（非数组）'); // 修复逻辑被跳过
});

// ---- loadDB：空存储回退到带版本戳的种子库 ----
test('loadDB：空存储返回种子库且版本为当前版', () => {
  const db = loadDB();
  assert.equal(db.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(db.resources, []);
  assert.deepEqual(db.txs, []);
});

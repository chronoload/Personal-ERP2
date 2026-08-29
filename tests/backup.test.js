// ============================================================
// tests/backup.test.js
// 备份服务测试：序列化/解析往返、损坏文件识别（事故#1 回归）
// 运行：npm test
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Backup } from '../src/services/backup.js';

function sampleDB() {
  return {
    resources: [{ id: 'r1', name: 'Token', unit: 'Token', initial: 100, status: 'Active', created: 0 }],
    rules: [], goals: [], plans: [], activities: [], txs: [], outputs: [], valueflows: [],
    goods: [],
    seq: { r: 1, ru: 0, g: 0, p: 0, a: 0, t: 0, o: 0, v: 0, gd: 0 },
  };
}

// ---- 序列化/解析往返 ----
test('备份：serialize→parse 往返还原 db', () => {
  const db = sampleDB();
  const json = Backup.serialize(db);
  const res = Backup.parse(json);
  assert.equal(res.ok, true);
  assert.deepEqual(res.db, db);
});

test('备份：parse 兼容裸 db 形状（无 app/version 包装）', () => {
  const res = Backup.parse(JSON.stringify(sampleDB()));
  assert.equal(res.ok, true);
  assert.equal(res.db.resources.length, 1);
});

// ---- 非法输入 ----
test('备份：parse 拒绝非备份数据并给中文错误', () => {
  const res = Backup.parse(JSON.stringify({ foo: 1 }));
  assert.equal(res.ok, false);
  assert.match(res.error, /不是有效的/);
});

test('备份：parse 对非法 JSON 给出解析失败错误', () => {
  const res = Backup.parse('{"app":"personal-erp",');
  assert.equal(res.ok, false);
  assert.match(res.error, /JSON 解析失败/);
});

// ---- 事故#1 回归：二进制损坏备份必须被识别并给针对性提示 ----
// 复现损坏机制：旧版无 encoding 导出时 Android 把 JSON 当 base64 解码写盘，
// 读回的文本 ≈ base64_decode(去非字母表字符后的 JSON) 的原始字节流。
function corruptLikeAndroidBug(json) {
  const b64stream = json.replace(/[^A-Za-z0-9+/=]/g, '');
  // latin1 读回：保留字节级特征（含控制字符），与真机乱码一致
  return Buffer.from(b64stream, 'base64').toString('latin1');
}

test('备份：parse 识别二进制损坏备份（事故#1 回归）', () => {
  const corrupted = corruptLikeAndroidBug(Backup.serialize(sampleDB()));
  const res = Backup.parse(corrupted);
  assert.equal(res.ok, false);
  assert.match(res.error, /二进制|抢救/);
});

test('备份：正常中文 JSON 不被误判为二进制', () => {
  const res = Backup.parse(Backup.serialize(sampleDB()));
  assert.equal(res.ok, true); // 能正常解析即未被误拦
});

test('备份：空字符串解析失败但不崩溃', () => {
  const res = Backup.parse('');
  assert.equal(res.ok, false);
});

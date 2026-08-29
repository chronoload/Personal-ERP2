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
function finish(db, id) {
  assert.equal(E.startActivity(db, id).ok, true);
  const r = E.completeActivity(db, id, { expense: { resource_id: 'r1', amount: 1 }, output_title: 'o', output_tags: [] });
  assert.equal(r.ok, true);
}

test('BOUNDED: Planned -> Failed 显式终态（非循环自动 re-init）', () => {
  const db = freshDB();
  E.createActivity(db, { title: 't', planned_date: '2026-8-20' });
  const r = E.failActivity(db, db.activities[0].id, '超时放弃');
  assert.equal(r.ok, true);
  assert.equal(r.reInited, true);
  // 非循环失败不堆积：自动重初始化回 Planned，可立即重试
  assert.equal(db.activities[0].status, 'Planned');
  assert.equal(db.activities[0].failedReason, null);
});

test('BOUNDED: 循环失败标记 skipped 并推进到下一期（列表仍 1 条）', () => {
  const db = freshDB();
  E.createActivity(db, { title: '每日', planned_date: '2026-8-10', repeat: 'daily', repeat_until: '2026-8-15' });
  const a = db.activities[0];
  const r = E.failActivity(db, a.id, '放弃');
  assert.equal(r.ok, true);
  assert.equal(r.advanced, true);
  assert.equal(db.activities.length, 1); // 不衍生副本
  assert.equal(a.occurrences[0].status, 'skipped');
  assert.equal(a.status, 'Planned'); // 推进回 Planned 可重试
  assert.equal(a.planned_date, '2026-8-11');
});

test('BOUNDED: 循环完成/失败均推进不衍生；非循环失败 re-init', () => {
  const db = freshDB();
  E.createActivity(db, { title: '每日2', planned_date: '2026-8-10', repeat: 'daily', repeat_until: '2026-8-12' });
  const a = db.activities[0];
  E.startActivity(db, a.id);
  const r1 = E.completeActivity(db, a.id, { expense: { resource_id: 'r1', amount: 1 }, output_title: 'o' });
  assert.equal(r1.advanced, true);
  assert.equal(db.activities.length, 1);
  assert.equal(a.status, 'Planned');
  assert.equal(a.occurrences[0].status, 'done');
  // 再失败一次 → skipped + 推进
  const r2 = E.failActivity(db, a.id, '跳过');
  assert.equal(r2.advanced, true);
  assert.equal(a.occurrences[1].status, 'skipped');
  assert.equal(a.planned_date, '2026-8-12');
  // 非循环失败 re-init 可重试
  E.createActivity(db, { title: '单次', planned_date: '2026-8-10' });
  const c = db.activities[1];
  const rc = E.failActivity(db, c.id);
  assert.equal(rc.reInited, true);
  assert.equal(c.status, 'Planned');
});

test('BOUNDED: 非法流转被拒绝 - Completed -> Failed', () => {
  const db = freshDB();
  E.createActivity(db, { title: 't2', planned_date: '2026-8-20' });
  finish(db, db.activities[0].id);
  const r = E.failActivity(db, db.activities[0].id);
  assert.equal(r.ok, false);
});

test('BOUNDED: 转移表单一真源显式可打印', async () => {
  const { ACTIVITY_TRANSITION_TABLE } = await import('../src/domain/entities.js');
  assert.ok(ACTIVITY_TRANSITION_TABLE['Planned->Started']);
  assert.ok(!ACTIVITY_TRANSITION_TABLE['Completed->Failed']);
});

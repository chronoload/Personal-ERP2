import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDB, normalizeDB, SCHEMA_VERSION } from '../src/store/db.js';
import {
  createActivity, updateActivity, updateSeries, createPlan, createGoal,
} from '../src/domain/engine.js';
import { createPlace, removePlace, setCurrentPlace } from '../src/domain/places.js';
import { classifyDepth } from '../src/domain/attention.js';

// 活动表单 → engine → 库 的排班参数闭环：
// place_id / depth 是排班寻路与注意力预算的输入，必须在创建、编辑、系列拆分、
// 库归一化四条路径上都能写入且不丢。
function mkDb() {
  const db = seedDB();
  normalizeDB(db);
  const g = createGoal(db, { title: '目标' });
  assert.ok(g.ok);
  const p = createPlan(db, { goal_id: db.goals[0].id, title: '计划', budget: null });
  assert.ok(p.ok);
  return db;
}

test('createActivity：写入 place_id 与 depth 显式覆盖', () => {
  const db = mkDb();
  createPlace(db, { name: '工位', lat: 31.2, lng: 121.4 });
  const pid = db.places[0].id;
  const r = createActivity(db, {
    title: '写章节', plan_ids: [db.plans[0].id], planned_minutes: 30,
    place_id: pid, depth: true,
  });
  assert.ok(r.ok);
  const a = db.activities[0];
  assert.equal(a.place_id, pid);
  assert.equal(a.depth, true);
  // 30 分钟本应被判为浅层，显式 depth=true 必须覆盖自动判定
  assert.equal(classifyDepth(a), true);
});

test('createActivity：depth=null 回落自动判定；非法地点被拒', () => {
  const db = mkDb();
  const r = createActivity(db, { title: 'A', plan_ids: [], planned_minutes: 60, depth: null });
  assert.ok(r.ok);
  assert.equal(db.activities[0].depth, null);
  assert.equal(classifyDepth(db.activities[0]), true, '60 分钟自动判为深度');

  const bad = createActivity(db, { title: 'B', plan_ids: [], place_id: 'pl404' });
  assert.equal(bad.ok, false);
  assert.equal(db.activities.length, 1, '非法地点不应创建活动');
});

test('updateActivity：可设、可改、可清空地点与深度', () => {
  const db = mkDb();
  createPlace(db, { name: '家' });
  const plid = db.places[0].id;
  createActivity(db, { title: 'A', plan_ids: [] });
  const id = db.activities[0].id;

  assert.ok(updateActivity(db, id, { title: 'A', place_id: plid, depth: false }).ok);
  assert.equal(db.activities[0].place_id, plid);
  assert.equal(db.activities[0].depth, false);

  // 传空字符串 = 解除地点约束
  assert.ok(updateActivity(db, id, { title: 'A', place_id: '', depth: null }).ok);
  assert.equal(db.activities[0].place_id, null);
  assert.equal(db.activities[0].depth, null);

  // 未提供该字段时不动原值
  assert.ok(updateActivity(db, id, { title: 'A2', place_id: plid }).ok);
  assert.ok(updateActivity(db, id, { title: 'A3' }).ok);
  assert.equal(db.activities[0].place_id, plid, '缺省 place_id 不应被清空');
});

test('updateSeries(only)：拆出的独立活动继承地点的排班参数', () => {
  const db = mkDb();
  createPlace(db, { name: '工位' });
  const plid = db.places[0].id;
  createActivity(db, {
    title: '循环', plan_ids: [db.plans[0].id], planned_minutes: 60,
    planned_start: '2026-10-20T09:00', repeat: 'daily', repeat_until: '2026-10-23',
    place_id: plid, depth: true,
  });
  const id = db.activities[0].id;
  const r = updateSeries(db, id, 'only', { title: '循环', planned_minutes: 60 });
  assert.ok(r.ok);
  const ex = db.activities.find((x) => x.id === r.exception_id);
  assert.ok(ex, '应拆出例外活动');
  assert.equal(ex.place_id, plid, '未显式提供时继承系列值');
  assert.equal(ex.depth, true);
});

test('removePlace：连带清空活动上的地点约束，不留悬空引用', () => {
  const db = mkDb();
  createPlace(db, { name: '工位' });
  const plid = db.places[0].id;
  createActivity(db, { title: 'A', plan_ids: [], place_id: plid });
  setCurrentPlace(db, plid);
  assert.equal(db.activities[0].place_id, plid);

  removePlace(db, plid);
  assert.equal(db.activities[0].place_id, null);
  assert.equal(db.currentPlaceId, null);
});

test('normalizeDB：旧库补 place_id/depth，并清理悬空地点引用', () => {
  const legacy = {
    schemaVersion: 4,
    resources: [], rules: [], goals: [], plans: [],
    txs: [], outputs: [], valueflows: [], goods: [], journals: [],
    activities: [
      { id: 'a1', title: '旧活动', status: 'Planned' },
      { id: 'a2', title: '悬空', status: 'Planned', place_id: 'pl404' },
      { id: 'a3', title: '非法深度', status: 'Planned', depth: 'yes' },
    ],
    seq: {},
  };
  normalizeDB(legacy);
  assert.equal(legacy.schemaVersion, SCHEMA_VERSION);
  assert.equal(legacy.activities[0].place_id, null);
  assert.equal(legacy.activities[0].depth, null);
  assert.equal(legacy.activities[1].place_id, null, '指向不存在地点的引用被清理');
  assert.equal(legacy.activities[2].depth, null, '非布尔 depth 归一为空');
});

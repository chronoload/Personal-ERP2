// tests/places.test.js —— 地点 / 通勤矩阵 / 可行性（SPEC_graph_scheduler §1.1 §5）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPlace, commuteMinutes, feasibleAt, feasibleActivities,
  distanceMeters, nearestPlace, createPlace, updatePlace, removePlace,
  setCurrentPlace, setCommute, isGeofenceable,
} from '../src/domain/places.js';

function mkDb() {
  return {
    places: [
      { id: 'home', name: '家', lat: 0, lng: 0, radius: 100 },
      { id: 'office', name: '工位' },
      { id: 'gym', name: '健身房' },
    ],
    // 通勤矩阵单向存储，查找按对称处理（家→工位 30 分，反方向同样 30）
    commutes: [{ from_id: 'home', to_id: 'office', minutes: 30 }],
  };
}

test('getPlace：按 id 取地点，未知返回 null', () => {
  const db = mkDb();
  assert.equal(getPlace(db, 'home')?.name, '家');
  assert.equal(getPlace(db, 'nope'), null);
  assert.equal(getPlace({}, 'home'), null);
});

test('commuteMinutes：命中取分钟；对称查找反向；同地点 0；未知对 null', () => {
  const db = mkDb();
  assert.equal(commuteMinutes(db, 'home', 'office'), 30);
  assert.equal(commuteMinutes(db, 'office', 'home'), 30, '反向对称');
  assert.equal(commuteMinutes(db, 'home', 'home'), 0);
  assert.equal(commuteMinutes(db, 'home', 'gym'), null, '未定义的地点对');
  assert.equal(commuteMinutes(db, null, 'office'), 0, '无地点视为无通勤');
});

test('feasibleAt：活动无地点=任何地点可行；绑定地点须匹配', () => {
  assert.equal(feasibleAt({ place_id: null }, 'home'), true);
  assert.equal(feasibleAt({}, 'office'), true);
  assert.equal(feasibleAt({ place_id: 'office' }, 'office'), true);
  assert.equal(feasibleAt({ place_id: 'gym' }, 'home'), false);
  assert.equal(feasibleAt({ place_id: 'gym' }, null), false, '需要特定地点却无定位 → 不可行');
});

test('feasibleActivities：按当前地点过滤可行集', () => {
  const db = mkDb();
  const acts = [
    { id: 'a1', title: '写方案', place_id: null },
    { id: 'a2', title: '做实验', place_id: 'office' },
    { id: 'a3', title: '撸铁', place_id: 'gym' },
  ];
  const atHome = feasibleActivities(acts, 'home', db).map((a) => a.id);
  assert.deepEqual(atHome.sort(), ['a1', 'a2'], '同地点/无地点直接可行；工位可通勤到达；健身房无通勤边');
});

test('distanceMeters / nearestPlace：半径内取最近，半径外不吸附', () => {
  const db = mkDb();
  db.places[0].lat = 31.2304; db.places[0].lng = 121.4737; db.places[0].radius = 100;
  db.places[1].lat = 31.2400; db.places[1].lng = 121.4800; db.places[1].radius = 100;
  const hit = nearestPlace(db, { lat: 31.2305, lng: 121.4738 });
  assert.equal(hit.place.id, 'home');
  assert.ok(hit.distance < 30);
  assert.equal(nearestPlace(db, { lat: 31.0, lng: 121.0 }), null, '半径外不吸附');
  assert.equal(distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }), 0);
});

test('地点 CRUD：创建分配 id，经纬度成对，删除清通勤与当前地点', () => {
  const db = { places: [], commutes: [], currentPlaceId: null, seq: {} };
  const a = createPlace(db, { name: '家', lat: 31.2, lng: 121.4, radius: 120 });
  const b = createPlace(db, { name: '工位', lat: 31.3, lng: 121.5, radius: 150 });
  const c = createPlace(db, { name: '图书馆' });
  assert.equal(a.place.id, 'pl1');
  assert.equal(b.place.id, 'pl2');
  assert.equal(c.place.id, 'pl3');
  assert.equal(createPlace(db, { name: ' ' }).ok, false, '空名称拒绝');
  assert.equal(updatePlace(db, 'pl3', { lat: 31.2 }).ok, false, '只给纬度不合法');
  assert.equal(updatePlace(db, 'pl1', { name: '家（新）', radius: 80 }).place.radius, 80);
  setCurrentPlace(db, 'pl1');
  setCommute(db, 'pl1', 'pl2', 30);
  assert.equal(removePlace(db, 'pl1').ok, true);
  assert.deepEqual(db.commutes, []);
  assert.equal(db.currentPlaceId, null);
});

test('setCommute：对称去重，空值删除', () => {
  const db = { places: [{ id: 'h', name: '家' }, { id: 'o', name: '工位' }], commutes: [], currentPlaceId: null, seq: {} };
  assert.equal(setCommute(db, 'h', 'o', 25).commute.minutes, 25);
  assert.equal(setCommute(db, 'o', 'h', 40).commute.minutes, 40);
  assert.equal(db.commutes.length, 1, '反向更新同一条边');
  setCommute(db, 'o', 'h', '');
  assert.deepEqual(db.commutes, []);
});

test('isGeofenceable：有经纬度才进原生围栏', () => {
  assert.equal(isGeofenceable({ lat: 1, lng: 2 }), true);
  assert.equal(isGeofenceable({ lat: 1 }), false);
  assert.equal(isGeofenceable({}), false);
});

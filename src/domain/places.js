// ============================================================
// domain/places.js —— 地点 / 通勤矩阵 / 可行性
// 两种语义必须区分：
//   feasibleAt     「此刻能否直接开始」→ 提醒门控（人必须已在该地点）
//   commuteMinutes 「从 A 到 B 需要多久」→ 排班寻路（允许跨地点，但要付通勤成本）
// 把两者混成一条规则，会导致「要么不能跨地点排班，要么通勤权重失效」。
// ============================================================

export function getPlace(db, id) {
  if (!db || !Array.isArray(db.places) || !id) return null;
  return db.places.find((p) => p.id === id) || null;
}

/**
 * 通勤分钟。对称查找（家→工位 与 工位→家 同值）。
 * @returns {number|null} 无地点/同地点 = 0；未定义的地点对 = null（视为不可达，不用 0 假装可达）
 */
export function commuteMinutes(db, fromId, toId) {
  if (!fromId || !toId) return 0;
  if (fromId === toId) return 0;
  const list = (db && Array.isArray(db.commutes)) ? db.commutes : [];
  const hit = list.find((c) => (c.from_id === fromId && c.to_id === toId)
    || (c.from_id === toId && c.to_id === fromId));
  if (!hit) return null;
  const n = Number(hit.minutes);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// 此刻能否直接开始：活动无地点约束 = 任何地点可以；有约束则必须匹配当前地点
export function feasibleAt(a, currentPlaceId) {
  const need = a && a.place_id;
  if (!need) return true;
  return need === currentPlaceId;
}

// 可行的两种口径：此刻就在该地点；或存在一条已定义的通勤边可以过去。
// 没有 db（未提供通勤矩阵）时退化为严格的「此刻可行」。
export function feasibleActivities(acts, currentPlaceId, db = null) {
  return (acts || []).filter((a) => {
    if (feasibleAt(a, currentPlaceId)) return true;
    if (!db || !currentPlaceId || !a || !a.place_id) return false;
    return commuteMinutes(db, currentPlaceId, a.place_id) != null;
  });
}

// ---------- 地点池写入（供 UI / 同步服务调用，全部返回 {ok} 信封） ----------
const EARTH_R = 6371000;

export function distanceMeters(a, b) {
  if (!a || !b) return null;
  const lat1 = Number(a.lat), lng1 = Number(a.lng);
  const lat2 = Number(b.lat), lng2 = Number(b.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 最近地点：只返回落在该地点半径内的候选。
 * @returns {{place:object,distance:number}|null}
 */
export function nearestPlace(db, loc) {
  let best = null;
  for (const p of (db && db.places) || []) {
    const d = distanceMeters(loc, p);
    if (d == null) continue;
    if (d > (Number(p.radius) || 120)) continue;
    if (!best || d < best.distance) best = { place: p, distance: d };
  }
  return best;
}

function cleanCoord(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizePlaceInput(input) {
  const name = String((input && input.name) || '').trim();
  if (!name) return { ok: false, error: '地点名称不能为空' };
  const lat = cleanCoord(input.lat);
  const lng = cleanCoord(input.lng);
  if ((lat == null) !== (lng == null)) return { ok: false, error: '经纬度需要同时填写' };
  if (lat != null && (lat < -90 || lat > 90)) return { ok: false, error: '纬度超出范围' };
  if (lng != null && (lng < -180 || lng > 180)) return { ok: false, error: '经度超出范围' };
  const radius = Number(input.radius);
  return {
    ok: true,
    value: {
      name,
      lat,
      lng,
      radius: Number.isFinite(radius) ? Math.min(5000, Math.max(30, Math.round(radius))) : 120,
      color: input.color || null,
    },
  };
}

// 只有带经纬度的地点才能进原生围栏；无坐标地点仍可用于手动切换
export function isGeofenceable(p) {
  return !!p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
}

function nextId(db, key, prefix) {
  db.seq = db.seq || {};
  db.seq[key] = (db.seq[key] || 0) + 1;
  return prefix + db.seq[key];
}

export function createPlace(db, input) {
  const r = normalizePlaceInput(input);
  if (!r.ok) return r;
  const place = { id: nextId(db, 'pl', 'pl'), ...r.value };
  db.places.push(place);
  return { ok: true, place };
}

export function updatePlace(db, id, patch) {
  const p = getPlace(db, id);
  if (!p) return { ok: false, error: '地点不存在' };
  const merged = { ...p, ...patch };
  const r = normalizePlaceInput(merged);
  if (!r.ok) return r;
  Object.assign(p, r.value);
  return { ok: true, place: p };
}

export function removePlace(db, id) {
  if (!getPlace(db, id)) return { ok: false, error: '地点不存在' };
  db.places = db.places.filter((p) => p.id !== id);
  db.commutes = (db.commutes || []).filter((c) => c.from_id !== id && c.to_id !== id);
  if (db.currentPlaceId === id) db.currentPlaceId = null;
  // 解开活动上的地点约束，避免留下指向已删除地点的悬空引用
  for (const a of db.activities || []) {
    if (a && a.place_id === id) a.place_id = null;
  }
  return { ok: true };
}

export function setCurrentPlace(db, id) {
  if (id != null && !getPlace(db, id)) return { ok: false, error: '地点不存在' };
  db.currentPlaceId = id || null;
  return { ok: true, currentPlaceId: db.currentPlaceId };
}

/**
 * 写入/更新通勤分钟（对称：已有反向边则原地更新，不重复建边）。
 * minutes 为空 / 非正数 → 删除该边。
 */
export function setCommute(db, fromId, toId, minutes) {
  if (!fromId || !toId || fromId === toId) return { ok: false, error: '需要两个不同地点' };
  if (!getPlace(db, fromId) || !getPlace(db, toId)) return { ok: false, error: '地点不存在' };
  db.commutes = db.commutes || [];
  const idx = db.commutes.findIndex((c) => (c.from_id === fromId && c.to_id === toId)
    || (c.from_id === toId && c.to_id === fromId));
  const n = minutes === '' || minutes == null ? NaN : Number(minutes);
  if (!Number.isFinite(n) || n <= 0) {
    if (idx >= 0) db.commutes.splice(idx, 1);
    return { ok: true, removed: true };
  }
  const edge = { from_id: fromId, to_id: toId, minutes: Math.round(n) };
  if (idx >= 0) db.commutes[idx] = edge;
  else db.commutes.push(edge);
  return { ok: true, commute: edge };
}

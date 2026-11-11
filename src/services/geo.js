// ============================================================
// services/geo.js
// 位置服务：原生后台围栏优先，Web/Tauri 手动切换 + 一次性定位兜底。
//
// 原生链路：GeofencePlugin 注册围栏 → GeofenceReceiver 收系统事件
//           → GeofenceStore 落 JSON 队列（App 不在前台也不丢）
//           → JS 回前台 drain() → 按时间顺序对账 currentPlaceId。
// 降级：无原生/权限被拒 → mode='manual'，HUD 里点地点即可切换；
//       locateOnce() 在 Web 用 navigator.geolocation，在原生用 FusedLocation。
// ============================================================
import { Capacitor, registerPlugin } from '@capacitor/core';
import { getPlace, isGeofenceable, nearestPlace, setCurrentPlace } from '../domain/places.js';

const Native = registerPlugin('Geofence');
const isNative = () => Capacitor.isNativePlatform();

let lastFp = '';
let listening = false;

function geofencePayload(db) {
  return ((db && db.places) || [])
    .filter(isGeofenceable)
    .slice(0, 40) // Play Services 围栏上限 100；每地点进/出两条
    .map((p) => ({
      id: p.id,
      name: p.name,
      lat: Number(p.lat),
      lng: Number(p.lng),
      radius: Math.max(30, Number(p.radius) || 120),
    }));
}

function fingerprint(list) {
  return JSON.stringify(list.map((p) => [p.id, p.lat, p.lng, p.radius]));
}

// 给任意 promise 加超时：超时 reject，且只 settle 一次（race 会自动消费另一个分支）
function raceTimeout(p, ms, msg) {
  return Promise.race([
    p,
    new Promise((_, reject) => { setTimeout(() => reject(new Error(msg)), ms); }),
  ]);
}

export const Geo = {
  isNative,

  // 同步围栏：地点集合未变则跳过；变化时整批重注册（remove + add 幂等）
  async sync(db) {
    if (!isNative()) return { ok: true, mode: 'manual', count: 0 };
    const list = geofencePayload(db);
    const fp = fingerprint(list);
    if (fp === lastFp) return { ok: true, mode: 'native', skipped: true, count: list.length };
    try {
      const r = await Native.start({ places: list });
      lastFp = fp;
      return { ok: true, mode: 'native', count: list.length, ...(r || {}) };
    } catch (e) {
      lastFp = '';
      return { ok: false, mode: 'manual', error: e && e.message ? e.message : String(e) };
    }
  },

  async stop() {
    lastFp = '';
    if (!isNative()) return { ok: true };
    try { await Native.stop(); return { ok: true }; } catch (e) { return { ok: false }; }
  },

  // 排空原生事件队列，按发生顺序对账当前地点；exit 只清掉匹配地点，避免漂移误清
  async reconcile(db) {
    if (!isNative()) return null;
    let res;
    try { res = await Native.drain(); } catch (e) { return null; }
    const events = (res && res.events) || [];
    if (!events.length) return null;
    let current = db.currentPlaceId || null;
    for (const ev of events) {
      if (!ev || !ev.placeId) continue;
      if (ev.event === 'enter' && getPlace(db, ev.placeId)) current = ev.placeId;
      else if (ev.event === 'exit' && current === ev.placeId) current = null;
    }
    setCurrentPlace(db, current);
    return { events, currentPlaceId: current };
  },

  // 手动切换（三端通用；Web/Tauri 的主通道）
  setCurrent(db, placeId) {
    return setCurrentPlace(db, placeId);
  },

  // 纯取当前坐标（不碰 db）：地点录入自动校准、手动对账都用它
  async getLocation() {
    try {
      // 双保险：原生侧已有 12s 看门狗，这里再加一层，任何情况都不让调用悬挂
      const r = await raceTimeout(this._rawLocation(), 15000, '定位超时（未收到系统/插件响应）');
      return r;
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  },

  async _rawLocation() {
    try {
      if (isNative()) {
        const r = await Native.locate();
        if (r && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng))) {
          return {
            ok: true,
            lat: Number(r.lat),
            lng: Number(r.lng),
            accuracy: Number.isFinite(Number(r.accuracy)) ? Number(r.accuracy) : null,
            provider: r.provider || null,
          };
        }
        return { ok: false, error: '无法获取定位' };
      }
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        return { ok: false, error: '此环境不支持定位' };
      }
      const loc = await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({
            lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy,
          }),
          (err) => resolve({ __err: (err && err.message) || '定位失败' }),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
        );
      });
      if (loc && loc.__err) return { ok: false, error: loc.__err };
      return loc ? { ok: true, ...loc } : { ok: false, error: '无法获取定位' };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  },

  // 一次性定位并吸附到最近地点；失败不抛，返回 {ok:false}
  async locateOnce(db) {
    const r = await this.getLocation();
    if (!r.ok) return r;
    const loc = { lat: r.lat, lng: r.lng, accuracy: r.accuracy ?? null };
    const hit = nearestPlace(db, loc);
    if (!hit) return { ok: true, placeId: null, distance: null, location: loc };
    setCurrentPlace(db, hit.place.id);
    return {
      ok: true, placeId: hit.place.id, name: hit.place.name,
      distance: Math.round(hit.distance), location: loc,
    };
  },

  async status() {
    if (!isNative()) return { ok: true, mode: 'manual', location: 'n/a', background: 'n/a' };
    try { return { ok: true, mode: 'native', ...(await Native.status()) }; }
    catch (e) { return { ok: false, mode: 'manual', error: String(e) }; }
  },

  async openSettings() {
    if (!isNative()) return { ok: false };
    try { await Native.openSettings(); return { ok: true }; } catch (e) { return { ok: false }; }
  },

  // App 存活时接收原生事件通知（事件本体仍需 drain，用队列保证不丢/不乱序）
  listen(cb) {
    if (listening || typeof window === 'undefined') return;
    listening = true;
    window.addEventListener('geofenceEvent', () => { try { cb(); } catch (e) { /* 忽略 */ } });
  },
};

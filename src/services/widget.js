import { Capacitor } from '@capacitor/core';
import { Prefs } from '../store/prefs.js';

const SNAPSHOT_KEY = 'widget_snapshot';
const REV_KEY = 'widget_native_rev';

export const Widget = {
  key: SNAPSHOT_KEY,

  // 是否跑在原生壳里（此前缺失这个方法，导致 pullPending/pullFromNative 一进就抛
  // TypeError 被吞掉——桌面记的流水永远进不来，表现为「写进小组件但 App 没有账」）
  nativeAvailable() {
    return Capacitor.isNativePlatform();
  },

  enabled() {
    return !!Prefs.load().widgetEnabled;
  },

  setEnabled(v) {
    Prefs.set({ widgetEnabled: !!v });
    try {
      if (Capacitor.isNativePlatform()) {
        const P = Capacitor.registerPlugin('Widget');
        P.setEnabled({ enabled: !!v }).catch(() => {});
      }
    } catch (e) {}
  },

  // 开屏首页 · 今日日程（大卡片）：缺省开启；关闭后原生卡片只显示「已在设置中关闭」
  homeEnabled() {
    const v = Prefs.load().homeTodayWidget;
    return v === undefined ? true : !!v;
  },

  async setHomeEnabled(v) {
    Prefs.set({ homeTodayWidget: !!v });
    try {
      if (!Capacitor.isNativePlatform()) return;
      const P = Capacitor.registerPlugin('Widget');
      await P.setHomeTodayEnabled({ enabled: !!v });
    } catch (e) {}
  },

  // 小组件深色主题（安卓端写入原生配置并立即刷新；web 端仅记忆偏好）
  async setDarkTheme(dark) {
    Prefs.set({ widgetDark: !!dark });
    try {
      if (!Capacitor.isNativePlatform()) return;
      const P = Capacitor.registerPlugin('Widget');
      await P.setDarkTheme({ dark: !!dark });
    } catch (e) {}
  },

  push(snapshot) {
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ ...snapshot, updatedAt: new Date().toISOString() }));
    } catch (e) {}
  },

  snapshot() {
    try { return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null'); } catch (e) { return null; }
  },

  // ---- 原生回读：桌面独立操作（开始/充值/消费）后 rev 变大，拉取原生 db 覆盖本地 ----
  // 返回 { changed:boolean }。由 main.js 在启动与回前台时调用。
  async pullFromNative() {
    if (!this.nativeAvailable()) return { changed: false };
    try {
      const P = Capacitor.registerPlugin('Widget');
      const r = await P.getData();
      const nativeRev = Number(r.rev) || 0;
      const known = Number(localStorage.getItem(REV_KEY)) || 0;
      if (!r.db) return { changed: false };
      const db = JSON.parse(r.db);
      // 原生还挂着未回读的流水时，即使 rev 没变也要拉：避免被本地旧库覆盖
      const hasNativeTx = Array.isArray(db.native_txs) && db.native_txs.length > 0;
      if (nativeRev <= known && !hasNativeTx) return { changed: false };
      delete db.native_txs; // 合并机制产物，JS 库不需要
      const { ensureSeq } = await import('../store/db.js');
      ensureSeq(db);
      localStorage.setItem('personal_erp_db_v1', JSON.stringify(db));
      localStorage.setItem(REV_KEY, String(Math.max(nativeRev, known)));
      return { changed: true };
    } catch (e) { return { changed: false }; }
  },

  /**
   * 原生待回读流水：不依赖 rev / db 覆盖，取走即清空，按 id 去重合并进本地库。
   * 桌面记账、快速消费、充值都走这条通道，保证一定进流水。
   */
  async pullPending() {
    if (!this.nativeAvailable()) return { changed: false, added: 0 };
    try {
      const P = Capacitor.registerPlugin('Widget');
      const r = await P.getPendingTxs();
      const list = JSON.parse(r.txs || '[]');
      if (!Array.isArray(list) || !list.length) return { changed: false, added: 0 };
      const raw = localStorage.getItem('personal_erp_db_v1');
      if (!raw) return { changed: false, added: 0 };
      const db = JSON.parse(raw);
      db.txs = db.txs || [];
      const have = new Set(db.txs.map((t) => t && t.id));
      let added = 0;
      let maxSeq = (db.seq && db.seq.t) || 0;
      for (const t of list) {
        if (!t || !t.id || have.has(t.id)) continue;
        db.txs.push(t);
        have.add(t.id);
        added++;
        const n = parseInt(String(t.id).replace(/\D/g, ''), 10) || 0;
        if (n > maxSeq) maxSeq = n;
      }
      if (!added) return { changed: false, added: 0 };
      db.seq = db.seq || {};
      db.seq.t = maxSeq;
      localStorage.setItem('personal_erp_db_v1', JSON.stringify(db));
      return { changed: true, added };
    } catch (e) { return { changed: false, added: 0 }; }
  },

  async refreshNative() {
    try {
      // 不设 enabled 门槛：桌面可能直接添加小组件而没进 App 设置开启；
      // 只要原生平台 + 应用每次渲染就推送，保证「核心 → 小组件」即时同步。
      if (!Capacitor.isNativePlatform()) return;
      const P = Capacitor.registerPlugin('Widget');
      // 数据桥接：Capacitor 8 不再自动同步 localStorage → 主动把 db + prefs 推给原生，
      // 原生写入 SharedPreferences("CapacitorStorage") 并刷新小组件。
      await P.pushData({
        db: localStorage.getItem('personal_erp_db_v1') || '',
        prefs: localStorage.getItem('personal_erp_prefs') || '',
      });
    } catch (e) {}
  },
};

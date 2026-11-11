import { Capacitor } from '@capacitor/core';
import { Prefs } from '../store/prefs.js';

const SNAPSHOT_KEY = 'widget_snapshot';
const REV_KEY = 'widget_native_rev';

export const Widget = {
  key: SNAPSHOT_KEY,

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

// ============================================================
// services/lockScreen.js
// 锁屏 / 开屏：常驻通知（锁屏可见）+ 亮屏整页（fullScreenIntent）。
// 偏好写入 Prefs（随 pushData 一起推给原生），原生侧据此发/撤通知。
// 仅 Android App 内生效；web / 桌面静默跳过。
// ============================================================
import { Capacitor } from '@capacitor/core';
import { Prefs } from '../store/prefs.js';

export const LockScreen = {
  nativeAvailable() {
    try { return Capacitor.isNativePlatform(); } catch (e) { return false; }
  },

  enabled() { return !!Prefs.load().lockScreenToday; },

  full() { return Prefs.load().lockScreenFull !== false; },

  /** 写入开关并立即生效；返回原生结果 {enabled, full} 或 {ok:false} */
  async set({ enabled, full } = {}) {
    const patch = {};
    if (enabled !== undefined) patch.lockScreenToday = !!enabled;
    if (full !== undefined) patch.lockScreenFull = !!full;
    Prefs.set(patch);
    if (!this.nativeAvailable()) return { ok: false, error: '仅安卓 App 内支持' };
    try {
      const P = Capacitor.registerPlugin('LockScreen');
      return await P.setEnabled({ enabled: this.enabled(), full: this.full() });
    } catch (e) {
      return { ok: false, error: e.message || '设置失败' };
    }
  },

  /** 立即发一条带全屏意图的通知（设置页预览用） */
  async preview() {
    if (!this.nativeAvailable()) return { ok: false, error: '仅安卓 App 内支持' };
    try {
      return await Capacitor.registerPlugin('LockScreen').preview();
    } catch (e) {
      return { ok: false, error: e.message || '预览失败' };
    }
  },

  /** 查询原生状态：{enabled, full, canFullScreen} */
  async state() {
    if (!this.nativeAvailable()) return { enabled: this.enabled(), full: this.full(), canFullScreen: false };
    try {
      return await Capacitor.registerPlugin('LockScreen').getState();
    } catch (e) {
      return { enabled: this.enabled(), full: this.full(), canFullScreen: false };
    }
  },
};

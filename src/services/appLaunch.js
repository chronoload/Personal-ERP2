// services/appLaunch.js
// 系统跳转桥（原生 AppLaunch 插件）的 JS 封装：
//   · list()       列出设备上所有可从桌面启动的应用（设置页挑选跳转目标）
//   · openTarget() 打开用户选中的应用；未选择时返回 ok:false，由调用方退回分享面板
// 选择结果存在 Prefs.launchAppPackage，空字符串 = 不直启。
import { Capacitor } from '@capacitor/core';
import { Prefs } from '../store/prefs.js';

export const AppLaunch = {
  nativeAvailable() { return Capacitor.isNativePlatform(); },

  pkg() { return Prefs.load().launchAppPackage || ''; },

  setPkg(pkg) { Prefs.set({ launchAppPackage: pkg || '' }); },

  async list() {
    if (!this.nativeAvailable()) return [];
    try {
      const P = Capacitor.registerPlugin('AppLaunch');
      const r = await P.listApps();
      return Array.isArray(r && r.apps) ? r.apps : [];
    } catch (e) { return []; }
  },

  async openTarget() {
    const pkg = this.pkg();
    if (!this.nativeAvailable() || !pkg) return { ok: false, error: 'unset' };
    try {
      const P = Capacitor.registerPlugin('AppLaunch');
      return await P.open({ package: pkg });
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  },
};

// services/appLaunch.js
// 系统跳转桥（原生 AppLaunch 插件）的 JS 封装：
//   · list()   列出手机里已安装的 AI 助手（用于设置页选择）
//   · openAi() 打开用户选中的 AI 助手（未选则用原生默认顺序）
// 设置项存在 Prefs.aiAppPackage，空字符串 = 不直启、退回系统分享面板。
import { Capacitor } from '@capacitor/core';
import { Prefs } from '../store/prefs.js';

export const AppLaunch = {
  nativeAvailable() { return Capacitor.isNativePlatform(); },

  pkg() { return Prefs.load().aiAppPackage || ''; },

  setPkg(pkg) { Prefs.set({ aiAppPackage: pkg || '' }); },

  async list() {
    if (!this.nativeAvailable()) return [];
    try {
      const P = Capacitor.registerPlugin('AppLaunch');
      const r = await P.listAiApps();
      return Array.isArray(r && r.apps) ? r.apps : [];
    } catch (e) { return []; }
  },

  async openAi() {
    if (!this.nativeAvailable()) return { ok: false, error: 'web' };
    try {
      const P = Capacitor.registerPlugin('AppLaunch');
      return await P.openAi({ package: this.pkg() });
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  },
};

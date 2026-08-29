// ============================================================
// services/system.js
// 系统提示 / 系统能力接口：
//   confirm/alert  原生 Dialog 插件（web 回退 window.confirm/alert）
//   vibrate        原生 Haptics（web 回退 navigator.vibrate）
//   keepAwake      标准 Web Wake Lock API（WebView 原生支持，无需插件）
//   onResume       App 回前台回调（@capacitor/app）
// 业务代码只依赖本模块，便于替换实现与预留新能力。
// ============================================================
import { Capacitor } from '@capacitor/core';
import { Dialog } from '@capacitor/dialog';
import { Haptics } from '@capacitor/haptics';
import { App } from '@capacitor/app';

const NATIVE = () => Capacitor.isNativePlatform();
let wakeLock = null;

export const System = {
  isNative: NATIVE,

  // 系统确认框 → Promise<boolean>
  async confirm({ title = '', message }) {
    if (NATIVE()) {
      try {
        const r = await Dialog.confirm({ title, message });
        return r.value;
      } catch (e) {}
    }
    return window.confirm(message);
  },

  // 系统提示框
  async alert({ title = '', message }) {
    if (NATIVE()) {
      try { await Dialog.alert({ title, message }); return; } catch (e) {}
    }
    window.alert(message);
  },

  // 震动反馈（完成/错误等）
  async vibrate(ms = 60) {
    if (NATIVE()) {
      try { await Haptics.vibrate({ duration: ms }); return; } catch (e) {}
    }
    if ('vibrate' in navigator) { try { navigator.vibrate(ms); } catch (e) {} }
  },

  // 成功提示音（原生）
  async success() {
    if (NATIVE()) { try { await Haptics.notification({ type: 'SUCCESS' }); } catch (e) {} }
  },

  // 屏幕常亮（计时器期间防熄屏）
  async keepAwake(on) {
    if (on) {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = wakeLock || await navigator.wakeLock.request('screen');
        }
      } catch (e) {}
    } else if (wakeLock) {
      try { await wakeLock.release(); } catch (e) {}
      wakeLock = null;
    }
  },

  // App 回到前台回调（native 精确；web 用 visibilitychange 近似）
  onResume(cb) {
    if (NATIVE()) {
      App.addListener('appStateChange', ({ isActive }) => { if (isActive) cb(); });
    } else {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) cb(); });
    }
  },
};

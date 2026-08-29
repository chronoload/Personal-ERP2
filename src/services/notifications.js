// ============================================================
// services/notifications.js
// 系统通知接口（预留/已实现双层）：
//   native：@capacitor/local-notifications（Android 系统通知，后台/锁屏/杀进程仍触发）
//   web   ：Web Notification API → 失败回退应用内 toast
// 业务代码只依赖本模块，不直接 import 插件，便于替换实现。
// ============================================================
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { toast } from '../ui/helpers.js';

const NATIVE = () => Capacitor.isNativePlatform();
let receivedHandler = null;

export const Notifications = {
  isNative: NATIVE,

  // 请求系统通知权限
  async requestPermission() {
    if (NATIVE()) {
      try { await LocalNotifications.requestPermissions(); } catch (e) {}
      return;
    }
    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (e) {}
    }
  },

  // 调度一条系统通知。at 为 Date；省略则立即发出。
  async schedule({ id, title, body, at }) {
    if (NATIVE()) {
      try {
        await LocalNotifications.schedule({
          notifications: [{ id, title, body, schedule: at ? { at } : undefined }],
        });
      } catch (e) { /* 权限被拒则静默 */ }
      return;
    }
    // Web 无法定时调度未来通知：静默跳过（避免调度器在 web 上每次渲染弹 toast）
    if (at && at.getTime() > Date.now()) return;
    // Web 立即通知：Notification API → 失败回退应用内提示
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body }); return; } catch (e) {}
    }
    toast(`${title} · ${body}`);
  },

  // 取消一条已调度的通知
  async cancel(id) {
    if (NATIVE()) {
      try { await LocalNotifications.cancel({ notifications: [{ id }] }); } catch (e) {}
    }
  },

  // 注册通知触发回调（native：通知到达；web：暂无）
  onReceived(cb) {
    if (NATIVE()) {
      LocalNotifications.addListener('localNotificationReceived', (n) => cb && cb(n));
    }
    receivedHandler = cb;
  },
};

export function __notifyFallback(title, body) {
  if (receivedHandler) receivedHandler({ title, body });
}

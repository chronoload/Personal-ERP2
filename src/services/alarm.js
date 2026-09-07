// ============================================================
// services/alarm.js
// 闹钟服务：全方位嵌入 Android 系统通知/闹钟生态。
//  - 日程提醒：为 Planned 活动的 planned_start 调度系统闹钟（后台/被杀/锁屏也响铃）；
//  - 番茄钟兑底：计时结束 App 被杀也能响（由 timer.js 单独调度）；
//  - 到点行为（原生 AlarmReceiver）：循环闹铃 + 震动 + 锁屏全屏提醒(fullScreenIntent)
//    + 高优常驻通知（「停止响铃」按钮；点通知回 App → alarmAction → alarmOpened）。
//  - 幂等：diff 式同步（新出现→调度；消失/过期→取消），不重复弹。
//  - web 平台：无原生插件 → 全部静默降级（不打扰），靠前端 tick/通知兜底。
// ============================================================
import { Capacitor } from '@capacitor/core';
import { toast } from '../ui/helpers.js';

const TRACK_KEY = 'scheduled_alarms';
const HORIZON_MS = 7 * 86400000;   // 只调度未来 7 天内（App 周期性打开会重新同步）
const SCHED_BASE = 3000;           // 日程提醒 alarm id 基数（与 valueflow 2000 / 周月报 4000 错开）
export const TIMER_ALARM_ID = 1001; // 番茄钟闹钟 id（AlarmManager 命名空间，与 LocalNotifications 的 1001 互不相干）

function alarmPlugin() {
  if (!Capacitor.isNativePlatform()) return null;
  try { return Capacitor.registerPlugin('Alarm'); } catch (e) { return null; }
}

function loadTracked() {
  try { return JSON.parse(localStorage.getItem(TRACK_KEY) || '{}'); } catch (e) { return {}; }
}
function saveTracked(t) {
  try { localStorage.setItem(TRACK_KEY, JSON.stringify(t)); } catch (e) {}
}

// 'YYYY-M-DTHH:MM' → epoch ms；无法解析返回 null
export function parsePlannedStart(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:T(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4] || 0, +m[5] || 0, 0, 0);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

// 纯函数：计算「期望的闹钟集合」（可 node 测试）。
// 覆盖：未来 HORIZON 内、状态仍为 Planned、有计划时间（planned_start）的活动。
export function desiredSchedule(db, now = Date.now()) {
  const out = {};
  for (const a of db.activities || []) {
    if (a.status !== 'Planned') continue;
    const at = parsePlannedStart(a.planned_start);
    if (at == null || at <= now || at > now + HORIZON_MS) continue;
    const num = parseInt(String(a.id || '').replace(/\D/g, ''), 10) || 0;
    const aid = SCHED_BASE + num;
    out[String(aid)] = { id: aid, title: `⏰ ${a.title || '活动'}`, body: '计划时间到了，开始专注吧', at };
  }
  return out;
}

// diff 式同步：新出现 → scheduleAlarm；消失/过期/状态变更 → cancelAlarm
export function syncAlarms(db) {
  const P = alarmPlugin();
  if (!P) return { scheduled: 0, canceled: 0 };
  const tracked = loadTracked();
  const desired = desiredSchedule(db);
  let scheduled = 0, canceled = 0;
  for (const key of Object.keys(desired)) {
    if (key in tracked) continue;
    const d = desired[key];
    P.scheduleAlarm({ id: d.id, title: d.title, body: d.body, at: d.at }).catch(() => {});
    tracked[key] = true;
    scheduled++;
  }
  for (const key of Object.keys(tracked)) {
    if (!(key in desired)) {
      P.cancelAlarm({ id: Number(key) }).catch(() => {});
      delete tracked[key];
      canceled++;
    }
  }
  saveTracked(tracked);
  return { scheduled, canceled };
}

// ---- 番茄钟兑底：App 被杀/后台也能响铃 ----
export function scheduleTimerAlarm(atMs, title = '⏱ 计时结束') {
  const P = alarmPlugin();
  if (!P) return;
  P.scheduleAlarm({ id: TIMER_ALARM_ID, title, body: '时间到！回来记录这次活动吧', at: atMs }).catch(() => {});
}
export function cancelTimerAlarm() {
  const P = alarmPlugin();
  if (!P) return;
  P.cancelAlarm({ id: TIMER_ALARM_ID }).catch(() => {});
}
export function stopAlarm() {
  const P = alarmPlugin();
  if (!P) return;
  P.stopAlarm().catch(() => {});
}

// 全屏通知点击回 App → 停铃 + 转发 alarmOpened（timer 等模块监听处理）
if (typeof window !== 'undefined') {
  window.addEventListener('alarmAction', (e) => {
    const d = (e && e.detail) || {};
    stopAlarm();
    if (d.action === 'open') {
      toast('⏰ 到点提醒：回到 App 处理吧', 'warn');
      window.dispatchEvent(new CustomEvent('alarmOpened', { detail: d }));
    }
  });
}

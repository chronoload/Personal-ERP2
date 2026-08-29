// ============================================================
// services/scheduler.js
// 系统调度器：
//   syncValueflowNotifs —— 为「待反馈价值流」在期望日期调度一条系统通知（决策 16C）。
//   syncAutoBackup     —— 定时自动备份：按 Prefs.autoBackupEvery（小时）周期静默本地备份。
// 幂等：已调度的在 localStorage 登记，关闭/移除即取消，不重复弹。
// ============================================================
import { Notifications } from './notifications.js';
import { Prefs } from '../store/prefs.js';
import { Backup } from './backup.js';

const TRACK_KEY = 'scheduled_vf_notifs';
const NOTIF_BASE = 2000;

function loadTracked() {
  try { return JSON.parse(localStorage.getItem(TRACK_KEY) || '{}'); } catch (e) { return {}; }
}
function saveTracked(t) {
  try { localStorage.setItem(TRACK_KEY, JSON.stringify(t)); } catch (e) {}
}

// 价值流 id → 稳定数字通知 id（local-notifications 需要 Int）
function vfNotifId(vfId) {
  return NOTIF_BASE + (parseInt(String(vfId).replace(/\D/g, ''), 10) || 0);
}

// 下一次 weekday（0=周日）hour:00 的时刻；今天已过则顺延一周
function nextWeekdayAt(weekday, hour) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  let diff = (weekday - d.getDay() + 7) % 7;
  if (diff === 0 && d.getTime() <= Date.now()) diff = 7;
  d.setDate(d.getDate() + diff);
  return d.getTime();
}
// 下一次「某月最后一天 hour:00」：本月最后一天已过则取下月
function nextMonthEndAt(hour) {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0, hour, 0, 0);
  return last.getTime() > Date.now()
    ? last.getTime()
    : new Date(now.getFullYear(), now.getMonth() + 2, 0, hour, 0, 0).getTime();
}

export const Scheduler = {
  // 每次 App 渲染后调用，维护「待反馈价值流」的系统通知
  syncValueflowNotifs(db) {
    const tracked = loadTracked();
    const desired = {}; // notifId(string) -> vfId
    const now = Date.now();
    for (const v of db.valueflows) {
      if (v.status === 'Closed') continue;      // 已闭环，无需提醒
      if (v.expected <= now) continue;           // 已逾期（派生状态），不再提醒
      const nid = String(vfNotifId(v.id));
      desired[nid] = v.id;
    }
    // 新出现 → 调度
    for (const nid of Object.keys(desired)) {
      if (nid in tracked) continue;
      const vf = db.valueflows.find((x) => x.id === desired[nid]);
      const out = db.outputs.find((o) => o.id === vf.output_id);
      Notifications.schedule({
        id: Number(nid),
        title: '价值流待反馈',
        body: `产出「${(out && out.title) || vf.output_id}」待反馈，记得回 App 闭环`,
        at: new Date(vf.expected),
      });
      tracked[nid] = desired[nid];
    }
    // 已移除/已闭环 → 取消
    for (const nid of Object.keys(tracked)) {
      if (!(nid in desired)) {
        Notifications.cancel(Number(nid));
        delete tracked[nid];
      }
    }
    saveTracked(tracked);
  },

  // 定时自动备份：到点则静默本地备份一次（native 写 Documents/backups；web 存 localStorage 历史）
  async syncAutoBackup(db) {
    const p = Prefs.load();
    if (!p.autoBackup) return;
    const every = Number(p.autoBackupEvery) || 24; // 小时
    const last = Number(p.lastAutoBackup) || 0;
    if (Date.now() - last < every * 3600 * 1000) return;
    await Backup.exportLocal(db); // 成功时内部更新 lastAutoBackup；失败则下次渲染再试
  },

  // 周/月报通知提醒：每周日 20:00 提醒周报，每月最后一天 20:00 提醒月报。
  // 幂等 tracked-diff：目标时刻变了才重排；Prefs.reportRemind=false 则取消并清登记。
  syncPeriodicReportReminders() {
    const TRACK = 'scheduled_report_remind';
    const REMIND_BASE = 4000; // 4000=周报, 4001=月报（与价值流 2000 / 提醒 3000 错开）
    let tracked = {};
    try { tracked = JSON.parse(localStorage.getItem(TRACK) || '{}'); } catch (e) {}
    const cancel = (key) => {
      if (!(key in tracked)) return;
      Notifications.cancel(Number(key));
      delete tracked[key];
    };
    const schedule = (key, atMs, title, body) => {
      if (tracked[key] === atMs) return;
      if (tracked[key]) Notifications.cancel(Number(key));
      Notifications.schedule({ id: Number(key), title, body, at: new Date(atMs) });
      tracked[key] = atMs;
    };
    if (Prefs.load().reportRemind === false) {
      cancel(String(REMIND_BASE));
      cancel(String(REMIND_BASE + 1));
    } else {
      schedule(String(REMIND_BASE), nextWeekdayAt(0, 20), '📊 本周周报', '本周周报已出炉，去「统计」页查看吧');
      schedule(String(REMIND_BASE + 1), nextMonthEndAt(20), '📊 本月月报', '本月月报已出炉，去「统计」页查看吧');
    }
    try { localStorage.setItem(TRACK, JSON.stringify(tracked)); } catch (e) {}
  },
};

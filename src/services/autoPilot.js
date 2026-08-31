// ============================================================
// services/autoPilot.js
// 自动驾驶（F1-F4）：
//   F1 到点询问 —— 活动到计划开始时间时，底部非阻塞确认条问「开始/忽略」（当天忽略过不再打扰）；
//                  多条同时到期则聚合为一个弹窗逐条处理。开始走 App.startAct（冲突仲裁由其接管）。
//   F2 提前提醒 —— 开始前 remindBeforeMin 分钟调度一条系统通知；
//                  幂等 tracked-diff（同 scheduler.syncValueflowNotifs）：窗口过期/已开始/已删除即取消。
//   F3+F4 收尾/超时 —— 合并为单条提示条：「该收尾了」优先，「已超计划 N 分钟」次之，每次只展示第一条。
// 纪律：计时全屏（.timer-overlay）期间整体静默；确认条/提示条均单实例复用绝不堆叠；不抢焦点。
// ============================================================
import { openModal, toast, esc } from '../ui/helpers.js';
import { System } from './system.js';
import { Notifications } from './notifications.js';
import { Prefs } from '../store/prefs.js';
import { scanDueEvents } from '../domain/schedule.js';
import { extractFeatures } from '../domain/learn.js';
import { recommendNext } from '../domain/recommend.js';

const DISMISS_KEY = 'autopilot_dismissed_v1'; // 当天已忽略：actId -> 'YYYY-M-D'
const TRACK_KEY = 'autopilot_notifs_v1';      // 已调度通知登记：nid(string) -> actId
const REC_WEEK_KEY = 'autopilot_rec_week_v1'; // 每周推荐计数：{ week, count }（勿扰：每周上限）
const NOTIF_BASE = 3000;                      // 与 scheduler 的 2000 段错开，避免撞通知 id
const TICK_MS = 30000;                        // 常驻巡检周期
const FIRST_TICK_DELAY = 1500;                // 启动后首次巡检延迟

let started = false;
const skippedToasted = new Set(); // `${actId}:${dateKey}` 每活动每天至多 toast 一次

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function hhmm(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { return {}; }
}
function saveJSON(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {}
}
// 活动 id → 稳定数字通知 id（local-notifications 需要 Int，同 scheduler 手法）
function actNotifId(actId) {
  return NOTIF_BASE + (parseInt(String(actId).replace(/\D/g, ''), 10) || 0);
}

// 底部非阻塞条（确认条/提示条共用骨架）：固定定位、z-index 低于弹窗(60)、不抢焦点
function ensureBar(id, above) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.style.cssText = [
      'position:fixed', 'left:50%', 'transform:translateX(-50%)',
      `bottom:${above ? 84 : 20}px`, 'z-index:50',
      'display:flex', 'align-items:center', 'gap:10px',
      'padding:10px 14px', 'border-radius:12px',
      'background:#1d2330', 'color:#fff',
      'box-shadow:0 6px 24px rgba(0,0,0,.25)', 'max-width:min(92vw,560px)',
    ].join(';');
    document.body.appendChild(el);
  }
  return el;
}

export const AutoPilot = {
  // 模块级防重入：重复调用不再叠加定时器/回调
  start(App) {
    if (started) return;
    started = true;
    System.onResume(() => this._tick(App));            // 回前台立即巡检一次
    setInterval(() => this._tick(App), TICK_MS);       // 常驻周期巡检
    setTimeout(() => this._tick(App), FIRST_TICK_DELAY); // 启动后稍作延迟的首次巡检
  },

  _tick(App) {
    try {
      if (!App || !App.db) return;
      if (document.querySelector('.timer-overlay')) return; // 计时全屏进行中，不打扰
      const scan = scanDueEvents(App.db, Date.now(), { remindBeforeMin: Prefs.load().remindBeforeMin ?? 15 });
      this._syncPreRemind(scan.preRemind);         // F2 提前提醒（幂等 tracked-diff）
      this._toastSkipped(scan.skipped);            // 到点被跳过：每活动每天至多提示一次
      this._renderConfirmBar(App, scan.dueStarts); // F1 到点询问
      this._renderTipBar(App, scan);               // F3+F4 收尾/超时提醒
      this._renderRecBar(App);                     // F6 智能推荐（L3）：无到点/收尾打扰时提「下一步做什么」
      this._autoFail(App, scan);                   // F5 自动失败：超时超宽限期仍未完成 → failActivity
    } catch (e) { /* 单轮巡检失败静默，下个周期自然重试 */ }
  },

  // F2：期望集合 vs 已登记集合的差分维护（新增→调度；消失→取消）
  _syncPreRemind(preRemind) {
    const tracked = loadJSON(TRACK_KEY);
    const desired = {}; // nid(string) -> actId
    for (const p of preRemind || []) desired[String(actNotifId(p.id))] = p.id;
    for (const nid of Object.keys(desired)) {
      if (nid in tracked) continue;
      const item = (preRemind || []).find((x) => String(actNotifId(x.id)) === nid);
      if (!item) continue;
      Notifications.schedule({
        id: Number(nid),
        title: '活动即将开始',
        body: `「${item.title}」 将于 ${hhmm(item.atMs)} 开始`,
        at: new Date(item.atMs),
      });
      tracked[nid] = desired[nid];
    }
    for (const nid of Object.keys(tracked)) {
      if (!(nid in desired)) {
        Notifications.cancel(Number(nid));
        delete tracked[nid];
      }
    }
    saveJSON(TRACK_KEY, tracked);
  },

  // 到点但被引擎拒绝开始的：说明原因，每天每活动只说一次
  _toastSkipped(skipped) {
    const dk = todayKey();
    for (const s of skipped || []) {
      const key = `${s.id}:${dk}`;
      if (skippedToasted.has(key)) continue;
      skippedToasted.add(key);
      toast(s.reason === 'budget'
        ? `「${s.title}」关联计划预算耗尽，禁止开始`
        : `「${s.title}」与捆绑对手时间冲突，到点未自动开始`, 'err');
    }
  },

  _recordDismiss(actId) {
    const m = loadJSON(DISMISS_KEY);
    m[String(actId)] = todayKey();
    saveJSON(DISMISS_KEY, m);
  },

  // F1：单条 → 底部确认条；多条 → 聚合弹窗。复用同一元素，绝不堆叠。
  _renderConfirmBar(App, dueStarts) {
    const items = (dueStarts || []).filter((x) => !this._isDismissed(x.id));
    let el = document.getElementById('ap-confirm-bar');
    if (!items.length) { if (el) el.remove(); return; }
    el = ensureBar('ap-confirm-bar', false);

    if (items.length === 1) {
      const it = items[0];
      el.innerHTML =
        `<span style="flex:1">⏰ 「${esc(it.title)}」 已到计划时间</span>` +
        `<button class="btn sm primary" data-ap-start>开始</button>` +
        `<button class="btn sm" data-ap-skip>忽略</button>`;
      const bStart = el.querySelector('[data-ap-start]');
      const bSkip = el.querySelector('[data-ap-skip]');
      if (bStart) bStart.onclick = () => { if (el) el.remove(); App.startAct(it.id); };
      if (bSkip) bSkip.onclick = () => {
        this._recordDismiss(it.id);
        if (el) el.remove();
      };
      return;
    }

    // 多条同时到期：有弹窗在前台时不抢；否则撤下底条、聚合为一个弹窗逐条处理
    if (el) el.remove();
    if (document.querySelector('.modal-mask')) return;
    const rows = items.map((it) =>
      `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line,#e5e7eb)">` +
      `<span style="flex:1">⏰ 「${esc(it.title)}」</span>` +
      `<button class="btn sm primary" data-ap-mstart="${esc(String(it.id))}">开始</button>` +
      `<button class="btn sm" data-ap-mskip="${esc(String(it.id))}">忽略</button>` +
      `</div>`).join('');
    const m = openModal({
      title: '⏰ 到点活动',
      bodyHTML: rows,
      footerHTML: `<button class="btn" data-cancel>关闭</button>`,
    });
    // 关闭聚合弹窗（取消/✕/Esc/点遮罩）= 今天全部忽略：否则下个 tick 条件不变，弹窗每 30s 重开成死循环
    const dismissAll = () => { for (const it of items) this._recordDismiss(it.id); };
    const bCancel = m.q('[data-cancel]');
    if (bCancel) bCancel.onclick = () => { dismissAll(); m.close(); };
    const xClose = m.q('[data-close]');
    if (xClose) xClose.addEventListener('click', dismissAll);
    m.el.addEventListener('click', dismissAll);
    m.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismissAll(); });
    m.qa('[data-ap-mstart]').forEach((b) => {
      b.onclick = () => { m.close(); App.startAct(b.getAttribute('data-ap-mstart')); };
    });
    m.qa('[data-ap-mskip]').forEach((b) => {
      b.onclick = () => {
        this._recordDismiss(b.getAttribute('data-ap-mskip'));
        b.disabled = true;
      };
    });
  },

  _isDismissed(actId) {
    return loadJSON(DISMISS_KEY)[String(actId)] === todayKey();
  },

  // F5 自动失败（接入引擎 failActivity，修复「超时未完成却不失败」）：
  // Started 且超出 计划时长+宽限期(failGraceMin) 仍未完成 → failActivity。
  // 循环 → 衍生下一期；非循环 → re-init 回 Planned（可立即重试）。幂等：失败后不再 Started。
  _autoFail(App, scan) {
    const grace = Number(Prefs.load().failGraceMin) || 30;
    for (const o of (scan.overtime || [])) {
      if (Number(o.overMin) > grace) {
        App.engine.failActivity(App.db, o.id, `超时自动失败（超出计划 ${o.overMin} 分钟）`);
      }
    }
  },

  // F3+F4：单实例提示条，ended 优先于 overtime，每次只展示第一条，余下的后续 tick 接力
  _renderTipBar(App, scan) {
    const ended = (scan.ended || [])[0];
    const over = (scan.overtime || [])[0];
    let el = document.getElementById('ap-tip-bar');
    if (!ended && !over) { if (el) el.remove(); return; }
    el = ensureBar('ap-tip-bar', true); // 与确认条同屏时位于其上方

    if (ended) {
      el.innerHTML =
        `<span style="flex:1">该收尾了：「${esc(ended.title)}」</span>` +
        `<button class="btn sm primary" data-ap-done>去完成</button>` +
        `<button class="btn sm" data-ap-defer>顺延</button>`;
      const bDone = el.querySelector('[data-ap-done]');
      const bDefer = el.querySelector('[data-ap-defer]');
      if (bDone) bDone.onclick = () => { if (el) el.remove(); App.overview.openCompleteModal(ended.id); };
      if (bDefer) bDefer.onclick = () => {
        const r = App.engine.rescheduleStarted(App.db, ended.id);
        if (r && r.ok) {
          toast(`⏩ 已顺延至 ${(r.moved_to || '').replace('T', ' ')}`, 'ok');
          App.refresh();
        } else {
          toast((r && r.error) || '顺延失败', 'err');
        }
        if (el) el.remove(); // 下个 tick 重估；若仍未收尾会重新出现
      };
      return;
    }

    el.innerHTML =
      `<span style="flex:1">「${esc(over.title)}」已超计划 ${Number(over.overMin) || 0} 分钟</span>` +
      `<button class="btn sm primary" data-ap-done>去完成</button>`;
    const bDone = el.querySelector('[data-ap-done]');
    if (bDone) bDone.onclick = () => { if (el) el.remove(); App.overview.openCompleteModal(over.id); };
  },

  // ---- F6 智能推荐（L3，User 定调「适时弹、可关掉、不招人烦」）----
  // 时机：无到点确认条/收尾条/计时全屏/弹窗打扰时，用 L3 recommendNext 提「下一步做什么」。
  // 频率：每天每活动至多一次；每周总计 ≤ recommendPerWeek（勿扰超限静默）。
  // 关闭：推荐条「×」记当天忽略；「智能推荐」开关（smartRecommend=false）彻底停用。
  _renderRecBar(App) {
    const prefs = Prefs.load();
    if (prefs.smartRecommend === false) return; // 彻底停用
    // 已有时机打扰则本次不推荐（确认条/收尾条/计时/弹窗优先，绝不堆叠）
    if (document.getElementById('ap-confirm-bar')) return;
    if (document.getElementById('ap-tip-bar')) return;
    if (document.querySelector('.timer-overlay')) return;
    if (document.querySelector('.modal-mask')) return;
    if (this._recQuotaUsed()) return; // 本周上限已到 → 静默
    const el = document.getElementById('ap-rec-bar');
    if (el) { el.remove(); } // 先清旧条（单实例），再按最新状态重建

    const rec = this._nextRecommend(App);
    if (!rec) return;
    if (this._isDismissed(rec.id)) return; // 今天已忽略该活动 → 不再提
    const bar = ensureBar('ap-rec-bar', false);
    const reason = rec.reasons?.[0] ? ` · ${rec.reasons[0]}` : '';
    bar.innerHTML =
      `<span style="flex:1">💡 下一步：「${esc(rec.title)}」<span class="muted" style="color:#9aa7c0">${esc(reason)}</span></span>` +
      `<button class="btn sm primary" data-ap-rec-start>开始</button>` +
      `<button class="btn sm" data-ap-rec-skip>忽略</button>` +
      `<button class="btn sm" data-ap-rec-x title="今天不再提醒">×</button>`;
    const bStart = bar.querySelector('[data-ap-rec-start]');
    const bSkip = bar.querySelector('[data-ap-rec-skip]');
    const bX = bar.querySelector('[data-ap-rec-x]');
    if (bStart) bStart.onclick = () => { if (bar) bar.remove(); this._bumpRecQuota(); App.startAct(rec.id); };
    if (bSkip) bSkip.onclick = () => { this._recordDismiss(rec.id); if (bar) bar.remove(); };
    if (bX) bX.onclick = () => { this._recordDismiss(rec.id); if (bar) bar.remove(); };
    this._bumpRecQuota();
  },

  // L3 推荐取第一条（复用契约 §3.4 的候选映射，同步域调用；无候选/无推荐返回 null）
  _nextRecommend(App) {
    const db = App.db;
    const feats = extractFeatures(db);
    const acts = (db.activities || []).filter((a) => a.status === 'Planned' || a.status === 'Started');
    if (!acts.length) return null;
    const plans = db.plans || [];
    const candidates = acts.map((a) => {
      const plan = plans.find((x) => x.id === (a.plan_ids?.[0] ?? null));
      const bias = feats.biasModel.find((e) => e.planId === (a.plan_ids?.[0] ?? null));
      return {
        activityId: a.id,
        planId: a.plan_ids?.[0] ?? null,
        plannedStart: a.planned_start ?? null,
        deadline: plan?.deadline ?? null,
        plannedMinutes: a.planned_minutes || 0,
        n: bias?.n ?? 0,
        conflictsCount: Array.isArray(a.conflicts) ? a.conflicts.length : 0,
      };
    });
    const top = recommendNext(candidates, feats, { now: Date.now(), limit: 1, k: 1 });
    const hit = top[0];
    if (!hit) return null;
    return { id: hit.activityId, title: (db.activities.find((x) => x.id === hit.activityId) || {}).title || '', reasons: hit.reasons };
  },

  // 每周推荐计数（勿扰上限）：跨周自动归零；达上限返回 true
  _recQuotaUsed() {
    const cap = Number(Prefs.load().recommendPerWeek) || 3;
    const cur = loadJSON(REC_WEEK_KEY);
    const week = this._weekOf(Date.now());
    if (cur.week !== week) return false; // 跨周 → 未达上限
    return (cur.count || 0) >= cap;
  },
  _bumpRecQuota() {
    const cap = Number(Prefs.load().recommendPerWeek) || 3;
    const cur = loadJSON(REC_WEEK_KEY);
    const week = this._weekOf(Date.now());
    if (cur.week !== week) { saveJSON(REC_WEEK_KEY, { week, count: 1 }); return; }
    saveJSON(REC_WEEK_KEY, { week, count: Math.min(cap, (cur.count || 0) + 1) });
  },
  _weekOf(ms) {
    const d = new Date(ms);
    // ISO 周序号（周一为一周起点）
    const t = new Date(d.getFullYear(), 0, 1);
    const dayOffset = ((d - t) / 86400000 + t.getDay() - 1 + 7) % 7;
    return d.getFullYear() * 100 + Math.ceil(((d - t) / 86400000 + 1 - dayOffset) / 7);
  },
};

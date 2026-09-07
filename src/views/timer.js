// ============================================================
// views/timer.js
// TikTok 风格全屏沉浸式倒计时 —— 后台安全版
// 实现要点：
//  1) 时间戳锚定：剩余时间 = endTs − now，不依赖 setInterval 精度。
//     浏览器/WebView 后台节流或暂停后，回到前台自动校正。
//  2) 原生本地通知：开始计时即在结束时刻调度通知（Android 系统级），
//     即使 App 被杀/锁屏也会在正确时刻提醒；点击/收到通知回前台即进入完成态。
//  3) 结束经领域引擎闭环入账（createActivity → startActivity → quickComplete）。
// ============================================================
import { Capacitor } from '@capacitor/core';
import { Notifications } from '../services/notifications.js';
import { System } from '../services/system.js';
import { toast } from '../ui/helpers.js';
import { scheduleTimerAlarm, cancelTimerAlarm, stopAlarm, TIMER_ALARM_ID } from '../services/alarm.js';

const PRESETS = [5, 15, 25, 45, 60];
const NOTIF_ID = 1001;
const NATIVE = () => Notifications.isNative();
const TKEY = 'personal_erp_timer';

// ---- 计时状态持久化：时间戳锚定，App 被杀后重启可按 now 相对恢复 ----
// 双写：localStorage（快路径）+ 原生 SharedPreferences（抗 WebView 数据清理，
// 澎湃等 ROM 的深度清理 / System WebView 升级都可能清掉 localStorage）
function nativeTimerPlugin() {
  try {
    if (!Capacitor.isNativePlatform()) return null;
    return Capacitor.registerPlugin('Widget');
  } catch (e) { return null; }
}
// 原生控制栏插件（常驻通知按钮 + 铃声）；未在原生平台则返回 null（web 静默降级）
function nativeControls() {
  try {
    if (!Capacitor.isNativePlatform()) return null;
    return Capacitor.registerPlugin('Timer');
  } catch (e) { return null; }
}
// 把当前会话状态同步到控制栏常驻通知：运行/暂停中 → 显示；空闲/完成 → 隐藏
function syncControls() {
  const P = nativeControls();
  if (!P) return;
  const a = targetActivityId ? App.db.activities.find((x) => x.id === targetActivityId) : null;
  const title = a ? `🍅 ${a.title}` : '🍅 番茄钟';
  const active = running || (sessionStart > 0 && !finished);
  if (active) {
    P.showControls({
      title,
      remainingMs: Math.max(0, running ? endTs - Date.now() : remainingMs),
      running: !!running,
    }).catch(() => {});
  } else {
    P.hideControls().catch(() => {});
  }
}
function stopRingNow() {
  const P = nativeControls();
  if (P) P.stopRing().catch(() => {});
  stopAlarm(); // 停 AlarmTonePlayer（闹钟兑底铃声）
}
function persistState({ paused = false, remainingMs: rem = null } = {}) {
  const payload = JSON.stringify({
    target: targetActivityId, sec, sessionStart,
    mode: paused ? 'pause' : 'run',
    endTs: paused ? null : endTs,
    remainingMs: paused ? rem : null,
    ts: Date.now(),
  });
  try { localStorage.setItem(TKEY, payload); } catch (e) {}
  const P = nativeTimerPlugin();
  if (P) P.setTimerState({ json: payload }).catch(() => {});
}
function clearState() {
  try { localStorage.removeItem(TKEY); } catch (e) {}
  const P = nativeTimerPlugin();
  if (P) P.setTimerState({ json: '' }).catch(() => {});
}

let sec = 25 * 60;          // 预设总时长（秒）
let remainingMs = sec * 1000; // 当前剩余（毫秒）
let endTs = 0;              // 结束时间戳（运行中有效）
let running = false;
let finished = false;
let intId = null;
let listenersReady = false;
let sessionStart = 0;       // 本次开始计时的时间戳（供「记到现在」算已用时长）

// 统一应用恢复态（restore 与 restoreNative 共用）：运行中→继续倒计时并重新调度通知；
// 已超时→标记待呈现（打开计时器时呈现）；暂停→还原剩余
function applyRestored(s) {
  targetActivityId = s.target || null;
  sec = s.sec || 25 * 60;
  sessionStart = s.sessionStart || 0;
  if (s.mode === 'pause') {
    remainingMs = Number(s.remainingMs) || sec * 1000;
    running = false; finished = false; endTs = 0;
    syncControls(); // 暂停态 → 控制栏显示「继续」
    return;
  }
  endTs = Number(s.endTs) || 0;
  if (endTs > Date.now()) {
    running = true; finished = false;
    ensureListeners();
    scheduleNotif(new Date(endTs));
    tick(); intId = setInterval(tick, 1000);
    syncControls(); // 恢复运行态 → 控制栏显示「暂停」
  } else {
    running = false; finished = true; remainingMs = 0;
    cancelNotif();
    syncControls(); // 已到时 → 隐藏控制栏
  }
}

// 启动时恢复（快路径：localStorage）
export function restore() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(TKEY) || 'null'); } catch (e) {}
  if (!s || (!s.endTs && s.mode !== 'pause')) { clearState(); return; }
  applyRestored(s);
}

// 原生兜底恢复：WebView 存储被系统清理导致本地丢失时，从 SharedPreferences 回捞
export async function restoreNative() {
  const P = nativeTimerPlugin();
  if (!P || endTs || running || finished || sessionStart) return; // 本地已恢复有效状态
  try {
    const r = await P.getTimerState();
    if (!r || !r.json) return;
    let s = null;
    try { s = JSON.parse(r.json); } catch (e) { return; }
    if (!s || (!s.endTs && s.mode !== 'pause')) return;
    // await 窗口内本地可能已恢复有效状态或用户开了新计时，此时原生态已陈旧，丢弃
    if (endTs || running || finished || sessionStart) return;
    applyRestored(s);
  } catch (e) {}
}

let el = null;
const CIRC = 2 * Math.PI * 145;

// 从卡片绑定的目标活动（复用番茄钟做按任务计时）；null = 通用快速计时
let targetActivityId = null;

export function open() {
  targetActivityId = null;
  openTimer();
}

// 为指定活动打开番茄钟：结束时把时长记入该活动 time_logs；时长直接预填计划投入
export function openForActivity(activityId) {
  targetActivityId = activityId;
  openTimer();
  const a = App.db.activities.find((x) => x.id === activityId);
  if (a && a.planned_minutes > 0) setPreset(a.planned_minutes); // 直接把计划时间填进番茄钟
}

function openTimer() {
  if (!el) build();
  Notifications.requestPermission();
  const a = targetActivityId ? App.db.activities.find((x) => x.id === targetActivityId) : null;
  el.classList.add('show');
  // 反映当前计时状态（含被杀后 restore 的），而不是无条件重置
  reflectState();
  if (a) {
    let label = `🍅 ${a.title}`;
    if (running) label += ' · 计时中';
    else if (finished) label += ' · 已到时';
    el.querySelector('#t-name').textContent = label;
  }
}

// 把内存状态同步到 overlay 控件
function reflectState() {
  paint();
  if (running) { setGo('暂停'); setLbl('倒计时中'); el.querySelector('#t-go').style.display='inline-block'; el.querySelector('#t-reset').style.display='inline-block'; }
  else if (finished) { setGo('开始'); setLbl('完成！'); el.querySelector('#t-go').style.display='none'; el.querySelector('#t-reset').style.display='none'; el.querySelector('#t-done').classList.add('show'); }
  else { setGo(sessionStart||remainingMs!==sec*1000 ? '继续' : '开始'); setLbl(remainingMs===sec*1000?'准备开始':'已暂停'); el.querySelector('#t-reset').style.display=(sessionStart||remainingMs!==sec*1000)?'inline-block':'none'; el.querySelector('#t-done').classList.remove('show'); el.querySelector('#t-go').style.display='inline-block'; }
  syncNowBtn();
  syncControls(); // 打开 overlay 时同步控制栏（含恢复后的状态）
}

export function close() {
  // 幽灵态修复：计时中关闭仅隐藏 overlay，不停表 —— 时间戳锚定使倒计时后台继续，
  // 到点仍由 tick / 原生通知触发 finish 闭环；重开时 paint 按 endTs 校正。
  // 终止性路径（recordNow 等）须先显式终止会话再 close。
  System.keepAwake(false);
  el.classList.remove('show');
}

// 终止当前会话并复位内存态（记录/忽略入账后调用，防止残留 interval 形成幽灵计时）
function abortSession() {
  stop();
  finished = false;
  sessionStart = 0;
  remainingMs = sec * 1000;
  stopRingNow();
  syncControls(); // 会话终止 → 隐藏控制栏
}

// 绑定活动计时时显示「记到现在」；其余/完成态隐藏
function syncNowBtn() {
  if (!el) return;
  el.querySelector('#t-now').style.display = (targetActivityId && !finished) ? 'inline-block' : 'none';
}

// ---------------- 原生闹钟（后台响铃兑底） ----------------
// 到点由原生 AlarmReceiver 响铃 + 震动 + 锁屏全屏提醒，即使 App 被杀/后台也能响。
// 替换原 LocalNotifications（只有无声通知，被杀时 JS finish 不执行 → 不响铃）。
async function scheduleNotif(at) {
  const a = targetActivityId ? App.db.activities.find((x) => x.id === targetActivityId) : null;
  scheduleTimerAlarm(at.getTime(), `🍅 ${(a && a.title) || '计时'} 结束`);
}

async function cancelNotif() {
  cancelTimerAlarm();
}

// 一次性注册系统监听：回前台校正 + 通知触发完成 + 控制栏按钮
function ensureListeners() {
  if (listenersReady) return;
  listenersReady = true;
  System.onResume(() => {
    if (!running || finished) return;
    if (endTs - Date.now() <= 0) { stop(); finish(); }
    else if (el) paint();
  });
  Notifications.onReceived(() => {
    if (running && !finished) { stop(); finish(); }
  });
  // 闹钟全屏通知点击回 App：番茄钟到点被点开 → 进入完成态（铃声已在 alarm.js 停止）
  window.addEventListener('alarmOpened', (e) => {
    const d = (e && e.detail) || {};
    if (Number(d.id) !== TIMER_ALARM_ID) return;
    if (running && !finished) { stop(); finish(); }
  });
  // 控制栏按钮（暂停/继续/结束）→ 应用到当前会话
  window.addEventListener('timerControl', (e) => {
    const d = (e && e.detail) || {};
    const action = d.action;
    if (action === 'pause' && running) { toggle(); syncControls(); }
    else if (action === 'resume' && !running && !finished && (sessionStart > 0 || remainingMs !== sec * 1000)) { toggle(); syncControls(); }
    else if (action === 'stop') {
      abortSession();
      clearState();
      cancelNotif();
      close();
      toast('已通过控制栏结束计时', 'info');
    }
  });
}

// ---------------- UI 构建 ----------------
function build() {
  ensureListeners();
  el = document.createElement('div');
  el.id = 'timerOverlay';
  el.className = 'timer-overlay';
  el.innerHTML = `
    <div class="timer-name" id="t-name">快速倒计时</div>
    <div class="timer-ring">
      <svg width="320" height="320" viewBox="0 0 320 320">
        <circle class="ring-bg" cx="160" cy="160" r="145"/>
        <circle class="ring-fg" id="t-ring" cx="160" cy="160" r="145" stroke-dasharray="${CIRC}" stroke-dashoffset="0"/>
      </svg>
      <div class="timer-num"><div class="big" id="t-big">25:00</div><div class="lbl" id="t-lbl">准备开始</div></div>
    </div>
    <div class="timer-presets" id="t-presets">
      ${PRESETS.map((m) => `<button data-min="${m}" ${m === 25 ? 'class="on"' : ''}>${m}分</button>`).join('')}
    </div>
    <div class="timer-controls">
      <button class="t-now" id="t-now" data-now style="display:none">记到现在</button>
      <button class="t-close" data-close>✕</button>
      <button class="t-go" id="t-go" data-go>开始</button>
      <button class="t-reset" id="t-reset" data-reset style="display:none">重置</button>
    </div>
    <div class="timer-done" id="t-done">
      <div class="emoji">🎉</div>
      <div class="txt">时间到！记录这次活动</div>
      <input id="t-actname" placeholder="刚才做了什么？">
      <div class="rowbtn">
        <button class="go" data-record>记录并闭环</button>
        <button class="ghost" data-dismiss>忽略</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  el.querySelector('[data-close]').onclick = () => close();
  el.querySelector('[data-go]').onclick = toggle;
  el.querySelector('[data-reset]').onclick = resetUI;
  el.querySelector('[data-now]').onclick = recordNow;
  el.querySelector('[data-record]').onclick = record;
  el.querySelector('[data-dismiss]').onclick = dismiss;
  el.querySelectorAll('#t-presets button').forEach((b) => b.onclick = () => {
    setPreset(Number(b.dataset.min));
    el.querySelectorAll('#t-presets button').forEach((x) => x.classList.toggle('on', x === b));
  });
}

// ---------------- 状态控制 ----------------
function setPreset(min) { cancelNotif(); sec = min * 60; remainingMs = sec * 1000; sessionStart = 0; stop(); clearState(); stopRingNow(); syncControls(); paint(); setLbl('准备开始'); setGo('开始'); el.querySelector('#t-reset').style.display = 'none'; el.querySelector('#t-done').classList.remove('show'); syncNowBtn(); }

function resetUI() {
  sec = 25 * 60; remainingMs = sec * 1000; sessionStart = 0; stop(); clearState(); stopRingNow(); syncControls(); paint(); setLbl('准备开始'); setGo('开始');
  el.querySelector('#t-reset').style.display = 'none';
  el.querySelector('#t-done').classList.remove('show');
  el.querySelector('#t-name').textContent = '快速倒计时';
  el.querySelectorAll('#t-presets button').forEach((b) => b.classList.toggle('on', b.dataset.min === '25'));
  syncNowBtn();
  cancelNotif();
}

function toggle() {
  if (running) { // 暂停：剩余量持久化，被杀后可恢复
    remainingMs = endTs - Date.now();
    stop();
    cancelNotif();
    persistState({ paused: true, remainingMs });
    setLbl('已暂停'); setGo('继续');
    syncControls(); // 控制栏切「继续」
  } else {
    running = true; finished = false;
    if (!sessionStart) sessionStart = Date.now(); // 暂停后继续时保留首次开始时间，recordNow 才能算全已用时
    endTs = Date.now() + remainingMs;
    persistState();
    scheduleNotif(new Date(endTs));
    Notifications.requestPermission(); // 开始计时再请求一次通知权限（首次弹系统框；已拒/已授权静默）
    System.keepAwake(true); // 计时期间屏幕常亮
    setGo('暂停'); setLbl('倒计时中');
    el.querySelector('#t-reset').style.display = 'inline-block';
    syncNowBtn();
    tick(); intId = setInterval(tick, 1000);
    syncControls(); // 控制栏切「暂停」
  }
}

function stop() { running = false; if (intId) { clearInterval(intId); intId = null; } }

function tick() {
  if (finished) return;
  remainingMs = endTs - Date.now();
  if (remainingMs <= 0) { stop(); finish(); return; }
  paint();
  syncControls(); // 每秒刷新控制栏常驻通知 → 通知栏是一个活的倒计时时钟
}

function paint() {
  if (!el) return; // restore 启动恢复时 overlay 可能未构建
  const total = Math.round(remainingMs / 1000);
  const m = Math.floor(total / 60), s = total % 60;
  el.querySelector('#t-big').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  el.querySelector('#t-ring').style.strokeDashoffset = CIRC * (1 - remainingMs / (sec * 1000));
}

function setLbl(t) { if (!el) return; el.querySelector('#t-lbl').textContent = t; }
function setGo(t) { if (!el) return; el.querySelector('#t-go').textContent = t; }

function finish() {
  if (finished) return;
  finished = true; running = false; stop();
  System.keepAwake(false);
  syncControls(); // 完成 → 隐藏控制栏常驻通知
  // 铃声由原生 AlarmReceiver 统一播放（后台/被杀也响），这里不重复 ringNow 避免双响；
  // 不 cancel 闹钟——若 finish 先于 AlarmManager 触发，让它稍后到点响铃提醒。
  if (el) { // 后台到期时 overlay 未打开，UI 更新推迟到下次 openTimer 的 reflectState
    setLbl('完成！');
    el.querySelector('#t-go').style.display = 'none';
    el.querySelector('#t-reset').style.display = 'none';
    el.querySelector('#t-done').classList.add('show');
    el.querySelector('#t-actname').value = '';
    el.querySelector('#t-actname').focus();
    syncNowBtn();
  }
}

// 绑定活动计时：把当前已计时长立即写入 time_logs（不必等完整跑完）
function recordNow() {
  if (!targetActivityId || finished) return;
  if (!sessionStart) { toast('请先开始计时', 'info'); return; }
  const elapsed = Math.max(0, Math.round((Date.now() - sessionStart) / 60000));
  if (elapsed <= 0) { toast('计时不足 30 秒，暂不记录', 'info'); return; }
  const ta = App.db.activities.find((x) => x.id === targetActivityId);
  if (!ta) return;
  if (!ta.time_logs) ta.time_logs = [];
  const end = Date.now();
  ta.time_logs.push({ start: end - elapsed * 60e3, end });
  if (ta.status === 'Planned') { ta.actual_start = end - elapsed * 60e3; ta.status = 'Started'; }
  abortSession(); // close 不再停表，入账后必须显式终止，否则残留 interval 会幽灵到点
  clearState();
  cancelNotif();
  close();
  App.refresh();
  toast(`已为「${ta.title}」记录 ${elapsed} 分钟`, 'ok');
}

// ---------------- 闭环入账 ----------------
function record() {
  const { db } = App;
  const minutes = Math.max(1, Math.round(sec / 60) || 1);

  // 绑定活动（按任务计时）：把本次时长记入该活动，Planned 自动转为 Started
  if (targetActivityId) {
    const ta = db.activities.find((x) => x.id === targetActivityId);
    if (ta) {
      if (!ta.time_logs) ta.time_logs = [];
      const end = Date.now();
      ta.time_logs.push({ start: end - minutes * 60e3, end });
      if (ta.status === 'Planned') { ta.actual_start = end - minutes * 60e3; ta.status = 'Started'; }
      abortSession();
      clearState();
      cancelNotif();
      App.refresh();
      close();
      toast(`已为「${ta.title}」记录 ${minutes} 分钟`, 'ok');
      return;
    }
  }

  // 通用快速计时：createActivity → startActivity → quickComplete 全程走引擎
  const name = el.querySelector('#t-actname').value.trim() || `计时活动 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  const timeRes = db.resources.find((r) => r.name === '时间') || db.resources[0];
  if (!timeRes) { close(); toast('请先添加资源，再开始计时', 'err'); return; }
  const cr = App.engine.createActivity(db, {
    title: name, note: '来自快速计时', plan_ids: [], planned_minutes: minutes,
  });
  if (!cr.ok) { close(); toast(cr.error, 'err'); return; }
  const a = db.activities[db.activities.length - 1];
  const sr = App.engine.startActivity(db, a.id);
  if (!sr.ok) { close(); toast(sr.error, 'err'); return; }
  const r = App.engine.quickComplete(db, a.id, {
    expense: { resource_id: timeRes.id, amount: minutes, note: `计时 ${minutes} 分钟` },
    outputTitle: `${name} 产出`,
  });
  if (!r.ok) { close(); toast(r.error, 'err'); return; }
  abortSession();
  clearState();
  cancelNotif();
  App.refresh();
  close();
  toast(`已记录「${name}」为已完成活动（${minutes} 分钟）`, 'ok');
}

function dismiss() {
  abortSession();
  clearState();
  cancelNotif();
  close();
  toast('本次计时已忽略，未入账');
}

// 尽早注册系统监听（回前台校正 / 通知触发完成 / 控制栏按钮 broadcast → timerControl），
// 即使从未打开过计时 overlay，通知栏按钮也能驱动暂停/继续/结束。
ensureListeners();

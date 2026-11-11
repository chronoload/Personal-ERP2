// ============================================================
// views/calendar.js
// 日历板块（内嵌于「活动」页，第二顺位）：
//   月视图：月份网格 + 当日日程表
//   周视图：时间网格（7 列 × 小时行，时间定位色块）+ 当日日程表
// 循环系列在两种视图都展开 occurrences[]：当前期=活卡，其余=未来期次/已办/跳过
// ============================================================
import { esc, badge, empty } from '../ui/helpers.js';
import { icon } from '../ui/icons.js';
import { activityWindow } from '../domain/engine.js';

let calYear, calMonth, calSelected = null;
let calMode = 'month'; // 'month' | 'week'
// 多视图联动焦点：看板/HUD 点击活动 → 记录其日期与 id，渲染时加亮
let calFocusId = null, calFocusK = null;

// 周视图时间轴可见范围与行高
const WK_START = 6;   // 6:00 起
const WK_END = 23;    // 23:00 止
const WK_HOUR = 40;   // 每小时 40px

// 内联事件参数转义（同 overview.js）：\ 与 ' 按 JS 转义，" 转 \x22 防止属性提前闭合
function jsStr(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\x22')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function dayKey(d) { return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
// YYYY-M-D / YYYY-MM-DD → 规范化（期次日期字符串用；与 dayKey 同格式）
function normDate(k) { const [y, m, d] = String(k).split('-').map(Number); return `${y}-${m}-${d}`; }
// YYYY-M-D → 补零（datetime-local 需要）
function padDateKey(k) {
  if (!k) { const t = new Date(); k = dayKey(t); } // 未选日期时回退今天
  const [y, m, d] = String(k).split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function pad2(n) { return String(n).padStart(2, '0'); }
function timeOf(ps) { const m = String(ps || '').match(/T(\d{1,2}):(\d{1,2})/); return m ? `${m[1]}:${m[2]}` : null; }
function timeToMin(t) { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return h * 60 + m; }
function fmtDay(k) {
  if (!k) return '选择日期'; // 翻月未选日：不显示 undefined
  const [y, m, d] = String(k).split('-').map(Number);
  return `${m}月${d}日`;
}
function planColor(db, planIds) {
  for (const pid of planIds) { const p = db.plans.find((x) => x.id === pid); if (p && p.color) return esc(p.color); }
  return '#e5e8ee';
}
function planTitles(db, planIds) {
  return planIds.map((pid) => { const p = db.plans.find((x) => x.id === pid); return p ? esc(p.title) : ''; }).filter(Boolean).join(' · ') || '未关联';
}
function actDate(a) {
  if (a.actual_start) return dayKey(new Date(a.actual_start));
  if (a.planned_date) return a.planned_date;
  return null;
}
// 窗口重叠判定（与引擎 windowsOverlap 同语义：w1.start < w2.end && w2.start < w1.end）
function overlapWin(w1, w2) { return !!(w1 && w2) && w1.start < w2.end && w2.start < w1.end; }

// 按日分组；循环系列展开 occurrences[] 为每日独立条目：
//   当前期（=planned_date）→ 非虚拟（活卡，可开始/完成）；其余期次 → 虚拟条目（已办/跳过标记 or 未来待做）
// 活动级归档 = 隐藏：Archived 活动（含其系列全部期次）不进日历
function buildByDay(db) {
  const byDay = {};
  for (const a of db.activities) {
    if (a.status === 'Archived') continue; // 已归档 → 日历退场（历史存档）
    if (a.repeat && Array.isArray(a.occurrences) && a.occurrences.length) {
      const cur = a.planned_date ? normDate(a.planned_date) : null;
      for (const o of a.occurrences) {
        const k = o.date ? normDate(o.date) : null;
        if (k) (byDay[k] = byDay[k] || []).push({ a, occ: o, virtual: !(cur && cur === k) });
      }
    } else {
      const k = actDate(a);
      if (k) (byDay[normDate(k)] = byDay[normDate(k)] || []).push({ a, occ: null, virtual: false });
    }
  }
  return byDay;
}

// 周一为一周起点
function weekStartOf(k) {
  const [y, m, d] = String(k).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = (dt.getDay() + 6) % 7; // 周一=0
  dt.setDate(dt.getDate() - dow);
  return dt;
}
function fmtDateKey(dt) { return `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}`; }

function agendaRow(App, a, t, occ, virtual) {
  const { db } = App;
  const pcolor = planColor(db, a.plan_ids);
  // 时间原子性可视化：有截止时间显示完整时段；捆绑冲突加 ⚠ 提示
  const end = timeOf(a.planned_end);
  const span = t ? (end ? `${t}–${end}` : t) : '全天';
  // 循环期次标记行：已完成 / 已跳过（非交互）
  if (occ && occ.status !== 'pending') {
    const done = occ.status === 'done';
    return `
      <div class="agenda-row${a.id === calFocusId ? ' focus' : ''}" data-id="${jsStr(a.id)}">
        <div class="agenda-time" style="color:${pcolor}">${done ? icon('check') : icon('close')} ${span}</div>
        <div class="grow">
          <div class="agenda-title"><span class="plan-chip" style="background:${pcolor}"></span>${esc(a.title)} <span class="badge ${done ? 'b-green' : 'b-gray'}">${done ? '已办' : '跳过'}</span></div>
          <div class="muted">${planTitles(db, a.plan_ids)}</div>
        </div>
      </div>`;
  }
  // 未来 pending 期次行：可跳过 / 可查看期次 / 可编辑系列
  if (occ && virtual) {
    return `
      <div class="agenda-row clickable focusable${a.id === calFocusId ? ' focus' : ''}" data-id="${jsStr(a.id)}" data-edit="${jsStr(a.id)}" title="点击编辑系列">
        <div class="agenda-time" style="color:${pcolor}">${span}</div>
        <div class="grow">
          <div class="agenda-title"><span class="plan-chip" style="background:${pcolor}"></span>${esc(a.title)} <span class="badge b-amber">待</span><span class="muted"> · 未来期次</span></div>
          <div class="muted">${planTitles(db, a.plan_ids)}</div>
        </div>
        <div class="row-gap">
          <button class="btn sm primary" title="标记该期已完成（补记/提前勾掉）" onclick="App.overview.completeOccurrence('${jsStr(a.id)}','${jsStr(occ.date)}')">完成</button>
          <button class="btn sm" title="跳过该期次" onclick="App.overview.skipOccurrence('${jsStr(a.id)}','${jsStr(occ.date)}')">跳过</button>
          <button class="btn sm" title="查看系列期次" onclick="App.overview.openOccurrencesModal('${jsStr(a.id)}')">${icon('calendar')}</button>
        </div>
      </div>`;
  }
  // 当前期 / 非循环：原逻辑
  const rivals = (a.conflicts || [])
    .map((cid) => db.activities.find((x) => x.id === cid))
    .filter((o) => o && o.status === 'Planned' && overlapWin(activityWindow(a), activityWindow(o)));
  const warn = rivals.length ? `<span title="与 ${rivals.map((o) => esc(o.title)).join('、')} 时间重叠（捆绑，开始时仲裁）">${icon('warning')}</span> ` : '';
  return `
    <div class="agenda-row clickable focusable${a.id === calFocusId ? ' focus' : ''}" data-id="${jsStr(a.id)}" data-edit="${jsStr(a.id)}" title="点击编辑">
      <div class="agenda-time" style="color:${pcolor}">${warn}${span}</div>
      <div class="grow">
        <div class="agenda-title"><span class="plan-chip" style="background:${pcolor}"></span>${esc(a.title)} ${badge(a.status)}${a.planned_minutes ? `<span class="muted"> · ${a.planned_minutes}m</span>` : ''}</div>
        ${a.note ? `<div class="agenda-note">${icon('note')} ${esc(a.note)}</div>` : ''}
        <div class="muted">${planTitles(db, a.plan_ids)}</div>
      </div>
      <div class="row-gap">
        <button class="btn sm timer-btn" title="按任务计时（计入 time_logs）" onclick="App.timer.openForActivity('${jsStr(a.id)}')">${icon('tomato')}</button>
        ${a.status === 'Planned' ? `<button class="btn sm primary" onclick="App.startAct('${jsStr(a.id)}')">开始</button>` : ''}
        ${a.status === 'Started' ? (((a.preset_expenses || []).length || (a.preset_incomes || []).length)
          ? `<button class="btn sm primary" onclick="App.quickComplete('${jsStr(a.id)}')">完成</button>`
          : `<button class="btn sm primary" onclick="App.overview.openCompleteModal('${jsStr(a.id)}')">完成</button>`) : ''}
      </div>
    </div>`;
}

// 当日日程表 HTML（月/周视图共用；绑定逻辑见 bindAgenda）
function agendaHTML(App, byDay, k) {
  const dayActs = (byDay[k] || [])
    .map((it) => ({ a: it.a, t: timeOf(it.a.planned_start), occ: it.occ, virtual: it.virtual }))
    .sort((x, y) => (timeToMin(x.t) ?? Infinity) - (timeToMin(y.t) ?? Infinity));
  const totalMin = dayActs.reduce((s, x) => s + (x.a.planned_minutes || 0), 0);
  return `
    <div class="cal-agenda">
      <div class="agenda-head">
        <span>${fmtDay(k)}<span class="muted"> · ${dayActs.length} 项${totalMin ? ` · 预计 ${totalMin} 分钟` : ''}</span></span>
        <button class="btn sm" title="为 ${fmtDay(k)} 快速添加待办" onclick="App.overview.openActModal(null,null,'${padDateKey(k)}T09:00')">${icon('plus')}</button>
      </div>
      ${dayActs.length ? dayActs.map((x) => agendaRow(App, x.a, x.t, x.occ, x.virtual)).join('') : empty('当天无安排', '＋ 点击此处，为该日快速添加待办')}
    </div>`;
}
function bindAgenda(App, host, byDay, k, resync) {
  const agenda = host.querySelector('.cal-agenda');
  if (!agenda) return;
  agenda.onclick = (e) => {
    const rowEl = e.target.closest('.agenda-row.clickable');
    if (rowEl) {
      if (e.target.closest('button, a, input, select, textarea')) return;
      App.overview.openActModal(rowEl.dataset.edit);
      return;
    }
    if (e.target.closest('.agenda-row, button, input, select, textarea')) return;
    App.overview.openActModal(null, null, `${padDateKey(k)}T09:00`);
  };
}

// 模式切换按钮（月/周共用）
function modeToggleHTML() {
  return `
    <button class="btn sm ${calMode === 'month' ? 'primary' : ''}" data-cal="mode-month">月</button>
    <button class="btn sm ${calMode === 'week' ? 'primary' : ''}" data-cal="mode-week">周</button>`;
}
function bindModeToggle(App, host, resync) {
  host.querySelectorAll('[data-cal="mode-month"]').forEach((b) => {
    b.onclick = () => { calMode = 'month'; renderSection(App, host); resync(); };
  });
  host.querySelectorAll('[data-cal="mode-week"]').forEach((b) => {
    b.onclick = () => { calMode = 'week'; renderSection(App, host); resync(); };
  });
}

// ---------- 月视图 ----------
function renderMonth(App, host, byDay, todayK, resync) {
  const { db } = App;
  const first = new Date(calYear, calMonth, 1);
  let start = first.getDay(); start = (start + 6) % 7; // 周一为 0
  const dim = new Date(calYear, calMonth + 1, 0).getDate();

  let grid = ['一', '二', '三', '四', '五', '六', '日'].map((d) => `<div class="cal-dow">${d}</div>`).join('');
  // 补位空格（cal-fill）：渲染完整网格线，但透明融入底色——不可用 `.empty` 类名，
  // 会撞通用占位样式（虚线圆角白底）而显成「空白椭圆块」
  for (let i = 0; i < start; i++) grid += '<div class="cal-day cal-fill"></div>';
  for (let d = 1; d <= dim; d++) {
    const k = dayKey(new Date(calYear, calMonth, d));
    const acts = byDay[k] || [];
    const cost = acts.reduce((s, it) => s + (it.virtual ? 0 : App.engine.activityCost(db, it.a.id)), 0);
    grid += `
      <div class="cal-day ${k === todayK ? 'today' : ''} ${calSelected === k ? 'selected' : ''} ${calFocusK === k ? 'focus' : ''}" data-k="${k}">
        <div class="cal-d">${d}</div>
        ${acts.length ? `<div class="cal-cnt">${acts.length} 活动</div>` : ''}
        ${cost ? `<div class="cal-cost">-${cost}</div>` : ''}
      </div>`;
  }
  // 末尾补空位：保证网格线完整到右边线（透明底，不显块）
  const rem = (start + dim) % 7;
  if (rem) for (let i = 0; i < 7 - rem; i++) grid += '<div class="cal-day cal-fill"></div>';

  host.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>日历</h3>
        <div class="row-gap">
          ${modeToggleHTML()}
          <button class="btn sm" data-cal="prev">${icon('arrow-left')} 上月</button>
          <button class="btn sm" data-cal="today">今天</button>
          <button class="btn sm" data-cal="next">${icon('arrow-right')} 下月</button>
        </div>
      </div>
      <div class="cal-wrap">
        <div class="cal-grid">${grid}</div>
        ${agendaHTML(App, byDay, calSelected)}
      </div>
    </div>
  `;

  host.querySelector('[data-cal="prev"]').onclick = () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } calSelected = null; renderSection(App, host); resync(); };
  host.querySelector('[data-cal="today"]').onclick = () => { const t = new Date(); calYear = t.getFullYear(); calMonth = t.getMonth(); calSelected = dayKey(t); renderSection(App, host); resync(); };
  host.querySelector('[data-cal="next"]').onclick = () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } calSelected = null; renderSection(App, host); resync(); };
  host.querySelectorAll('.cal-day[data-k]').forEach((el) => {
    el.onclick = () => { calSelected = el.dataset.k; renderSection(App, host); resync(); };
  });
  bindModeToggle(App, host, resync);
  bindAgenda(App, host, byDay, calSelected, resync);
}

// ---------- 周视图（时间网格） ----------
function renderWeek(App, host, byDay, todayK, resync) {
  const { db } = App;
  const anchor = calSelected || todayK;
  const ws = weekStartOf(anchor);
  const rangeMin = WK_START * 60, rangeEndMin = WK_END * 60;
  const canvasH = (WK_END - WK_START) * WK_HOUR;

  const days = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(ws); dt.setDate(dt.getDate() + i);
    const key = fmtDateKey(dt);
    days.push({ key, dow: ['一', '二', '三', '四', '五', '六', '日'][i], d: dt.getDate(), today: key === todayK, sel: key === calSelected });
  }

  // 组装每列：全天/弹性条 + 时间定位色块
  const cols = days.map((dy) => {
    const allDay = [];
    const blocks = [];
    for (const it of byDay[dy.key] || []) {
      const a = it.a;
      const w = activityWindow(a);
      const hasTime = !!(w && a.planned_start && Number(a.planned_minutes) > 0);
      const s = w ? new Date(w.start) : null;
      const smin = s ? s.getHours() * 60 + s.getMinutes() : null;
      const durMin = w ? Math.max(20, (w.end - w.start) / 60000) : 20;
      const cls = it.occ && it.occ.status === 'done' ? ' done' : (it.occ && it.occ.status === 'skipped' ? ' skipped' : (it.virtual ? ' future' : ''));
      const lbl = `${esc(a.title)}${a.planned_minutes ? ` · ${a.planned_minutes}m` : ''}`;
      if (!hasTime || smin === null) {
        allDay.push(`<button type="button" class="week-all-item${cls}" style="--chip:${planColor(db, a.plan_ids)}" data-edit="${jsStr(a.id)}" title="点击编辑">${lbl}</button>`);
        continue;
      }
      if (smin >= rangeEndMin) continue; // 起点超出可见范围（跨深夜/夜里）略过
      const top = Math.max(0, (smin - rangeMin) / 60 * WK_HOUR);
      const h = Math.max(18, Math.min(durMin / 60 * WK_HOUR, canvasH - top));
      blocks.push(`<button type="button" class="week-block${cls}" style="top:${top}px;height:${h}px;--chip:${planColor(db, a.plan_ids)}" data-edit="${jsStr(a.id)}" title="点击编辑">${lbl}</button>`);
    }
    return { ...dy, allDay, blocks };
  });
  const allH = Math.max(...cols.map((c) => c.allDay.length)) * 26; // 全天条统一高度，保证列对齐

  const axis = [];
  for (let h = WK_START; h < WK_END; h++) {
    axis.push(`<div class="week-hour" style="top:${allH + (h - WK_START) * WK_HOUR}px">${h}:00</div>`);
  }

  host.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>日历 · 周视图</h3>
        <div class="row-gap">
          ${modeToggleHTML()}
          <button class="btn sm" data-cal="wprev">${icon('arrow-left')} 上周</button>
          <button class="btn sm" data-cal="wtoday">今天</button>
          <button class="btn sm" data-cal="wnext">${icon('arrow-right')} 下周</button>
        </div>
      </div>
      <div class="week-head">
        <div class="week-head-spacer"></div>
        ${cols.map((dy) => `<div class="week-head-day ${dy.today ? 'today' : ''} ${dy.sel ? 'selected' : ''} ${calFocusK === dy.key ? 'focus' : ''}" data-k="${dy.key}"><b>${dy.dow}</b><span>${dy.d}</span></div>`).join('')}
      </div>
      <div class="week-grid" style="--allH:${allH}px;--canvasH:${canvasH}px">
        <div class="week-axis">${axis.join('')}</div>
        <div class="week-cols">
          ${cols.map((dy) => `
            <div class="week-col ${calFocusK === dy.key ? 'focus' : ''}" data-k="${dy.key}">
              <div class="week-all">${dy.allDay.join('') || ''}</div>
              <div class="week-canvas">${dy.blocks.join('')}</div>
            </div>`).join('')}
        </div>
      </div>
      <div class="muted" style="margin:6px 0 10px;font-size:11px">点击时间格 = 该日该钟点新建；点击色块 = 编辑；上方为全天/弹性活动</div>
      ${agendaHTML(App, byDay, calSelected || todayK)}
    </div>
  `;

  host.querySelector('[data-cal="wprev"]').onclick = () => { const d = weekStartOf(calSelected || todayK); d.setDate(d.getDate() - 7); calSelected = fmtDateKey(d); renderSection(App, host); resync(); };
  host.querySelector('[data-cal="wtoday"]').onclick = () => { calSelected = todayK; renderSection(App, host); resync(); };
  host.querySelector('[data-cal="wnext"]').onclick = () => { const d = weekStartOf(calSelected || todayK); d.setDate(d.getDate() + 7); calSelected = fmtDateKey(d); renderSection(App, host); resync(); };
  // 点表头/列 = 选中该日（周视图内停留）
  host.querySelectorAll('.week-head-day[data-k]').forEach((el) => {
    el.onclick = () => { calSelected = el.dataset.k; renderSection(App, host); resync(); };
  });
  // 点色块 = 编辑；点空白时间格 = 该日该钟点新建
  host.querySelectorAll('.week-block[data-edit], .week-all-item[data-edit]').forEach((el) => {
    el.onclick = (e) => { e.stopPropagation(); App.overview.openActModal(el.dataset.edit); };
  });
  host.querySelectorAll('.week-canvas').forEach((canvas) => {
    canvas.onclick = (e) => {
      if (e.target.closest('.week-block')) return;
      const col = canvas.closest('.week-col');
      const k = col.dataset.k;
      const rect = canvas.getBoundingClientRect();
      const rel = e.clientY - rect.top;
      const hour = Math.max(WK_START, Math.min(WK_END - 1, WK_START + Math.floor(rel / WK_HOUR)));
      calSelected = k;
      App.overview.openActModal(null, null, `${padDateKey(k)}T${pad2(hour)}:00`);
    };
  });
  bindModeToggle(App, host, resync);
  bindAgenda(App, host, byDay, calSelected || todayK, resync);
}

// 渲染内嵌日历卡片到 host 元素（每次渲染重建，事件用事件委托）
export function renderSection(App, host) {
  if (calYear === undefined) { const d = new Date(); calYear = d.getFullYear(); calMonth = d.getMonth(); calSelected = dayKey(d); }
  const db = App.db;
  const byDay = buildByDay(db);
  const todayK = dayKey(new Date());
  // 就地重渲染后重算轮播高度，不重置页码
  const resync = () => App.overview.refreshPagerHeight();
  if (calMode === 'week') return renderWeek(App, host, byDay, todayK, resync);
  return renderMonth(App, host, byDay, todayK, resync);
}

// 多视图联动：看板/HUD 广播 app:focus-activity → 日历跳到该活动所在日期并加亮
export function focusActivity(id) {
  const app = window.App;
  const db = app && app.db;
  if (!db) return;
  const a = db.activities.find((x) => x.id === id);
  if (!a) return;
  let k = a.repeat && a.planned_date ? a.planned_date : (actDate(a) || a.planned_date);
  if (!k) return;
  const kk = normDate(k);
  calFocusId = id; calFocusK = kk;
  const [y, m] = kk.split('-').map(Number);
  calYear = y; calMonth = m - 1; calSelected = kk;
  const host = document.querySelector('#calendar-section');
  if (host) { renderSection(app, host); if (app.overview && app.overview.refreshPagerHeight) app.overview.refreshPagerHeight(); }
}
window.addEventListener('app:focus-activity', (e) => { if (e && e.detail && e.detail.id) focusActivity(e.detail.id); });

// ============================================================
// views/calendar.js
// 日历板块（内嵌于「活动」页，第二顺位）：
//   月份网格 + 当日日程表（按计划开始时间排序，可开始/完成/编辑）
// ============================================================
import { esc, badge, empty } from '../ui/helpers.js';
import { activityWindow } from '../domain/engine.js';

let calYear, calMonth, calSelected = null;

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
      <div class="agenda-row">
        <div class="agenda-time" style="color:${pcolor}">${done ? '✓' : '✕'} ${span}</div>
        <div class="grow">
          <div class="agenda-title"><span class="plan-chip" style="background:${pcolor}"></span>${esc(a.title)} <span class="badge ${done ? 'b-green' : 'b-gray'}">${done ? '已办' : '跳过'}</span></div>
          <div class="muted">${planTitles(db, a.plan_ids)}</div>
        </div>
      </div>`;
  }
  // 未来 pending 期次行：可跳过 / 可查看期次 / 可编辑系列
  if (occ && virtual) {
    return `
      <div class="agenda-row clickable" data-edit="${jsStr(a.id)}" title="点击编辑系列">
        <div class="agenda-time" style="color:${pcolor}">${span}</div>
        <div class="grow">
          <div class="agenda-title"><span class="plan-chip" style="background:${pcolor}"></span>${esc(a.title)} <span class="badge b-amber">待</span><span class="muted"> · 未来期次</span></div>
          <div class="muted">${planTitles(db, a.plan_ids)}</div>
        </div>
        <div class="row-gap">
          <button class="btn sm" title="跳过该期次" onclick="App.overview.skipOccurrence('${jsStr(a.id)}','${jsStr(occ.date)}')">跳过</button>
          <button class="btn sm" title="查看系列期次" onclick="App.overview.openOccurrencesModal('${jsStr(a.id)}')">📅</button>
        </div>
      </div>`;
  }
  // 当前期 / 非循环：原逻辑
  const rivals = (a.conflicts || [])
    .map((cid) => db.activities.find((x) => x.id === cid))
    .filter((o) => o && o.status === 'Planned' && overlapWin(activityWindow(a), activityWindow(o)));
  const warn = rivals.length ? `<span title="与 ${rivals.map((o) => esc(o.title)).join('、')} 时间重叠（捆绑，开始时仲裁）">⚠</span> ` : '';
  return `
    <div class="agenda-row clickable" data-edit="${jsStr(a.id)}" title="点击编辑">
      <div class="agenda-time" style="color:${pcolor}">${warn}${span}</div>
      <div class="grow">
        <div class="agenda-title"><span class="plan-chip" style="background:${pcolor}"></span>${esc(a.title)} ${badge(a.status)}${a.planned_minutes ? `<span class="muted"> · ${a.planned_minutes}m</span>` : ''}</div>
        ${a.note ? `<div class="agenda-note">📝 ${esc(a.note)}</div>` : ''}
        <div class="muted">${planTitles(db, a.plan_ids)}</div>
      </div>
      <div class="row-gap">
        <button class="btn sm timer-btn" title="按任务计时（计入 time_logs）" onclick="App.timer.openForActivity('${jsStr(a.id)}')">🍅</button>
        ${a.status === 'Planned' ? `<button class="btn sm primary" onclick="App.startAct('${jsStr(a.id)}')">开始</button>` : ''}
        ${a.status === 'Started' ? (((a.preset_expenses || []).length || (a.preset_incomes || []).length)
          ? `<button class="btn sm primary" onclick="App.quickComplete('${jsStr(a.id)}')">完成</button>`
          : `<button class="btn sm primary" onclick="App.overview.openCompleteModal('${jsStr(a.id)}')">完成</button>`) : ''}
      </div>
    </div>`;
}

// 渲染内嵌日历卡片到 host 元素（每次渲染重建，事件用事件委托）
export function renderSection(App, host) {
  if (calYear === undefined) { const d = new Date(); calYear = d.getFullYear(); calMonth = d.getMonth(); calSelected = dayKey(d); }
  const { db } = App;
  // 按日分组；循环系列展开 occurrences[] 为每日独立条目：
  //   当前期（=planned_date）→ 非虚拟（活卡，可开始/完成）；其余期次 → 虚拟条目（已办/跳过标记 or 未来待做）
  const byDay = {};
  for (const a of db.activities) {
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

  const first = new Date(calYear, calMonth, 1);
  let start = first.getDay(); start = (start + 6) % 7; // 周一为 0
  const dim = new Date(calYear, calMonth + 1, 0).getDate();
  const todayK = dayKey(new Date());

  let grid = ['一', '二', '三', '四', '五', '六', '日'].map((d) => `<div class="cal-dow">${d}</div>`).join('');
  for (let i = 0; i < start; i++) grid += '<div class="cal-day empty"></div>';
  for (let d = 1; d <= dim; d++) {
    const k = dayKey(new Date(calYear, calMonth, d));
    const acts = byDay[k] || [];
    const cost = acts.reduce((s, it) => s + (it.virtual ? 0 : App.engine.activityCost(db, it.a.id)), 0);
    grid += `
      <div class="cal-day ${k === todayK ? 'today' : ''} ${calSelected === k ? 'selected' : ''}" data-k="${k}">
        <div class="cal-d">${d}</div>
        ${acts.length ? `<div class="cal-cnt">${acts.length} 活动</div>` : ''}
        ${cost ? `<div class="cal-cost">-${cost}</div>` : ''}
      </div>`;
  }
  // 末尾补空位，保证最后一行填满（网格边线才整齐、圆角不露馅）
  const rem = (start + dim) % 7;
  if (rem) for (let i = 0; i < 7 - rem; i++) grid += '<div class="cal-day empty"></div>';

  // 当日日程：按计划开始时间排序（无时间的「全天」排在最后）
  const dayActs = (byDay[calSelected] || [])
    .map((it) => ({ a: it.a, t: timeOf(it.a.planned_start), occ: it.occ, virtual: it.virtual }))
    .sort((x, y) => (timeToMin(x.t) ?? Infinity) - (timeToMin(y.t) ?? Infinity));
  const totalMin = dayActs.reduce((s, x) => s + (x.a.planned_minutes || 0), 0);

  host.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>日历 · 当日日程</h3>
        <div class="row-gap">
          <button class="btn sm" data-cal="prev">‹ 上月</button>
          <button class="btn sm" data-cal="today">今天</button>
          <button class="btn sm" data-cal="next">下月 ›</button>
        </div>
      </div>
      <div class="cal-wrap">
        <div class="cal-grid">${grid}</div>
        <div class="cal-agenda">
        <div class="agenda-head">
          <span>${fmtDay(calSelected)}<span class="muted"> · ${dayActs.length} 项${totalMin ? ` · 预计 ${totalMin} 分钟` : ''}</span></span>
          <button class="btn sm" title="为 ${fmtDay(calSelected)} 快速添加待办" onclick="App.overview.openActModal(null,null,'${padDateKey(calSelected)}T09:00')">＋</button>
        </div>
        ${dayActs.length ? dayActs.map((x) => agendaRow(App, x.a, x.t, x.occ, x.virtual)).join('') : empty('当天无安排', '＋ 点击此处，为该日快速添加待办')}
      </div>
      </div>
    </div>
  `;

  // 事件绑定（就地重渲染后重算轮播高度，不重置页码）
  const resync = () => App.overview.refreshPagerHeight();
  host.querySelector('[data-cal="prev"]').onclick = () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } calSelected = null; renderSection(App, host); resync(); };
  host.querySelector('[data-cal="today"]').onclick = () => { const t = new Date(); calYear = t.getFullYear(); calMonth = t.getMonth(); calSelected = dayKey(t); renderSection(App, host); resync(); };
  host.querySelector('[data-cal="next"]').onclick = () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } calSelected = null; renderSection(App, host); resync(); };
  host.querySelectorAll('.cal-day[data-k]').forEach((el) => {
    el.onclick = () => { calSelected = el.dataset.k; renderSection(App, host); resync(); };
  });
  // 点击日程空白处 → 为选中日快速新建活动（行/按钮除外）
  const agenda = host.querySelector('.cal-agenda');
  if (agenda) agenda.onclick = (e) => {
    // 点击日程行卡片 → 编辑该活动（按钮/链接除外）
    const rowEl = e.target.closest('.agenda-row.clickable');
    if (rowEl) {
      if (e.target.closest('button, a, input, select, textarea')) return;
      App.overview.openActModal(rowEl.dataset.edit);
      return;
    }
    if (e.target.closest('.agenda-row, button, input, select, textarea')) return;
    App.overview.openActModal(null, null, `${padDateKey(calSelected)}T09:00`);
  };
}

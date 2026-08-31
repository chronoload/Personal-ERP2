// ============================================================
// views/stats.js
// 「统计」Tab —— 核算层（原「账本」）
//   KPI / 资源余额趋势 / 计划投入 / 活动状态分布 / 流水账本 / 价值流汇总
// 流水绝对不可变（不变量5）：无编辑无删除，只有冲正。
// ============================================================
import { esc, fmtNum, fmtDateTime, badge, openModal, toast, empty, resColor } from '../ui/helpers.js';
import { Prefs } from '../store/prefs.js';
import { themeStyle, themePickerHTML, bindThemePicker, readImageAsDataURL } from '../ui/themes.js';
import { ErrorLog } from '../services/errorLog.js';
import { buildReport, REPORT_MODULES, REPORT_MODULE_LABEL, periodRange } from '../domain/report.js';

// ---------- 全局外观主题（图片 / 渐变） ----------
export function setGlobalTheme(theme) {
  Prefs.set({ globalTheme: theme || null });
  App.applyGlobalTheme();
  App.refresh();
}
export function clearGlobalTheme() {
  Prefs.set({ globalTheme: null });
  App.applyGlobalTheme();
  App.refresh();
}

// 导入确认：预览后选择「增量合并」或「全量替换」
export function doImport(db) {
  const prev = App.backup.inspect(App.db, db);
  const m = openModal({
    title: '导入数据',
    accent: 'info',
    bodyHTML: `
      <div class="callout">备份预览：<br>
        资源：新增 <b>${prev.newRes}</b> · 同名复用 <b>${prev.sameRes}</b><br>
        目标 ${prev.goals} · 计划 ${prev.plans} · 活动 ${prev.activities} · 流水 ${prev.txs} · 产出 ${prev.outputs} · 价值流 ${prev.valueflows}
      </div>
      <p class="muted">「增量合并」：同名资源复用现有账户（引用重映射），其余按 id 去重追加，不覆盖已有数据。<br>「全量替换」：用备份整体覆盖当前数据。</p>`,
    footerHTML: `
      <button class="btn" data-cancel>取消</button>
      <button class="btn primary" data-merge>增量合并</button>
      <button class="btn danger" data-replace>全量替换</button>`,
  });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-merge]').onclick = () => { App.merge(db); m.close(); toast('已增量合并', 'ok'); };
  m.q('[data-replace]').onclick = () => { App.restore(db); m.close(); toast('已全量替换', 'ok'); };
}

// 立即执行一次本地备份（定时自动备份同款通道）
export async function backupNow() {
  const res = await App.backup.exportLocal(App.db);
  if (res.ok) {
    toast(`已备份到本地：${res.filename}`, 'ok');
    App.refresh();
  } else {
    toast(`备份失败：${res.error}`, 'err');
  }
}

// 本地备份清单：列出自/手动备份并可一键恢复 —— 让自动备份「看得见、能恢复」，不再是假备份
export async function refreshLocalBackups() {
  const box = document.getElementById('local-backups');
  if (!box) return;
  const list = await App.backup.listLocalBackups();
  if (!list.length) {
    box.innerHTML = '<div class="muted">暂无本地备份（启用定时自动备份或点「立即备份」生成）</div>';
    return;
  }
  box.innerHTML = list.slice(0, 12).map((b) => `
    <div class="tx-row" style="align-items:center">
      <div class="grow">
        <div class="muted" style="font-size:12px">📄 ${esc(b.filename)}</div>
        <div class="muted" style="font-size:11px">${b.exportedAt ? `${fmtDateTime(new Date(b.exportedAt).getTime())} · 网页端` : '安卓端 Documents/backups'}</div>
      </div>
      <button class="btn sm" onclick="App.stats.restoreLocalBackup('${jsStr(b.filename)}')">恢复</button>
    </div>`).join('');
}
export async function restoreLocalBackup(filename) {
  const list = await App.backup.listLocalBackups();
  const which = { filename, source: (list.find((x) => x.filename === filename) || {}).source || 'web' };
  const r = await App.backup.readLocalBackup(which);
  if (!r.ok) return toast(r.error, 'err');
  doImport(r.db);
}

// ---------- 局域网同步 ----------
export async function syncTest() {
  const r = await App.sync.health();
  toast(r.ok ? '连接正常' : r.error, r.ok ? 'ok' : 'err');
}

// 原生插件自检：确认 Capacitor 桥连上了 Sync 插件（排查「not implemented in Android」）
export async function syncDiag() {
  const d = await App.sync.diag();
  if (d.ping === 'ok') {
    toast(`原生插件正常：platform=${d.platform} native=${d.native} (${d.name})`, 'ok');
  } else {
    toast(`原生插件未连通：${d.error}（platform=${d.platform} native=${d.native}）`, 'err');
  }
}

export async function syncDetect() {
  const ip = await App.sync.detectLocalIP();
  if (!ip) return toast('未能自动检测 IP，请手动填写', 'err');
  const url = `http://${ip}:6920`;
  App.sync.setServer(url);
  App.refresh();
  toast(`已填入 ${url}`, 'ok');
}

export function syncCopyCmd() {
  const cmd = App.sync.startCommand(6920);
  const done = () => toast('启动命令已复制', 'ok');
  const fail = () => toast('复制失败，请手动复制', 'err');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(cmd).then(done, fail);
  else { const ta = document.createElement('textarea'); ta.value = cmd; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); }
}

// 安卓 App 内一键启动/停止同步服务（手机当服务器）
export async function syncStart() {
  const r = await App.sync.startServer(6920);
  if (!r.ok) return toast(r.error, 'err');
  const url = `http://${r.ip}:${r.port}`;
  App.sync.setServer(url);
  App.refresh();
  toast(`服务已启动：${url}`, 'ok');
}

export async function syncStop() {
  const r = await App.sync.stopServer();
  toast(r.ok ? '服务已停止' : r.error, r.ok ? 'ok' : 'err');
  App.refresh();
}

export async function syncPush() {
  const r = await App.sync.push(App.db);
  if (r.ok) { toast('已推送到服务器', 'ok'); App.refresh(); return; }
  if (r.conflict) {
    const serverAt = r.server?.exportedAt ? fmtDateTime(new Date(r.server.exportedAt).getTime()) : '未知';
    const ok = await App.system.confirm({
      title: '同步冲突',
      message: `服务器有更新数据（${serverAt}），覆盖会丢失服务器上的变更。确定覆盖？`,
    });
    if (!ok) return;
    const f = await App.sync.pushForce(App.db);
    toast(f.ok ? '已强制覆盖服务器' : f.error, f.ok ? 'ok' : 'err');
    App.refresh();
    return;
  }
  toast(r.error, 'err');
}

export async function syncPull() {
  const r = await App.sync.pull();
  if (!r.ok) return toast(r.error, 'err');
  doImport(r.db); // 复用导入确认：增量合并或全量替换
}

// 内联 onclick 字符串参数转义：反斜杠/单引号按 JS 转义，双引号按 HTML 属性转义
function jsStr(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// 颜色白名单（同 overview.js）：仅放行 #rgb~#rrggbbaa 十六进制，其余回落稳定配色，防 style 注入
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
function safeColor(c) {
  if (typeof c !== 'string') return null;
  const t = c.trim();
  return COLOR_RE.test(t) ? t : null;
}

// planned_date 存储为非补零 'YYYY-M-D'，不可用 new Date 解析；直接做字符串比较
function todayKey() {
  const t = new Date();
  return `${t.getFullYear()}-${t.getMonth() + 1}-${t.getDate()}`;
}
function isToday(a) {
  if (a.actual_start) {
    const d = new Date(a.actual_start);
    if (Number.isNaN(d.getTime())) return false;
    const t = new Date();
    return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  }
  return a.planned_date === todayKey();
}

// 流水账本防撑爆：默认只显最近 N 条，点按钮展开/收起（内存态，刷新保留）
const LEDGER_PREVIEW = 20;
let ledgerExpanded = false;
export function toggleLedger() {
  ledgerExpanded = !ledgerExpanded;
  App.refresh();
}

// ---------- 周报 / 月报 ----------
let reportPeriod = 'week';
let reportOffset = 0;
export function setReportPeriod(p) { reportPeriod = p; reportOffset = 0; App.refresh(); }
export function shiftReport(d) { reportOffset += Number(d); App.refresh(); }
function reportLabelText() {
  const { label } = periodRange(reportPeriod, reportOffset);
  const suffix = reportOffset === 0 ? '（本期）' : reportOffset < 0 ? `（${-reportOffset} 期前）` : `（${reportOffset} 期后）`;
  return `${reportPeriod === 'week' ? '周报' : '月报'} · ${label} ${suffix}`;
}
// 小指标块
function statChips(items) {
  return `<div style="display:flex;gap:18px;flex-wrap:wrap;margin:4px 0 8px">${items.map(([k, v]) =>
    `<span><b style="font-size:16px">${v}</b> <span class="muted" style="font-size:11px">${k}</span></span>`).join('')}</div>`;
}

// 查看报告弹窗：按 Prefs.reportModules 决定展示哪些模块
export function openReport() {
  const mods = Prefs.load().reportModules || {};
  const enabled = (m) => mods[m] !== false;
  const r = buildReport(App.db, { period: reportPeriod, offset: reportOffset });
  let body = '';
  if (enabled('activity')) {
    const dailies = Object.entries(r.activity.daily).sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([k, n]) => `${String(k).slice(5)}:${n}`).join(' ');
    body += `<div class="step-divider">📋 活动汇总</div>
      ${statChips([['完成', r.activity.completed], ['开始', r.activity.started], ['失败', r.activity.failed], ['新增', r.activity.created]])}
      ${dailies ? `<div class="muted" style="font-size:11px">每日完成：${esc(dailies)}</div>` : ''}`;
  }
  if (enabled('ledger')) {
    const rows = r.ledger.rows.map((e) => `
      <div class="tx-row"><div class="grow"><div class="tx-main"><b>${esc(e.name)}</b>
        <span class="amount ${e.net < 0 ? 'neg' : 'pos'}">${e.net >= 0 ? '+' : ''}${fmtNum(e.net)}</span><span class="muted"> ${esc(e.unit)}</span></div>
        <div class="muted">流入 ${fmtNum(e.debit)} · 流出 ${fmtNum(e.credit)} · ${e.n} 笔</div></div></div>`).join('');
    body += `<div class="step-divider">💸 收支流水（${r.ledger.n} 笔）</div>
      <div class="muted" style="font-size:11px;margin-bottom:6px">收入 ${fmtNum(r.ledger.incomeTotal)} · 支出 ${fmtNum(r.ledger.expenseTotal)}${r.ledger.revCount ? ` · 冲正 ${r.ledger.revCount}` : ''}</div>
      ${rows || '<div class="muted">本期无流水</div>'}`;
  }
  if (enabled('plan')) {
    const rows = r.plan.map((p) => `
      <div class="hbar-row"><span class="hbar-label">${esc(p.title)}</span><div class="hbar"><i style="width:${Math.min(100, p.budget ? (p.spend / p.budget) * 100 : 100)}%"></i></div>
      <span class="hbar-val">${fmtNum(p.spend)}${p.budget !== null ? `/${fmtNum(p.budget)}` : ''}</span></div>`).join('');
    body += `<div class="step-divider">🎯 计划投入</div>${rows || '<div class="muted">本期无计划投入</div>'}`;
  }
  if (enabled('balance')) {
    const rows = r.balance.map((b) => `
      <div class="tx-row"><div class="grow"><div class="tx-main"><b>${esc(b.name)}</b>
        <span class="amount ${b.net < 0 ? 'neg' : 'pos'}">${b.net >= 0 ? '+' : ''}${fmtNum(b.net)}</span></div>
        <div class="muted">${fmtNum(b.before)} → ${fmtNum(b.after)} ${esc(b.unit)}</div></div></div>`).join('');
    body += `<div class="step-divider">⚖️ 余额变化</div>${rows || '<div class="muted">本期无余额变化</div>'}`;
  }
  if (enabled('vf')) {
    body += `<div class="step-divider">🔄 价值流</div>
      <div class="muted">本期新增 ${r.vf.created} · 当前待反馈 ${r.vf.pending} · 已闭环 ${r.vf.closed}</div>`;
  }
  if (!body) body = '<div class="muted">未启用任何报告模块</div>';
  openModal({
    title: `${reportPeriod === 'week' ? '📊 周报' : '📊 月报'} · ${r.label}`,
    width: 560,
    bodyHTML: body,
    footerHTML: `<button class="btn" data-close>关闭</button>`,
  });
}

// ---------- 14 天累计余额（用于趋势线） ----------
function dailySeries(db, rid, n = 14) {
  const days = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    days.push({ key: d.getDate(), start: d.getTime(), end: d.getTime() + 864e5 });
  }
  const r = db.resources.find((x) => x.id === rid);
  let cum = r?.initial ?? 0;
  const series = days.map((d) => {
    let delta = 0;
    for (const t of db.txs) {
      if (t.resource_id !== rid) continue;
      if (t.created >= d.start && t.created < d.end) delta += t.debit - t.credit;
    }
    cum += delta;
    return { label: `${d.key}`, v: cum };
  });
  return series;
}

function sparkline(series, w = 240, h = 60) {
  const vals = series.map((s) => s.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const step = w / (series.length - 1 || 1);
  const pts = series.map((s, i) => {
    const x = i * step, y = h - 4 - ((s.v - min) / span) * (h - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="spark">
    <polyline fill="none" stroke="currentColor" stroke-width="1.8" points="${pts}"/>
  </svg>`;
}

// ---------- 流水账本 ----------
export function openReverseModal(txId) {
  const t = App.db.txs.find((x) => x.id === txId);
  if (!t) return;
  const r = App.db.resources.find((x) => x.id === t.resource_id);
  const max = t.debit || t.credit;
  const m = openModal({
    title: '冲正流水（不变量5：不可 UPDATE，只能追加冲正）',
    accent: 'danger',
    bodyHTML: `
      <div class="callout">原流水：${esc(r?.name || '')} ${t.debit ? '+' + t.debit : '-' + t.credit} · ${esc(t.note || t.source_type)}（${t.id}）</div>
      <div class="field"><label>冲正金额（默认全额 ${fmtNum(max)}）</label><input id="f-ramt" type="number" min="0" step="0.01" value="${Number.isFinite(max) ? max : ''}"></div>
      <div class="field"><label>原因</label><input id="f-rreason" placeholder="例：记错了"></div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>生成冲正流水</button>`,
  });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const r = App.engine.reverseTx(App.db, txId, {
      amount: m.q('#f-ramt').value, reason: m.q('#f-rreason').value,
    });
    if (!r.ok) return toast(r.error, 'err');
    m.close(); App.refresh(); toast('冲正已入账，余额自动回补');
  };
}

function txRow(App, t) {
  const r = App.db.resources.find((x) => x.id === t.resource_id);
  const isRev = !!t.reversal_of;
  const amount = t.debit ? `+${fmtNum(t.debit)}` : `-${fmtNum(t.credit)}`;
  return `
    <div class="tx-row ${isRev ? 'rev' : ''}">
      <div class="grow">
        <div class="tx-main"><span class="res-dot" style="background:${safeColor(r?.color) || resColor(t.resource_id)}"></span>
          <b>${esc(r?.name || '?')}</b>
          <span class="amount ${t.debit ? 'pos' : 'neg'}">${amount}</span>
          ${badge(t.source_type)}
          ${isRev ? '<span class="badge b-red">已冲正</span>' : ''}
        </div>
        <div class="muted">${esc(t.note || '')} · ${fmtDateTime(t.created)}</div>
      </div>
      ${!isRev ? `<button class="btn sm danger" onclick="App.stats.openReverseModal('${jsStr(t.id)}')">冲正</button>` : ''}
    </div>`;
}

// ---------- 主渲染 ----------
export function render(App, el) {
  const { db, engine } = App;
  const prefs = Prefs.load();
  const nightMode = prefs.nightTheme || 'auto';
  const mods = prefs.reportModules || {};
  const lastBackupTs = Number(prefs.lastAutoBackup) || 0;
  const lastBackupLabel = lastBackupTs ? fmtDateTime(lastBackupTs) : '从未';
  const lastSyncTs = Number(prefs.lastSyncAt) || 0;
  const lastSyncLabel = lastSyncTs ? fmtDateTime(lastSyncTs) : '从未';
  const nActive = db.activities.length;
  const nStarted = db.activities.filter((a) => a.status === 'Started').length;
  const nPlansActive = db.plans.filter((p) => p.status === 'Active').length;
  const nVfPending = db.valueflows.filter((v) => engine.vfStatus(db, v) !== 'Closed').length;
  const nToday = db.activities.filter(isToday).length;

  // 计划投入（横向条形）
  const maxCost = Math.max(1, ...db.plans.map((p) => engine.planCost(db, p.id)));
  const planBars = db.plans.map((p) => {
    const cost = engine.planCost(db, p.id);
    const w = (cost / maxCost) * 100;
    const blocked = engine.isPlanBlocked(db, p.id);
    return `
      <div class="hbar-row">
        <span class="hbar-label">${esc(p.title)}</span>
        <div class="hbar"><i class="${blocked ? 'danger' : ''}" style="width:${w}%"></i></div>
        <span class="hbar-val">${fmtNum(cost)}${p.budget !== null ? `/${fmtNum(p.budget)}` : ''}</span>
      </div>`;
  }).join('');

  // 活动状态分布
  const stCount = {};
  db.activities.forEach((a) => { stCount[a.status] = (stCount[a.status] || 0) + 1; });
  const maxSt = Math.max(1, ...Object.values(stCount));
  const stBars = Object.entries(stCount).map(([st, c]) => `
    <div class="hbar-row">
      <span class="hbar-label">${badge(st)}</span>
      <div class="hbar"><i style="width:${(c / maxSt) * 100}%"></i></div>
      <span class="hbar-val">${c}</span>
    </div>`).join('') || empty('暂无活动');

  // 资源余额 + 趋势
  const resCharts = db.resources.map((r) => {
    const b = engine.balanceOf(db, r.id);
    const series = dailySeries(db, r.id);
    return `
      <div class="trend-card">
        <div class="trend-head"><b>${esc(r.name)}</b><span class="amount ${b < 0 ? 'neg' : ''}">${fmtNum(b)} ${esc(r.unit)}</span></div>
        <div class="spark-wrap">${sparkline(series)}</div>
        <div class="muted" style="font-size:11px">近 14 天余额趋势 · 初始 ${fmtNum(r.initial)}</div>
      </div>`;
  }).join('');

  // 价值流汇总
  const vfRows = db.valueflows.map((v) => {
    const out = db.outputs.find((o) => o.id === v.output_id);
    const st = engine.vfStatus(db, v);
    return `
      <div class="vf-sum-row">
        <span class="grow">${esc(out?.title || v.output_id)} ${v.giver && v.receiver ? `（${esc(v.giver)} → ${esc(v.receiver)}）` : ''}</span>
        ${badge(st)}
        ${st !== 'Closed' ? `<button class="btn sm primary" onclick="App.overview.openFeedbackModal('${jsStr(v.id)}')">反馈</button>` : ''}
      </div>`;
  }).join('');

  el.innerHTML = `
    <section class="kpi-row">
      <div class="kpi"><div class="kpi-v">${nActive}</div><div class="kpi-l">活动总数</div></div>
      <div class="kpi"><div class="kpi-v">${nStarted}</div><div class="kpi-l">进行中</div></div>
      <div class="kpi"><div class="kpi-v">${nPlansActive}</div><div class="kpi-l">活跃计划</div></div>
      <div class="kpi"><div class="kpi-v">${nToday}</div><div class="kpi-l">今日活动</div></div>
      <div class="kpi"><div class="kpi-v">${nVfPending}</div><div class="kpi-l">待反馈价值流</div></div>
    </section>

    <div class="card">
      <div class="card-head"><h3>资源余额趋势</h3><span class="muted">不变量1：余额 = 初始 + Σ(debit−credit)</span></div>
      <div class="trend-grid">${resCharts}</div>
    </div>

    <div class="card">
      <div class="card-head"><h3>📊 周报 · 月报</h3><span class="muted">综合简报 · 模块可配置 · 支持历史期次</span></div>
      <div class="row-gap" style="flex-wrap:wrap">
        <button class="btn sm ${reportPeriod === 'week' ? 'primary' : ''}" data-rp-type="week">周报</button>
        <button class="btn sm ${reportPeriod === 'month' ? 'primary' : ''}" data-rp-type="month">月报</button>
        <span class="muted" id="rp-label">${reportLabelText()}</span>
        <button class="btn sm" data-rp-shift="-1">‹ 上一期</button>
        <button class="btn sm" data-rp-shift="1">下一期 ›</button>
        <button class="btn sm" data-rp-shift="0">本期</button>
      </div>
      <div class="row-gap" style="flex-wrap:wrap;margin-top:8px">
        ${REPORT_MODULES.map((m) => `<label class="chk"><input type="checkbox" data-rp-mod="${m}" ${mods[m] !== false ? 'checked' : ''}> ${REPORT_MODULE_LABEL[m]}</label>`).join('')}
      </div>
      <div class="row-gap" style="flex-wrap:wrap;margin-top:8px">
        <label class="chk"><input type="checkbox" id="rp-remind" ${prefs.reportRemind !== false ? 'checked' : ''}> 通知提醒（每周日 / 每月末 20:00）</label>
        <button class="btn primary" onclick="App.stats.openReport()">📄 查看报告</button>
        <button class="btn primary" onclick="App.reportSlides.openSlidesReport()">📊 智能简报</button>
      </div>
    </div>

    <section class="row-layout">
      <div class="card grow">
        <div class="card-head"><h3>计划累计投入</h3><span class="muted">19BC 预算对照（红色=硬约束触发）</span></div>
        ${planBars || empty('暂无计划')}
      </div>
      <div class="card narrow">
        <div class="card-head"><h3>活动状态分布</h3><span class="muted">五态 8C</span></div>
        ${stBars}
      </div>
    </section>

    <div class="card">
      <div class="card-head"><h3>资源流水账本</h3><span class="muted">绝对不可变 · 更正只能追加冲正（不变量5 / 6B）</span></div>
      ${(() => {
        const txsAll = db.txs.slice().reverse();
        const hidden = txsAll.length - LEDGER_PREVIEW;
        const shown = (!ledgerExpanded && hidden > 0) ? txsAll.slice(0, LEDGER_PREVIEW) : txsAll;
        const more = (!ledgerExpanded && hidden > 0)
          ? `<button class="btn sm" style="margin:10px auto 0;display:block" onclick="App.stats.toggleLedger()">⬇ 展开更早的 ${hidden} 条（共 ${txsAll.length}）</button>`
          : (ledgerExpanded ? `<button class="btn sm" style="margin:10px auto 0;display:block" onclick="App.stats.toggleLedger()">⬆ 收起，只看最近 ${LEDGER_PREVIEW} 条</button>` : '');
        return `<div class="ledger">${shown.map((t) => txRow(App, t)).join('') || empty('暂无流水')}</div>${more}`;
      })()}
    </div>

    <div class="card">
      <div class="card-head"><h3>价值流汇总</h3><span class="muted">14C 双向交换 · 15C 回充 · 16BC 闭环</span></div>
      ${vfRows || empty('产出归档后自动生成价值流')}
    </div>

    <div class="card">
      <div class="card-head"><h3>外观主题（全局背景）</h3><span class="muted">图片或渐变虚化铺满；每张任务卡片可单独设置主题背景</span></div>
      <div class="theme-preview" id="theme-preview">背景预览</div>
      <div id="theme-picker"></div>
      <div class="row-gap" style="margin-top:10px">
        <button class="btn sm" onclick="App.stats.clearGlobalTheme()">恢复默认</button>
        <span class="muted">当前选择会即时应用到整个应用背景</span>
      </div>
      <div style="margin-top:14px">
        <div class="muted" style="margin-bottom:6px">界面夜间模式</div>
        <div class="row-gap" id="night-row">
          <button class="btn sm ${nightMode === 'auto' ? 'primary' : ''}" data-night="auto">跟随系统</button>
          <button class="btn sm ${nightMode === 'light' ? 'primary' : ''}" data-night="light">浅色</button>
          <button class="btn sm ${nightMode === 'dark' ? 'primary' : ''}" data-night="dark">深色</button>
          <span class="muted">跟随系统时自动匹配设备深浅色</span>
        </div>
      </div>
      <div style="margin-top:12px">
        <label class="chk"><input type="checkbox" id="rec-enable" ${prefs.smartRecommend !== false ? 'checked' : ''}> 智能推荐（到点无活动时提示「下一步做什么」，每周 ${Number(prefs.recommendPerWeek) || 3} 次上限，可随时关闭）</label>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>桌面小组件</h3><span class="muted">安卓 AppWidget · 当日日程 / 资源状态 / 目标与计划（需在安卓桌面添加）</span></div>
      <label class="row-gap" style="align-items:center"><input type="checkbox" id="w-enabled" ${App.widget.enabled() ? 'checked' : ''}> 启用桌面小组件（关闭可恢复未改前的稳态）</label>
      <label class="row-gap" style="align-items:center;margin-top:6px"><input type="checkbox" id="w-dark" ${prefs.widgetDark ? 'checked' : ''}> 深色主题（添加小组件时也可在配置页选择）</label>
      <div class="muted" style="margin-top:6px">点击小组件任意行可直接跳转 App 对应页面；当日日程显示每项已计时长。</div>
    </div>

    <div class="card">
      <div class="card-head"><h3>数据管理</h3><span class="muted">自包含单机 · 备份 = 一份 JSON，可随时还原</span></div>
      <div class="row-gap">
        <button class="btn primary" onclick="App.backup.export(App.db)">⬇ 导出备份 (JSON)</button>
        <button class="btn" onclick="App.backup.importFromFile((db)=>App.stats.doImport(db))">⬆ 导入</button>
        <button class="btn" onclick="App.ics.export(App.db)">📅 导出日历 (ICS)</button>
        <button class="btn danger" onclick="App.reset()">♻ 清空并重新初始化</button>
      </div>
      <div class="muted" style="margin-top:8px">导入可选择「增量合并（同名资源复用账户）」或「全量替换」。</div>

      <div class="step-divider">定时自动备份（本地保存）</div>
      <label class="row-gap" style="align-items:center"><input type="checkbox" id="ab-enabled" ${prefs.autoBackup ? 'checked' : ''}> 启用定时自动备份</label>
      <div class="grid2" style="margin-top:8px">
        <div class="field"><label>备份频率</label><select id="ab-every">
          <option value="6" ${prefs.autoBackupEvery === 6 ? 'selected' : ''}>每 6 小时</option>
          <option value="24" ${(prefs.autoBackupEvery ?? 24) === 24 ? 'selected' : ''}>每天</option>
          <option value="168" ${prefs.autoBackupEvery === 168 ? 'selected' : ''}>每周</option>
          <option value="720" ${prefs.autoBackupEvery === 720 ? 'selected' : ''}>每月</option>
        </select></div>
        <div class="field"><label>上次备份</label><input id="ab-last" disabled value="${lastBackupLabel}"></div>
      </div>
      <div class="row-gap" style="margin-top:8px">
        <button class="btn sm" onclick="App.stats.backupNow()">立即备份（本地）</button>
        <button class="btn sm" onclick="App.stats.refreshLocalBackups()">刷新清单</button>
        <span class="muted">安卓端保存到 Documents/backups；网页端保存在浏览器本地（保留最近 10 份）。</span>
      </div>
      <div class="step-divider">本地备份清单（可见 · 可恢复）</div>
      <div id="local-backups"><div class="muted">加载中…</div></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>局域网同步</h3><span class="muted">FastAPI 单文件服务 · 冗余保留 10 份 · 时间戳防冲突</span></div>
      <div class="field"><label>服务器地址</label>
        <input id="sync-server" list="sync-history" value="${esc(App.sync.server())}" placeholder="http://192.168.1.100:6920">
        <datalist id="sync-history">${App.sync.history().map((h) => `<option value="${esc(h)}">`).join('')}</datalist>
      </div>
      <div class="row-gap" style="margin-top:8px">
        <button class="btn sm" onclick="App.stats.syncDetect()">🎯 自动检测</button>
        <button class="btn sm" onclick="App.stats.syncCopyCmd()">📋 复制启动命令</button>
        <button class="btn sm" onclick="App.stats.syncTest()">测试连接</button>
        <button class="btn sm" onclick="App.stats.syncDiag()">🧪 插件自检</button>
        <button class="btn primary" onclick="App.stats.syncPush()">⬆ 推送</button>
        <button class="btn" onclick="App.stats.syncPull()">⬇ 拉取</button>
      </div>
      ${App.sync.nativeAvailable() ? `
      <div class="row-gap" style="margin-top:8px">
        <button class="btn primary" onclick="App.stats.syncStart()">📡 启动服务（本机）</button>
        <button class="btn" onclick="App.stats.syncStop()">⏹ 停止服务</button>
        <span class="muted">安卓 App 内一键启动，手机当服务器</span>
      </div>` : ''}
      <div class="muted" style="margin-top:8px">上次同步：${lastSyncLabel}</div>
      <div class="callout" style="margin-top:8px">电脑上运行 <code>python sync_server.py --port 6920</code> 启动服务，点「自动检测」填入本机地址；手机/电脑填同一地址即可互相同步。历史地址可下拉选择。</div>
    </div>

    <div class="card">
      <div class="card-head"><h3>开发者 · 错误日志</h3><span class="muted">最近 ${ErrorLog.count()} 条 · 全局错误与未处理 Promise 拒绝的环形缓冲</span></div>
      <div class="row-gap">
        <button class="btn sm" id="errlog-export">导出日志</button>
      </div>
      <div class="muted" style="margin-top:8px">导出为可读文本：原生端保存到 Documents；网页端触发下载。</div>
    </div>
  `;

  const wcb = el.querySelector('#w-enabled');
  if (wcb) wcb.addEventListener('change', () => { App.widget.setEnabled(wcb.checked); App.widget.refreshNative(); toast(wcb.checked ? '已启用小组件' : '已关闭小组件', 'ok'); });

  // 小组件深色主题
  const wdark = el.querySelector('#w-dark');
  if (wdark) wdark.addEventListener('change', () => { App.widget.setDarkTheme(wdark.checked); toast(wdark.checked ? '小组件已切换为深色' : '小组件已切换为浅色', 'ok'); });

  // 定时自动备份：开关 + 频率
  const ab = el.querySelector('#ab-enabled');
  if (ab) ab.addEventListener('change', () => {
    Prefs.set({ autoBackup: ab.checked });
    toast(ab.checked ? '已启用定时自动备份' : '已关闭定时自动备份', 'ok');
  });
  const abe = el.querySelector('#ab-every');
  if (abe) abe.addEventListener('change', () => { Prefs.set({ autoBackupEvery: Number(abe.value) }); });
  refreshLocalBackups(); // 异步加载本地备份清单（native 读目录 / web 读历史）

  // 局域网同步：服务器地址
  const ss = el.querySelector('#sync-server');
  if (ss) ss.addEventListener('change', () => { App.sync.setServer(ss.value); });

  // 错误日志导出（toast 反馈由 ErrorLog.export 内部给出）
  const exBtn = el.querySelector('#errlog-export');
  if (exBtn) exBtn.addEventListener('click', () => { ErrorLog.export(); });

  // 外观主题：选择即时预览并应用
  const picker = el.querySelector('#theme-picker');
  if (picker) {
    const preview = el.querySelector('#theme-preview');
    const cur = Prefs.load().globalTheme || null;
    picker.innerHTML = themePickerHTML({ chosen: cur });
    bindThemePicker(picker, {
      onPick: (t) => { if (preview) preview.style.background = t ? themeStyle(t) : ''; setGlobalTheme(t); },
      onUpload: (f) => readImageAsDataURL(f, (url) => {
        if (!url) return toast('图片读取失败', 'err');
        const t = { type: 'image', url };
        if (preview) preview.style.background = themeStyle(t);
        setGlobalTheme(t);
      }),
    });
  }

  // 界面夜间模式：跟随系统 / 浅色 / 深色（即时应用并持久化）
  const nightRow = el.querySelector('#night-row');
  if (nightRow) {
    nightRow.querySelectorAll('[data-night]').forEach((b) => {
      b.onclick = () => {
        Prefs.set({ nightTheme: b.dataset.night });
        App.applyNightTheme();
        nightRow.querySelectorAll('[data-night]').forEach((x) => x.classList.toggle('primary', x === b));
        toast(b.dataset.night === 'dark' ? '已切换为深色主题' : b.dataset.night === 'light' ? '已切换为浅色主题' : '已跟随系统深浅色', 'ok');
      };
    });
  }

  // 周报/月报：类型切换 / 上期下期 / 模块勾选 / 提醒开关
  el.querySelectorAll('[data-rp-type]').forEach((b) => {
    b.onclick = () => { reportPeriod = b.dataset.rpType; reportOffset = 0; App.refresh(); };
  });
  el.querySelectorAll('[data-rp-shift]').forEach((b) => {
    b.onclick = () => { reportOffset += Number(b.dataset.rpShift); App.refresh(); };
  });
  el.querySelectorAll('[data-rp-mod]').forEach((c) => {
    c.addEventListener('change', () => {
      const mm = Prefs.load().reportModules || {};
      mm[c.dataset.rpMod] = c.checked;
      Prefs.set({ reportModules: mm });
    });
  });
  const rpRemind = el.querySelector('#rp-remind');
  if (rpRemind) rpRemind.addEventListener('change', () => {
    Prefs.set({ reportRemind: rpRemind.checked });
    toast(rpRemind.checked ? '已开启周/月报提醒' : '已关闭周/月报提醒', 'ok');
  });

  // 智能推荐开关（L3）：彻底停用 / 恢复
  const recEnable = el.querySelector('#rec-enable');
  if (recEnable) recEnable.addEventListener('change', () => {
    Prefs.set({ smartRecommend: recEnable.checked });
    toast(recEnable.checked ? '已开启智能推荐' : '已关闭智能推荐', 'ok');
  });
}

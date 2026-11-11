// ============================================================
// views/reportSlides.js
// 「智能简报」—— L1（智能推荐路线图）
//   把 buildReport 的新 v2 统计量渲染成一页可滑动的 6 页简报，
//   并支持 PPTX（纯前端生成，安卓/web 通用）与 PDF（打印样式）导出。
//   只读聚合层：不触碰原始账本/余额，去身份契约见 HANDOVER 蓝图。
// ============================================================
import { esc, fmtNum, openModal, empty, badge } from '../ui/helpers.js';
import { icon } from '../ui/icons.js';
import { buildReport, periodRange } from '../domain/report.js';
import { downloadPptx } from '../services/pptx.js';

// ---------- 工具 ----------
// 时长：分钟 → 中文「x 小时 y 分」
function dur(min) {
  const m = Math.round(min || 0);
  if (m <= 0) return '0';
  const h = Math.floor(m / 60), mm = m % 60;
  return h ? `${h}h${mm ? `${mm}m` : ''}` : `${mm}m`;
}
// 比值百分比（ratio 可为 null）
function pct(ratio) {
  if (ratio == null) return '—';
  return `${Math.round(ratio * 100)}%`;
}
// 偏置方向描述
function biasText(ratio) {
  if (ratio == null) return '弹性/无耗时';
  if (ratio <= 1.05) return '基本贴合';
  if (ratio <= 1.5) return '轻度超时';
  return '明显超时';
}

// ---------- 卡片块 ----------
function statChips(items) {
  return `<div class="kpi-row" style="margin:6px 0">${items.map(([k, v, warn]) =>
    `<div class="kpi"><div class="kpi-v ${warn ? 'neg' : ''}">${v}</div><div class="kpi-l">${k}</div></div>`).join('')}</div>`;
}
function hbarRow(label, val, frac, { muted = '', danger = false } = {}) {
  const w = Math.max(0, Math.min(100, Math.round((frac ?? 0) * 100)));
  return `<div class="hbar-row"><span class="hbar-label">${esc(label)}</span>
    <div class="hbar"><i class="${danger ? 'danger' : ''}" style="width:${w}%"></i></div>
    <span class="hbar-val">${val}${muted ? `<span class="muted"> ${esc(muted)}</span>` : ''}</span></div>`;
}

// ---------- 自包含轮播（复用 .dash-pager 系列 CSS，窄屏滑动 / 桌面堆叠）----------
let ngSlide = 0; // 跨渲染保留当前页
function isCarousel() { return window.matchMedia('(max-width: 860px)').matches; }
function layoutPager(p) {
  const pages = p.querySelectorAll('.dash-page');
  const track = p.querySelector('.dash-track');
  if (!pages.length || !track) return;
  const n = pages.length;
  track.style.width = `${n * 100}%`;
  pages.forEach((pg) => { pg.style.flex = `0 0 ${100 / n}%`; pg.style.minWidth = `${100 / n}%`; });
}
function goToPage(p, idx, instant) {
  if (!isCarousel()) { ngSlide = idx; return; }
  const pages = p.querySelectorAll('.dash-page');
  const track = p.querySelector('.dash-track');
  if (!pages.length || !track) return;
  const n = pages.length;
  const cur = Math.max(0, Math.min(idx, n - 1));
  if (instant) track.style.transition = 'none';
  track.style.transform = `translateX(-${(cur / n) * 100}%)`;
  if (instant) { void track.offsetWidth; track.style.transition = ''; }
  const navH = p.querySelector('.dash-nav')?.offsetHeight || 0;
  p.style.height = `${(pages[cur].offsetHeight || p.offsetHeight) + navH}px`;
  p.querySelectorAll('.dash-nav-item').forEach((b, i) => b.classList.toggle('on', i === cur));
  ngSlide = cur;
}
function bindPager(p) {
  layoutPager(p);
  goToPage(p, ngSlide, true);
  let tx = null;
  p.addEventListener('touchstart', (e) => { if (e.touches.length === 1) tx = e.touches[0].clientX; }, { passive: true });
  p.addEventListener('touchend', (e) => {
    if (tx === null) return;
    const dx = e.changedTouches[0].clientX - tx;
    tx = null;
    if (Math.abs(dx) <= 48) return;
    const items = [...p.querySelectorAll('.dash-nav-item')];
    const cur = items.findIndex((b) => b.classList.contains('on'));
    const n = p.querySelectorAll('.dash-page').length;
    const next = dx < 0 ? cur + 1 : cur - 1;
    if (next >= 0 && next < n) goToPage(p, next);
  }, { passive: true });
  p.querySelectorAll('.dash-nav-item').forEach((b) => {
    b.onclick = () => goToPage(p, Number(b.dataset.page));
  });
  window.addEventListener('resize', () => { if (p.isConnected) { layoutPager(p); goToPage(p, ngSlide, true); } });
  setTimeout(() => { if (p.isConnected) goToPage(p, ngSlide, true); }, 150);
}

// ---------- 六个页面 HTML ----------
function slideOverview(r) {
  const acts = r.actDetail.length;
  const completed = r.activity.completed, failed = r.activity.failed;
  const yieldTotal = r.valueYield.byGoal.reduce((s, g) => s + g.vfCount, 0);
  const spentMin = r.valueYield.byGoal.reduce((s, g) => s + g.spentMinutes, 0);
  const sh = r.schedHealth;
  return `
    <div class="step-divider">① 总览</div>
    ${statChips([['本期活动', acts], ['完成', completed], ['失败', failed],
      ['价值流', yieldTotal], ['投入', dur(spentMin)]])}
    <div class="step-divider" style="margin-top:10px">排程健康</div>
    ${statChips([['冲突活动', sh.actsWithConflict, sh.actsWithConflict > 0], ['守约', sh.adheredActs],
      ['定时', sh.timedActs], ['弹性', sh.flexibleActs]])}
    <div class="muted" style="font-size:12px;margin-top:6px">L1 智能简报 · 基于近一周/一期活动、流水与产出聚合。滑动或点按切换页签；桌面端纵向堆叠。</div>
  `;
}
function slideActDetail(r) {
  const rows = r.actDetail.map((a) => `
    <div class="tx-row"><div class="grow">
      <div class="tx-main"><b>${esc(a.title)}</b>
        ${badge(a.status)}
        ${a.conflictCount > 0 ? '<span class="badge b-red">冲突' + a.conflictCount + '</span>' : ''}
        ${a.failed ? `<span class="badge b-red">重试 ${a.retryCount}</span>` : ''}
      </div>
      <div class="muted" style="font-size:11px">
        计划 ${dur(a.planned_minutes)} · 实际 ${dur(a.actual_minutes)} · ${biasText(a.biasRatio)}${a.biasRatio != null ? `（${pct(a.biasRatio)}）` : ''}
        ${a.goal_count ? ` · 目标 ${a.goal_count}` : ''} · 产出 ${a.outputCount} · 价值流 ${a.vfYield}
      </div>
    </div></div>`).join('');
  return `<div class="step-divider">② 活动明细</div>${rows || empty('本期无活动')}`;
}
function slideTimeBias(r) {
  const ov = r.timeBias.overall;
  const rows = r.timeBias.byPlan.map((p) => hbarRow(p.title || p.plan_id,
    `${dur(p.totalActualMin)}/${dur(p.totalPlannedMin)} · ${pct(p.ratio)}`,
    (ov.totalPlannedMin ? p.totalPlannedMin / ov.totalPlannedMin : 0)))
    .join('');
  return `
    <div class="step-divider">③ 时间估计偏差</div>
    ${statChips([['参与活动', ov.actsWithActual], ['预计', dur(ov.totalPlannedMin)], ['实际', dur(ov.totalActualMin)], ['总体偏差', ov.ratio != null ? pct(ov.ratio) : '—', ov.ratio != null && ov.ratio > 1.5]])}
    ${rows || empty('本期无可比（需计划+实际同时非零）')}
  `;
}
function slideValueYield(r) {
  const gRows = r.valueYield.byGoal.map((g) => hbarRow(g.goal_id || '（无目标）',
    `${g.outputCount} 产出 / ${g.vfCount} 价值流 / ${dur(g.spentMinutes)}`,
    g.spentMinutes ? g.vfCount / g.spentMinutes : 0))
    .join('');
  const over = r.valueYield.byGoal.length
    ? r.valueYield.byGoal.reduce((s, g) => s + g.yieldDensity, 0) / r.valueYield.byGoal.length : 0;
  return `
    <div class="step-divider">④ 价值产出</div>
    ${statChips([['目标数', r.valueYield.byGoal.length], ['总产出', r.valueYield.byGoal.reduce((s, g) => s + g.outputCount, 0)],
      ['总价值流', r.valueYield.byGoal.reduce((s, g) => s + g.vfCount, 0)], ['平均密度', over.toFixed(3)]])}
    <div class="muted" style="font-size:12px;margin-bottom:4px">按目标聚合（产出 / 价值流 / 投入）</div>
    ${gRows || empty('本期无可结束投入的目标')}
  `;
}
function slideSchedHealth(r) {
  const sh = r.schedHealth;
  const total = sh.timedActs + sh.flexibleActs || 1;
  return `
    <div class="step-divider">⑤ 排程健康</div>
    ${statChips([['冲突活动', sh.actsWithConflict, sh.actsWithConflict > 0], ['冲突次数', sh.totalConflicts, sh.totalConflicts > 0],
      ['守约活动', sh.adheredActs], ['定时', sh.timedActs], ['弹性', sh.flexibleActs]])}
    ${hbarRow('定时占比', `${sh.timedActs}/${total}`, sh.timedActs / total)}
    ${hbarRow('守约占比', `${sh.adheredActs}/${sh.timedActs || 1}`, sh.timedActs ? sh.adheredActs / sh.timedActs : 0, { danger: sh.timedActs > 0 && sh.adheredActs / sh.timedActs < 0.6 })}
    <div class="muted" style="font-size:12px;margin-top:6px">冲突越多、守约占比越低 → L3 排程引擎的学习信号越强。</div>
  `;
}
function slideBudgetTrend(r) {
  const resRows = r.budgetTrend.resources.map((x) => hbarRow(`${x.name}（${x.unit}）`,
    `${fmtNum(x.before)} → ${fmtNum(x.after)} · ${x.net >= 0 ? '+' : ''}${fmtNum(x.net)}`,
    (x.debit + x.credit) ? x.debit / (x.debit + x.credit) : 0,
    { muted: `回充 ${fmtNum(x.debit)}` })).join('');
  const planRows = r.budgetTrend.plans.map((p) => hbarRow(p.title || p.plan_id,
    `${fmtNum(p.spend)}/${p.budget != null ? fmtNum(p.budget) : '∞'}${p.overspend ? ' ⚠超支' : ''}`,
    p.budget ? p.spend / p.budget : 0, { danger: p.overspend })).join('');
  return `
    <div class="step-divider">⑥ 预算 / 资源趋势</div>
    <div class="muted" style="font-size:12px;margin-bottom:4px">资源：期初 → 期末 · 净变化 · 回充占比</div>
    ${resRows || empty('本期无资源变动')}
    <div class="step-divider" style="margin-top:10px">计划预算</div>
    ${planRows || empty('本期无计划投入')}
  `;
}

// ---------- 主入口 ----------
export function openSlidesReport() {
  const st = window.App?.stats || {};
  const period = st.reportPeriod || 'week';
  const offset = st.reportOffset || 0;
  const r = buildReport(window.App.db, { period, offset });
  const { label } = periodRange(period, offset);

  const body = `
    <div class="dash-pager" id="report-slides">
      <nav class="dash-nav">
        ${['①总览', '②活动', '③时间', '④价值', '⑤排程', '⑥预算']
          .map((t, i) => `<button type="button" class="dash-nav-item ${i === ngSlide ? 'on' : ''}" data-page="${i}">${t}</button>`)
          .join('')}
      </nav>
      <div class="dash-track">
        ${[['总览', slideOverview(r)], ['活动明细', slideActDetail(r)], ['时间偏差', slideTimeBias(r)],
          ['价值产出', slideValueYield(r)], ['排程健康', slideSchedHealth(r)], ['预算趋势', slideBudgetTrend(r)]]
          .map(([t, html]) => `<section class="dash-page"><div class="card"><div class="card-head"><h3>${esc(t)}</h3></div>${html}</div></section>`)
          .join('')}
      </div>
    </div>
    <div class="muted" style="font-size:12px;margin-top:8px">智能简报 · ${esc(label)} · 数据去身份聚合（不显示原始流水/余额数字债务人）</div>
  `;

  const m = openModal({
    title: `📊 智能简报 · ${esc(label)}`,
    width: 620,
    bodyHTML: body,
    footerHTML: `
      <button class="btn" data-pdf>${icon('download')} PDF</button>
      <button class="btn" data-pptx>${icon('download')} PPTX</button>
      <button class="btn primary" data-close>关闭</button>`,
  });

  bindPager(m.q('#report-slides'));
  m.q('[data-close]').onclick = () => m.close();
  m.q('[data-pdf]').onclick = () => exportPDF(m.el.innerHTML);
  m.q('[data-pptx]').onclick = () => exportPPTXBuild(r, label);
}

// ---------- PDF 导出（去身份打印样式，一页一页 break-after）----------
export function exportPDF(printHTML) {
  const style = document.createElement('style');
  style.textContent = `
    @media print {
      /* 用 display:none 隔离，而非 visibility 遮罩：overlay(absolute+inset:0) 会让内容被裁成单页、
         且 visibility:hidden 不释放版面导致出现大量空白页 —— 这是“导出 PDF 空白”的根因 */
      body > *:not(#report-print) { display: none !important; }
      body, html { overflow: visible !important; height: auto !important; margin: 0 !important; }
      #report-print { position: static !important; inset: auto !important; display: block !important; }
      #report-print .report-slide {
        display: block !important;
        page-break-after: always; break-after: page;
        padding: 20px; box-sizing: border-box; margin: 0;
      }
      #report-print .report-slide:last-child { page-break-after: auto; break-after: auto; }
      #report-print .dash-nav, #report-print .dash-nav-item { display: none !important; }
      #report-print .dash-track { display: block !important; width: auto !important; transform: none !important; overflow: visible !important; }
      #report-print .dash-page { display: block !important; flex: none !important; width: auto !important; min-width: 0 !important; }
    }
  `;
  const wrap = document.createElement('div');
  wrap.id = 'report-print';
  // 去掉导航与每页外卡壳，直接输出各 slide
  wrap.innerHTML = printHTML;
  wrap.querySelectorAll('.dash-nav').forEach((n) => n.remove());
  wrap.querySelectorAll('.dash-page').forEach((pg) => pg.classList.add('report-slide'));
  document.body.appendChild(style);
  document.body.appendChild(wrap);
  window.print();
  setTimeout(() => { style.remove(); wrap.remove(); }, 700);
}

// ---------- PPTX 导出（纯前端生成，安卓 / web 通用，无需 officecli）----------
// 把当前聚合报告（去身份）编译成 6 页幻灯片，浏览器内直接下载 .pptx。
// OOXML 生成见 services/pptx.js（CompressionStream + 手写 ZIP，零依赖）。
export function exportPPTXBuild(r, label) {
  const deck = buildDeck(r, label);
  const filename = `智能简报-${label.replace(/[^\w\u4e00-\u9fa5-]+/g, '_')}.pptx`;
  downloadPptx(deck, filename)
    .then(() => {
      const m = openModal({
        title: '⬇ PPTX 已导出',
        width: 460,
        bodyHTML: `<p>已生成 <b>${esc(filename)}</b>（6 页，纯本地生成，未上传任何数据）。</p>
          <p class="muted">文件在浏览器下载目录；安卓端自动存入「下载」。内容为去身份聚合（不显示原始流水/余额/身份）。</p>`,
        footerHTML: `<button class="btn primary" data-close>完成</button>`,
      });
      m.q('[data-close]').onclick = () => m.close();
    })
    .catch((err) => openModal({
      title: '⚠ PPTX 导出失败',
      width: 420,
      bodyHTML: `<p class="muted">${esc(err?.message || err)}</p>`,
      footerHTML: `<button class="btn primary" data-close>关闭</button>`,
    }));
}

// 把 report r 翻译成 PPTX deck（{ label, slides:[{title, lines}] }），内容与屏上 6 页对齐，去身份。
function buildDeck(r, label) {
  const ov = r.schedHealth;
  const actCount = r.actDetail.length;
  const completed = r.activity.completed, failed = r.activity.failed;
  const vfTotal = r.valueYield.byGoal.reduce((s, g) => s + g.vfCount, 0);
  const spentMin = r.valueYield.byGoal.reduce((s, g) => s + g.spentMinutes, 0);
  const yieldCount = r.valueYield.byGoal.reduce((s, g) => s + g.outputCount, 0);

  const slides = [
    { title: '① 总览', lines: [
      `本期活动 ${actCount} 项 · 完成 ${completed} · 失败 ${failed}`,
      `价值流产出 ${vfTotal} 项 · 总投入 ${dur(spentMin)}`,
      `排程健康：冲突活动 ${ov.actsWithConflict} · 冲突 ${ov.totalConflicts} 次`,
      `定时活动 ${ov.timedActs} · 弹性活动 ${ov.flexibleActs} · 守约 ${ov.adheredActs}`,
    ] },
    { title: '② 活动明细', lines: r.actDetail.length
      ? r.actDetail.map((a) => `${a.title} · ${a.status} · 计划 ${dur(a.planned_minutes)} / 实际 ${dur(a.actual_minutes)}` +
        (a.biasRatio != null ? `（偏差 ${pct(a.biasRatio)}）` : '') +
        (a.conflictCount > 0 ? ` · 冲突 ${a.conflictCount}` : '') +
        (a.failed ? ` · 重试 ${a.retryCount}` : '') +
        ` · 产出 ${a.outputCount} / 价值流 ${a.vfYield}`)
      : ['本期无活动'] },
    { title: '③ 时间估计偏差', lines: (() => {
      const ov2 = r.timeBias.overall;
      const head = [`参与活动 ${ov2.actsWithActual} · 预计 ${dur(ov2.totalPlannedMin)} / 实际 ${dur(ov2.totalActualMin)} · 总体 ${ov2.ratio != null ? pct(ov2.ratio) : '—'}`];
      const rows = r.timeBias.byPlan.map((p) => `${p.title || p.plan_id}：计划 ${dur(p.totalPlannedMin)} / 实际 ${dur(p.totalActualMin)}（${pct(p.ratio)}）`);
      return head.concat(rows.length ? rows : ['本期无可比（需计划+实际同时非零）']);
    })() },
    { title: '④ 价值产出', lines: (() => {
      const head = [`目标 ${r.valueYield.byGoal.length} 个 · 总产出 ${yieldCount} · 总价值流 ${vfTotal} · 总投入 ${dur(spentMin)}`];
      const rows = r.valueYield.byGoal.map((g) => (g.goal_id || '无目标') + '：产出 ' + g.outputCount + ' / 价值流 ' + g.vfCount + ' / 投入 ' + dur(g.spentMinutes));
      return head.concat(rows.length ? rows : ['本期无可结束投入的目标']);
    })() },
    { title: '⑤ 排程健康', lines: [
      `冲突活动 ${ov.actsWithConflict} · 冲突 ${ov.totalConflicts} 次 · 守约 ${ov.adheredActs}`,
      `定时活动 ${ov.timedActs} · 弹性活动 ${ov.flexibleActs}`,
      `定时占比 ${pct(ov.timedActs / (ov.timedActs + ov.flexibleActs || 1))} · 守约占比 ${pct(ov.timedActs ? ov.adheredActs / ov.timedActs : 0)}`,
    ] },
    { title: '⑥ 预算 / 资源趋势', lines: (() => {
      const res = r.budgetTrend.resources.map((x) => `${x.name}（${x.unit}）：${fmtNum(x.before)} → ${fmtNum(x.after)}（${x.net >= 0 ? '+' : ''}${fmtNum(x.net)}）`);
      const plans = r.budgetTrend.plans.map((p) => `${p.title || p.plan_id}：投入 ${fmtNum(p.spend)} / 预算 ${p.budget != null ? fmtNum(p.budget) : '∞'}${p.overspend ? ' ⚠超支' : ''}`);
      return (res.length ? res : ['本期无资源变动']).concat(plans.length ? plans : ['本期无计划投入']);
    })() },
  ];
  return { label, slides };
}

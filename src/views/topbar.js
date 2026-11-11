// ============================================================
// views/topbar.js
// 顶栏：品牌 + 资源余额常驻（每资源独立配色圆点）+ 全局工具（计时）
// ============================================================
import { esc, fmtNum, resColor } from '../ui/helpers.js';
import { icon } from '../ui/icons.js';
import { Prefs } from '../store/prefs.js';

// 颜色白名单（同 overview.js）：仅放行 #rgb~#rrggbbaa 十六进制，其余回落稳定配色，防 style 注入
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
function safeColor(c) {
  if (typeof c !== 'string') return null;
  const t = c.trim();
  return COLOR_RE.test(t) ? t : null;
}

export function renderTopbar(App) {
  const el = document.getElementById('topbar');
  const mode = Prefs.load().topbarMode || 'full';
  // 侧边栏 / 完全收起：顶栏主体留空，侧边 dock 由 main.syncTopbarDock 渲染
  if (mode === 'left' || mode === 'right' || mode === 'hidden') { el.innerHTML = ''; el.classList.add('collapsed'); return; }
  el.classList.remove('collapsed');
  if (mode === 'full') {
    // 完整视图：品牌 + 标题 + 余额 pills + 文字按钮
    const { db } = App;
    const pills = db.resources
      .filter((r) => r.status === 'Active')
      .map((r) => {
        const b = App.engine.balanceOf(db, r.id);
        return `<span class="res-pill" style="--pill-c:${safeColor(r.color) || resColor(r.id)}" title="${esc(r.name)} 余额 = 初始 + Σ(debit−credit)">${esc(r.name)} <b>${fmtNum(b)}</b></span>`;
      }).join('');
    el.innerHTML = `
      <div class="brand">
        <div class="logo" onclick="App.timer.open()" title="计时器">P</div>
        <div class="brand-text">
          <h1>Personal ERP</h1>
          <div class="muted">个人经济系统 · 单机自包含</div>
        </div>
      </div>
      <div class="top-res">${pills}</div>
      <div class="actions">
        <button class="btn" style="background:#171a21;color:#fff;border-color:#171a21" onclick="App.overview.openBatchCreate()" title="批量创建活动">${icon('bolt')} 创建</button>
        <button class="btn ${App.hud.isEnabled() ? 'primary' : ''}" onclick="App.hud.toggle()" title="HUD 侧边栏（目标→计划→活动）">${icon('menu')}</button>
        <button class="btn timer-btn" onclick="App.timer.open()" title="计时器">${icon('clock')} 计时</button>
      </div>
    `;
    return;
  }
  // compact 顶栏紧凑：仅展示按钮（商标 logo + ⚡/☰/⏱），消除上方挤压
  el.innerHTML = `
    <div class="brand">
      <div class="logo" onclick="App.timer.open()" title="计时器">P</div>
    </div>
    <div class="actions">
      <button class="btn" style="background:#171a21;color:#fff;border-color:#171a21" onclick="App.overview.openBatchCreate()" title="批量创建活动">${icon('bolt')}</button>
      <button class="btn ${App.hud.isEnabled() ? 'primary' : ''}" onclick="App.hud.toggle()" title="HUD 侧边栏（目标→计划→活动）">${icon('menu')}</button>
      <button class="btn timer-btn" onclick="App.timer.open()" title="计时器">${icon('clock')}</button>
    </div>
  `;
}

// Tab 导航
export function renderTabs(App) {
  const el = document.getElementById('tabs');
  const items = [
    { id: 'overview', label: '活动' },
    { id: 'finance', label: '资源' },
    { id: 'diary', label: '日记' },
    { id: 'goals', label: '目标与计划' },
    { id: 'stats', label: '统计' },
  ];
  el.innerHTML = items.map((t) =>
    `<button class="tab ${App.tab === t.id ? 'on' : ''}" data-tab="${t.id}">${t.label}</button>`
  ).join('');
  el.querySelectorAll('.tab').forEach((b) =>
    b.onclick = () => App.setTab(b.dataset.tab));
}

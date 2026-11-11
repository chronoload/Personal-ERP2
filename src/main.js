// ============================================================
// main.js
// 装配根：db(store) + engine(domain) + views(ui) → window.App
// 自包含单机应用：无后端，数据在 localStorage。
// ============================================================
import { loadDB, saveDB, resetDB, ensureSeq, normalizeDB, initErpFileSync, flushErpFile, setExternalChangeHandler } from './store/db.js';
import { Prefs } from './store/prefs.js';
import { bgStyle } from './ui/themes.js';
import { openModal, toast, esc, fmtNum } from './ui/helpers.js';
import { icon } from './ui/icons.js';
import * as engine from './domain/engine.js';
import { Widget } from './services/widget.js';
import { LockScreen } from './services/lockScreen.js';
import { System } from './services/system.js';
import { Notifications } from './services/notifications.js';
import { Backup } from './services/backup.js';
import { Scheduler } from './services/scheduler.js';
import { Sync } from './services/sync.js';
import { ICS } from './services/ics.js';
import { AutoPilot } from './services/autoPilot.js';
import { ErrorLog } from './services/errorLog.js';
import { Geo } from './services/geo.js';
import * as AlarmService from './services/alarm.js';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { renderTopbar, renderTabs } from './views/topbar.js';
import * as overview from './views/overview.js';
import * as finance from './views/finance.js';
import * as goals from './views/goals.js';
import * as stats from './views/stats.js';
import * as calendar from './views/calendar.js';
import * as timer from './views/timer.js';
import * as setup from './views/setup.js';
import * as dayGuide from './views/dayGuide.js';
import * as hud from './views/hud.js';
import * as reportSlides from './views/reportSlides.js';

// 尽早安装全局错误钩子（onerror + unhandledrejection → 环形日志），后续任何初始化异常都能被记录
ErrorLog.install();

// 桌面小组件快照（预留接口的数据来源）
function widgetSnapshot(App) {
  const { db, engine } = App;
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  return {
    balances: db.resources.filter((r) => r.status === 'Active').map((r) => ({
      id: r.id, name: r.name, unit: r.unit, value: engine.balanceOf(db, r.id),
    })),
    todayActivities: db.activities.filter((a) => {
      // 循环活动：今天任一期 pending → 算今日（对齐看板/日历）
      if (a.repeat && Array.isArray(a.occurrences)) {
        return a.occurrences.some((o) => o.status === 'pending' && String(o.date) === todayKey);
      }
      if (a.actual_start) {
        const d = new Date(a.actual_start);
        return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
      }
      return !!a.planned_date && String(a.planned_date) === todayKey;
    }).length,
    nextActivity: (() => {
      const msOf = (a) => { const t = new Date(String(a.planned_start || '')).getTime(); return Number.isNaN(t) ? Infinity : t; };
      const list = db.activities
        .filter((a) => a.status === 'Planned' || a.status === 'Started')
        .slice()
        .sort((x, y) => msOf(x) - msOf(y)); // 最早的排最前；无计划时间/弹性项沉底
      if (!list.length) return null;
      return { title: list[0].title, status: list[0].status };
    })(),
    pendingValueFlows: db.valueflows.filter((v) => engine.vfStatus(db, v) !== 'Closed').length,
  };
}

// 日记页懒加载：Vditor 整包只在首次进入「日记」Tab 时拉取，首屏不再背负它
let diaryMod = null;
const diaryLazy = {
  render(App, el) {
    if (diaryMod) return diaryMod.render(App, el);
    el.innerHTML = '<div class="card"><div class="muted" style="padding:12px">加载日记编辑器…</div></div>';
    import('./views/diary.js').then((m) => {
      diaryMod = m;
      m.render(App, el);
    }).catch((e) => {
      el.innerHTML = `<div class="card"><div class="fb warn">日记页加载失败：${esc(e && e.message || e)}</div></div>`;
    });
  },
  refresh() { if (diaryMod && diaryMod.refresh) diaryMod.refresh(); },
};

const TAB_VIEWS = { overview, diary: diaryLazy, finance, goals, stats };
// 日记放在「资源」之后：先看账户，再用叙述记录当天（资源 → 日记 → 目标）
const TAB_ORDER = ['overview', 'finance', 'diary', 'goals', 'stats'];

// ---- Tab 视图缓存（初次懒加载 + 持久容器）----
// 每个 tab 一个永久容器：首次进入才渲染（懒加载），切回只切换显隐、不重建。
// 这样最重的 overview（含 Vditor 编辑器）在切换间不再 destroy+重建，显著提速。
// refresh() 会强制重建当前 tab，保证数据最新；其余 tab 容器保持缓存。
const viewCache = new Map();   // id -> 容器 el
const viewReady = new Set();   // 已渲染的 id
let forceRenderId = null;      // 由 refresh() 置位 → 当前 tab 强制重建

function viewContainer(id) {
  let c = viewCache.get(id);
  if (c) return c;
  c = document.createElement('div');
  c.className = 'app-view';
  c.dataset.view = id;
  c.style.display = 'none';
  document.getElementById('content').appendChild(c);
  viewCache.set(id, c);
  return c;
}

function renderViewInto(App, id) {
  const c = viewContainer(id);
  c.innerHTML = '';
  const view = TAB_VIEWS[id];
  try {
    view.render(App, c);
  } catch (e) {
    ErrorLog.log('error', `渲染视图「${id}」失败：${(e && e.message) || e}`, e);
    c.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>页面渲染出错</h3><span class="muted">该页面暂时无法显示，其余功能不受影响</span></div>
        <p class="muted">已记入错误日志。</p>
        <button class="btn sm" onclick="App.errorLogExport()">导出日志</button>
      </div>`;
  }
  viewReady.add(id);
  return c;
}

// 激活指定 tab：首次懒渲染，之后只显隐；forceRenderId 命中时强制重建（数据刷新）
function activateTab(App, id) {
  // 活动页每次进入：先把「到期 / 超期」的活动推进到进行中（再渲染，避免闪一下旧状态）
  if (id === 'overview') {
    try {
      const r = engine.autoStartDue(App.db, Date.now());
      if (r.ok && r.count) {
        saveDB(App.db);
        forceRenderId = 'overview'; // 数据已变，强制重建当前视图
        toast(`${r.count} 个到期活动已自动进入进行中`, 'info');
      }
    } catch (e) { /* 扫描失败不阻塞渲染 */ }
  }
  const c = viewContainer(id);
  const mustForce = forceRenderId === id;
  if (forceRenderId) forceRenderId = null;
  if (!viewReady.has(id) || mustForce) renderViewInto(App, id);
  c.style.display = '';
  if (c.parentElement) {
    for (const sib of c.parentElement.children) {
      if (sib !== c && sib.classList && sib.classList.contains('app-view')) sib.style.display = 'none';
    }
  }
  // 活动页重新可见：轮播高度可能残留隐藏期测出的 0（键盘开合期的 resize），重测自愈
  if (id === 'overview' && viewReady.has(id)) {
    setTimeout(() => { try { overview.refreshPagerHeight(); } catch (e) { /* 忽略 */ } }, 60);
  }
}

const App = {
  db: loadDB(),
  engine,
  tab: 'overview',
  tabOrder: TAB_ORDER, // 全局 Tab 序（overview 轮播右边界滑入「下一个 Tab」用，勿再硬编码）
  // 系统服务接口（预留：小组件 / 系统提示 / 系统通知 / 备份）
  widget: Widget, system: System, notifications: Notifications, backup: Backup, sync: Sync, ics: ICS, geo: Geo, lockScreen: LockScreen,
  // 视图扁平暴露给内联 handler（App.calendar.open() 等）
  overview, diary: diaryLazy, finance, goals, stats, calendar, timer, dayGuide, hud, reportSlides,
  setTab(id) { this.tab = id; this.render(true); window.scrollTo({ top: 0 }); },
  // 统一启动入口：撞上捆绑冲突时弹三选一仲裁（先做这个 / 让对方先 / 取消）
  startAct(id) {
    const r = this.engine.startActivity(this.db, id);
    if (!r.ok) { toast(r.error, 'err'); return; }
    if (r.conflict_choice) {
      const c = r.conflict_choice;
      const names = c.others.map((o) => `「${esc(o.title)}」`).join('、');
      const m = openModal({
        title: '⏱ 时间冲突',
        bodyHTML: `<p>「${esc(c.self.title)}」与 ${names} 时间重叠（捆绑对）。</p><p class="muted">谁先做？</p>`,
        footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn" data-defer>让对方先</button><button class="btn primary" data-first>先做这个</button>`,
      });
      m.q('[data-cancel]').onclick = () => m.close();
      m.q('[data-first]').onclick = () => {
        const rr = this.engine.startActivity(this.db, id, { override: 'first' });
        m.close();
        if (!rr.ok) return toast(rr.error, 'err');
        toast(`已开始；${names} 自动顺延`, 'ok');
        this.refresh();
      };
      m.q('[data-defer]').onclick = () => {
        const rr = this.engine.startActivity(this.db, id, { override: 'defer' });
        m.close();
        if (!rr.ok) return toast(rr.error, 'err');
        toast(`已改约至 ${(rr.moved_to || '').replace('T', ' ')}`, 'ok');
        this.refresh();
      };
      return; // 仲裁中无状态变化，不刷新
    }
    this.refresh();
  },
  // 一键完成（活动预设收支）：入账后弹极轻确认条「有要改的吗」，不改则已入账
  quickComplete(id) {
    const r = this.engine.quickCompletePreset(this.db, id);
    if (!r.ok) return toast(r.error, 'err');
    const s = r.summary;
    const parts = [];
    for (const e of (s.expenses || [])) parts.push(`支出 ${fmtNum(e.amount)}${e.note ? '（' + e.note + '）' : ''}`);
    for (const i of (s.incomes || [])) parts.push(`收入 ${fmtNum(i.amount)}${i.note ? '（' + i.note + '）' : ''}`);
    this.refresh();
    const bar = document.createElement('div');
    bar.id = 'ap-qc-bar';
    bar.style.cssText = [
      'position:fixed', 'left:50%', 'transform:translateX(-50%)', 'bottom:calc(20px + env(safe-area-inset-bottom, 0px))', 'z-index:50',
      'display:flex', 'align-items:center', 'gap:10px', 'padding:10px 14px', 'border-radius:12px',
      'background:#1d2330', 'color:#fff', 'box-shadow:0 6px 24px rgba(0,0,0,.25)',
      'max-width:min(92vw,560px)',
    ].join(';');
    bar.innerHTML =
      `<span style="flex:1">${icon('check')} 已入账 ${parts.join(' / ')} · 产出「${esc(s.output_title)}」</span>` +
      `<button class="btn sm" data-qc-edit>有要改的吗</button>` +
      `<button class="btn sm primary" data-qc-close>关闭</button>`;
    bar.querySelector('[data-qc-close]').onclick = () => bar.remove();
    bar.querySelector('[data-qc-edit]').onclick = () => {
      bar.remove();
      this.overview.openAmendModal(id);
    };
    document.body.appendChild(bar);
    // 15 秒未处理自动消失（入账已完成，只是确认环节）
    setTimeout(() => { if (bar.isConnected) bar.remove(); }, 15000);
  },
  applyGlobalTheme() {
    document.body.style.background = bgStyle(Prefs.load().globalTheme || null) || '';
  },
  // 界面夜间模式：'dark' 强制深色 / 'light' 强制浅色 / 'auto' 跟随系统
  // 通过 <html data-theme> 驱动 app.css 的暗色覆盖；同时同步状态栏 theme-color
  applyNightTheme() {
    const mode = Prefs.load().nightTheme || 'auto';
    const dark = mode === 'dark' || (mode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#131722' : '#f4f5f7');
    // Vditor 编辑器背景即时跟随（编辑器常驻缓存，不重建；setTheme 切换 vditor--dark 类）
    // 两个编辑器各自注册钩子：活动工作台（__wsApplyTheme）+ 日记页（__diaryApplyTheme）。
    // 二者共用同一个 Vditor 实例池但归属不同视图，所以不能只广播一个。
    if (window.__wsApplyTheme) { try { window.__wsApplyTheme(dark); } catch (e) { /* 忽略 */ } }
    if (window.__diaryApplyTheme) { try { window.__diaryApplyTheme(dark); } catch (e) { /* 忽略 */ } }
  },
  // 刷新保留滚动位置，避免点击后页面跳顶/脱离焦点；不重放入场动画。
  // 置 forceRenderId：本次渲染强制重建当前 tab（数据刷新），其余 tab 容器保持不变缓存。
  refresh() {
    forceRenderId = this.tab;
    const sy = window.scrollY;
    this.render(false);
    requestAnimationFrame(() => window.scrollTo(0, sy));
  },
  async reset() {
    if (!(await System.confirm({ title: '重置数据', message: '清空全部数据并恢复演示数据？' }))) return;
    this.db = resetDB();
    this.render(true);
    window.scrollTo({ top: 0 });
  },
  // 从备份导入：替换库并修复 seq（先归一化残缺实体，防渲染 TypeError）
  // ★ 替换前自动本地快照一份当前数据——即使导入了坏备份也能从 Documents/backups 找回
  restore(db) {
    try {
      normalizeDB(db);
      ensureSeq(db);
    } catch (e) {
      toast(`导入失败：${e.message || '备份结构异常'}`, 'err');
      return;
    }
    Backup.exportLocal(this.db).catch(() => {}); // 快照失败不阻断（静默通道）
    this.db = db;
    this.render(true);
    window.scrollTo({ top: 0 });
    toast('已全量替换（替换前的数据已自动备份）', 'ok');
  },
  // 增量合并导入：同名资源复用现有账户，其余按 id 去重追加
  // ★ mergeImport 为纯函数：中途失败会抛异常且原库分毫不动，不再可能半残持久化
  merge(incoming) {
    try {
      this.db = Backup.merge(this.db, incoming);
      normalizeDB(this.db);
    } catch (e) {
      toast(`增量合并失败，数据未改动：${e.message || '备份内容异常'}`, 'err');
      return;
    }
    this.render(true);
  },
  render(animate) {
    saveDB(this.db); // 每次变更后持久化（单机自包含）
    this.applyGlobalTheme();
    this.applyNightTheme();
    renderTopbar(this);
    const content = document.getElementById('content');
    content.classList.toggle('anim-in', !!animate);
    // 首次初始化：无资源 → 引导配置资源
    const tabsEl = document.getElementById('tabs');
    if (!this.db.resources.length) {
      tabsEl.style.display = 'none';
      viewCache.clear(); viewReady.clear(); forceRenderId = null; // 丢弃旧视图缓存，避免 reset 后残留
      content.innerHTML = '';
      setup.render(this, content);
      Widget.push(widgetSnapshot(this));
      Scheduler.syncValueflowNotifs(this.db);
      return;
    }
    tabsEl.style.display = '';
    renderTabs(this);
    // 首次建立 tab 容器时，清掉 content 里可能残留的 setup 内容
    if (!content.querySelector('.app-view')) content.innerHTML = '';
    activateTab(this, this.tab); // 懒渲染 + 显隐切换（切回不重建）
    // 编辑器缓冲区重置：外部改库（目标页/小组件/备份恢复/同步）后，若缓冲无未提交编辑，
    // 用 db 重组当前视图——否则陈旧缓冲会在下次 sync 把外部修改改回去
    if (window.__wsReloadFromDb) { try { window.__wsReloadFromDb(); } catch (e) { /* 忽略 */ } }
    Widget.push(widgetSnapshot(this)); // 维护小组件快照（预留）
    Widget.refreshNative();
    Scheduler.syncValueflowNotifs(this.db); // 待反馈价值流系统通知（16C）
    Scheduler.syncAutoBackup(this.db);      // 定时自动备份（本地保存）
    Scheduler.syncPeriodicReportReminders(); // 周/月报通知提醒（每周日/每月末）
    AlarmService.syncAlarms(this.db);        // 日程提醒闹钟：为 Planned 活动到点响铃（diff 幂等）
    syncTopbarDock();                         // 上部布局：顶栏紧凑 / 侧边栏 / 完全收起
    hud.refresh();                            // HUD 侧边栏数据同步（仅开启时渲染）
    Geo.sync(this.db);                        // 地点变更 → 幂等重注册原生围栏（无变化直接跳过）
  },
};

// 上部整体布局：侧边栏模式在屏幕左/右边缘渲染整条 dock（商标 + 创建 + HUD + 计时）；
// 完全收起 → 顶栏与 dock 均隐藏（功能仍可从内容区进入）
function syncTopbarDock() {
  const mode = Prefs.load().topbarMode || 'top';
  const body = document.body;
  let dock = document.getElementById('topbar-dock');
  if (mode === 'left' || mode === 'right') {
    if (!dock) { dock = document.createElement('div'); dock.id = 'topbar-dock'; body.appendChild(dock); }
    dock.className = 'topbar-dock ' + mode;
    dock.innerHTML = `
      <button class="dock-logo" onclick="App.timer.open()" title="计时器">P</button>
      <button class="btn" onclick="App.overview.openBatchCreate()" title="批量创建活动">${icon('bolt')}</button>
      <button class="btn ${App.hud.isEnabled() ? 'primary' : ''}" onclick="App.hud.toggle()" title="HUD 侧边栏（目标→计划→活动）">${icon('menu')}</button>
      <button class="btn timer-btn" onclick="App.timer.open()" title="计时器">${icon('clock')}</button>`;
    dock.style.display = '';
  } else if (dock) {
    dock.style.display = 'none';
  }
}

// Tab 左右滑动切换（活动 ⇄ 目标与计划 ⇄ 统计）
(function setupSwipe() {
  const content = document.getElementById('content');
  let start = null;
  content.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { start = null; return; }
    if (e.target.closest('.modal-mask, .timer-overlay, input, select, textarea, .modal-panel, .dash-pager')) { start = null; return; }
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  content.addEventListener('touchend', (e) => {
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    start = null;
    if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      const idx = TAB_ORDER.indexOf(App.tab);
      const next = dx < 0 ? idx + 1 : idx - 1; // 左滑 → 下一个；右滑 → 上一个
      if (TAB_ORDER[next]) App.setTab(TAB_ORDER[next]);
    }
  }, { passive: true });
})();

window.App = App;
App.errorLogExport = () => ErrorLog.export(); // 渲染降级卡片的日志导出入口（只挂一次）

// 地理围栏对账：原生事件到达 / App 回前台时排空队列，按序更新 currentPlaceId。
// Doze 或进程被杀期间的事件落在原生 SharedPreferences 队列里，不会丢。
Geo.listen(() => {
  Geo.reconcile(App.db).then((r) => { if (r) App.refresh(); }).catch(() => {});
});
System.onResume(() => {
  Geo.reconcile(App.db)
    .then((r) => { if (r) App.refresh(); })
    .catch(() => {})
    .finally(() => Geo.sync(App.db));
});
Geo.reconcile(App.db).then((r) => { if (r) App.refresh(); }).catch(() => {});
Geo.sync(App.db);

// Android 硬件返回键闭环：返回键优先逐层退出浮层（弹窗 → 引导 → 计时 → 确认/提示/推荐条），
// 再回退 Tab（非首页 → 首页），最后才退出应用。没有它，任何弹窗打开时按返回 = 直接杀掉 App。
// 仅原生平台注册（web 的 App 插件无 backButton 实现，注册会抛 _pendingBack 空指针）。
if (Capacitor.isNativePlatform() && CapApp.addListener) {
  CapApp.addListener('backButton', () => {
    // 1) 通用弹窗（含确认删除/完成面板/报表 deck）
    const mask = document.querySelector('.modal-mask');
    if (mask) {
      const closeBtn = mask.querySelector('[data-close]') || mask.querySelector('[data-cancel]');
      if (closeBtn) closeBtn.click();
      else mask.remove(); // 兜底：无关闭钮的遮罩直接撤（与点遮罩关闭同语义）
      return;
    }
    // 2) 新一天引导
    const dg = document.getElementById('dayGuide');
    if (dg && dg.classList.contains('show')) {
      const skip = [...dg.querySelectorAll('button')].find((b) => b.textContent.trim() === '先跳过');
      if (skip) skip.click(); else dg.classList.remove('show');
      return;
    }
    // 3) 全屏编辑模式（先于计时：编辑器卡片 z 层在其下但语义上属于当前工作面）
    if (document.querySelector('.card.ws-full') && window.__wsExitFull) { window.__wsExitFull(); return; }
    // 4) 全屏计时
    const tClose = document.querySelector('.timer-overlay [data-close], .timer-overlay .t-close');
    if (tClose) { tClose.click(); return; }
    // 5) AutoPilot 确认/收尾/推荐条（单实例，逐条退出）
    for (const id of ['ap-rec-bar', 'ap-tip-bar', 'ap-confirm-bar']) {
      const bar = document.getElementById(id);
      if (bar) { bar.remove(); return; }
    }
    const qc = document.getElementById('ap-qc-bar');
    if (qc) { qc.remove(); return; }
    // 6) 非首页 Tab → 回首页；首页 → 交回系统（退出）
    if (App.tab !== 'overview') { App.setTab('overview'); return; }
    CapApp.exitApp();
  });
}

// 双向同步（原生 → JS）：启动与每次回前台时，若桌面小组件独立操作过（rev 变大），
// 用原生数据覆盖本地并重渲染。pushData 的 txs 合并负责反方向，二者互补成闭环。
async function syncFromNative() {
  try {
    // 1) 先取原生待回读流水（不依赖 rev，最可靠）
    const p = await Widget.pullPending();
    // 2) 再按修订号拉整库（其他桌面操作：开始任务、主题等）
    const r = await Widget.pullFromNative();
    if (p.changed || r.changed) { App.db = loadDB(); App.render(false); }
    // 回前台立即把最新 db 推给小组件（「核心 → 小组件」即时同步，不等下一次渲染）
    Widget.refreshNative();
  } catch (e) {}
}
syncFromNative();
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncFromNative(); });
// 安卓回前台：MainActivity.onResume 显式触发（visibilitychange 在部分 ROM 上不可靠）
window.addEventListener('erpResume', () => syncFromNative());

// 计时器跨进程恢复：被杀后台后按时间戳相对计时，重启自动接续；
// restoreNative 兜底 WebView 存储被系统清理的场景（从 SharedPreferences 回捞）
timer.restore();
timer.restoreNative();

// 桌面小组件点击跳转：MainActivity 触发 window 事件，切到对应 Tab（fresh=直接弹新建，date=预填日期）
window.addEventListener('erpLaunchTab', (e) => {
  const d = e.detail || {};
  if (d.tab && TAB_ORDER.includes(d.tab)) App.setTab(d.tab);
  if (d.fresh) {
    const pad = (k) => {
      const m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(k || ''));
      return m ? `${m[1]}-${String(+m[2]).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}` : null;
    };
    const start = pad(d.date) ? `${pad(d.date)}T09:00` : null;
    setTimeout(() => overview.openActModal(null, null, start), 350);
  }
});

// 系统深浅偏好变化：仅「跟随系统」模式实时切换，手动选择后不打扰
(() => {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => { if ((Prefs.load().nightTheme || 'auto') === 'auto') App.applyNightTheme(); };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if (mq.addListener) mq.addListener(onChange);
})();

// 桌面 Tauri：启用 erp-db.json 文件后端（外部程序 / 定时任务热加载）。
// 启动时若 erp-db.json 存在（MCP 已写入微信巡检事项），用其覆盖内存库并刷新；
// 之后每 5s 轮询，外部改动自动并入并热刷新 UI。web / 原生环境自动跳过（isTauri 为 false）。
setExternalChangeHandler(() => App.render(false));
initErpFileSync()
  .then(async (fileDb) => {
    if (fileDb) { App.db = fileDb; App.render(false); }
    // 安卓：外部访问开关打开时，启动即拉起本机 MCP 端点（开关即启停，与设置页同一语义）
    if (App.db.mcp && App.db.mcp.enabled && App.sync.nativeAvailable()) {
      const flushed = await flushErpFile(App.db);
      if (!flushed) console.warn('[mcp] erp-db.json 写入失败，端点可能读不到数据');
      try {
        const r = await App.sync.startServer(6920);
        if (r && r.ok) console.info(`[mcp] 已启动：http://${r.ip}:${r.port}/mcp`);
        else console.warn('[mcp] 启动失败：', r && r.error);
      } catch (e) { console.warn('[mcp] 启动异常：', e); }
    }
  })
  .catch((e) => console.error('[erp-file] 引导失败，回落 localStorage：', e));

App.render(true);

// 新一天引导：每天首次启动弹出（模块内部自带「当天已展示」与「未初始化」短路）
dayGuide.maybeShow(App);

// 待排程面板：每个 App 进程启动后自动弹一次（有「未指派时间」的活动才弹；有别的模态时排队）
overview.maybeOpenSchedulerBoard();

// 自动驾驶巡检：到点询问 / 提前提醒 / 收尾超时提示（模块内自带防重入与静默纪律）
AutoPilot.start(App);

// F2 提醒依赖系统通知权限：每次启动请求一次（仅权限为「未询问」时才弹系统对话框，已授权/已拒绝均静默）
Notifications.requestPermission();

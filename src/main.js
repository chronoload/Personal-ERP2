// ============================================================
// main.js
// 装配根：db(store) + engine(domain) + views(ui) → window.App
// 自包含单机应用：无后端，数据在 localStorage。
// ============================================================
import { loadDB, saveDB, resetDB, ensureSeq, normalizeDB } from './store/db.js';
import { Prefs } from './store/prefs.js';
import { bgStyle } from './ui/themes.js';
import { openModal, toast, esc, fmtNum } from './ui/helpers.js';
import * as engine from './domain/engine.js';
import { Widget } from './services/widget.js';
import { System } from './services/system.js';
import { Notifications } from './services/notifications.js';
import { Backup } from './services/backup.js';
import { Scheduler } from './services/scheduler.js';
import { Sync } from './services/sync.js';
import { ICS } from './services/ics.js';
import { AutoPilot } from './services/autoPilot.js';
import { ErrorLog } from './services/errorLog.js';
import { renderTopbar, renderTabs } from './views/topbar.js';
import * as overview from './views/overview.js';
import * as goals from './views/goals.js';
import * as stats from './views/stats.js';
import * as calendar from './views/calendar.js';
import * as timer from './views/timer.js';
import * as setup from './views/setup.js';
import * as dayGuide from './views/dayGuide.js';
import * as hud from './views/hud.js';

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
    todayActivities: db.activities.filter((a) =>
      (a.actual_start ? new Date(a.actual_start) : (a.planned_date ? new Date(a.planned_date + 'T00:00') : null)) &&
      (a.actual_start ? (() => {
        const d = new Date(a.actual_start);
        return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
      })() : a.planned_date === todayKey)
    ).length,
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

const TAB_VIEWS = { overview, goals, stats };
const TAB_ORDER = ['overview', 'goals', 'stats'];

const App = {
  db: loadDB(),
  engine,
  tab: 'overview',
  // 系统服务接口（预留：小组件 / 系统提示 / 系统通知 / 备份）
  widget: Widget, system: System, notifications: Notifications, backup: Backup, sync: Sync, ics: ICS,
  // 视图扁平暴露给内联 handler（App.calendar.open() 等）
  overview, goals, stats, calendar, timer, dayGuide, hud,
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
      'position:fixed', 'left:50%', 'transform:translateX(-50%)', 'bottom:20px', 'z-index:50',
      'display:flex', 'align-items:center', 'gap:10px', 'padding:10px 14px', 'border-radius:12px',
      'background:#1d2330', 'color:#fff', 'box-shadow:0 6px 24px rgba(0,0,0,.25)',
      'max-width:min(92vw,560px)',
    ].join(';');
    bar.innerHTML =
      `<span style="flex:1">✓ 已入账 ${parts.join(' / ')} · 产出「${esc(s.output_title)}」</span>` +
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
  },
  // 刷新保留滚动位置，避免点击后页面跳顶/脱离焦点；不重放入场动画
  refresh() {
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
      content.innerHTML = '';
      setup.render(this, content);
      Widget.push(widgetSnapshot(this));
      Scheduler.syncValueflowNotifs(this.db);
      return;
    }
    tabsEl.style.display = '';
    renderTabs(this);
    content.innerHTML = '';
    const view = TAB_VIEWS[this.tab] || overview;
    try {
      view.render(this, content);
    } catch (e) {
      // 渲染隔离：单个视图崩溃不拖垮整个应用，异常落入环形错误日志
      ErrorLog.log('error', `渲染视图「${this.tab}」失败：${(e && e.message) || e}`, e);
      content.innerHTML = `
        <div class="card">
          <div class="card-head"><h3>页面渲染出错</h3><span class="muted">该页面暂时无法显示，其余功能不受影响</span></div>
          <p class="muted">已记入错误日志。</p>
          <button class="btn sm" onclick="App.errorLogExport()">导出日志</button>
        </div>`;
    }
    Widget.push(widgetSnapshot(this)); // 维护小组件快照（预留）
    Widget.refreshNative();
    Scheduler.syncValueflowNotifs(this.db); // 待反馈价值流系统通知（16C）
    Scheduler.syncAutoBackup(this.db);      // 定时自动备份（本地保存）
    Scheduler.syncPeriodicReportReminders(); // 周/月报通知提醒（每周日/每月末）
    hud.refresh();                            // HUD 侧边栏数据同步（仅开启时渲染）
  },
};

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

// 双向同步（原生 → JS）：启动与每次回前台时，若桌面小组件独立操作过（rev 变大），
// 用原生数据覆盖本地并重渲染。pushData 的 txs 合并负责反方向，二者互补成闭环。
async function syncFromNative() {
  try {
    const r = await Widget.pullFromNative();
    // rev 更新即原生库较新：重载内存库再渲染，否则 render 的 saveDB 会把旧内存库回写、吞掉原生侧变更
    if (r.changed) { App.db = loadDB(); App.render(false); }
    // 回前台立即把最新 db 推给小组件（「核心 → 小组件」即时同步，不等下一次渲染）
    Widget.refreshNative();
  } catch (e) {}
}
syncFromNative();
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncFromNative(); });

// 计时器跨进程恢复：被杀后台后按时间戳相对计时，重启自动接续；
// restoreNative 兜底 WebView 存储被系统清理的场景（从 SharedPreferences 回捞）
timer.restore();
timer.restoreNative();

// 桌面小组件点击跳转：MainActivity 触发 window 事件，切到对应 Tab（fresh=直接弹新建）
window.addEventListener('erpLaunchTab', (e) => {
  const d = e.detail || {};
  if (d.tab && TAB_ORDER.includes(d.tab)) App.setTab(d.tab);
  if (d.fresh) setTimeout(() => overview.openActModal(), 350);
});

// 系统深浅偏好变化：仅「跟随系统」模式实时切换，手动选择后不打扰
(() => {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => { if ((Prefs.load().nightTheme || 'auto') === 'auto') App.applyNightTheme(); };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if (mq.addListener) mq.addListener(onChange);
})();

App.render(true);

// 新一天引导：每天首次启动弹出（模块内部自带「当天已展示」与「未初始化」短路）
dayGuide.maybeShow(App);

// 自动驾驶巡检：到点询问 / 提前提醒 / 收尾超时提示（模块内自带防重入与静默纪律）
AutoPilot.start(App);

// F2 提醒依赖系统通知权限：每次启动请求一次（仅权限为「未询问」时才弹系统对话框，已授权/已拒绝均静默）
Notifications.requestPermission();

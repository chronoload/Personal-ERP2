// ============================================================
// views/workspace.js
// Markdown 编辑器卡片（活动 Tab「📝 编辑器」页）——单一文本编辑兼展示器（Vditor）：
//   「视图」= 对 db 的一次重排，切换只是把 db 组织成不同语义的 md 填进同一个编辑器
//   （🗂目标层级 / 📅日 / 🗓周 / 📆月），可直接按文本编辑，无任何其他交互组件（vim/终端式）。
//   实时同步：编辑 md（防抖）即写回 db——无需手动「应用」。
//   完成态认真处理：勾选 [x] 非法流转（如 Planned→Completed）→ 不落库、回滚该行为 db 实际状态
//   并明确提示「需在 App 内走 开始→登记收支产出→完成」；Completed 不回退。
//   镜像（目标视图）缺失即删 → 弹确认后级联删；取消则本轮忽略不反复打扰。
//   db 是唯一真源；md 是它的可交换视图面。
// 导出 .md：把 lute 链接式 id 归一化回可读注释。
// Vditor 实例生命周期：render 重建前 destroy 旧实例。
// ============================================================
import { serializeDbToMd, serializeEntityLine, replaceEntityLine, parseMdImport, normalizeIdMarkers, bindEntityLine, repairIdMarkers } from '../domain/mdimport.js';
import { applyCandidates, applyDeletions } from '../domain/mdapply.js';
import { organizeDay, organizeWeek, organizeMonth, dkey, todayKey, parseKey, addDays } from './mdviews.js';
import { Prefs } from '../store/prefs.js';
import { saveDB } from '../store/db.js';
import { toast, esc, openModal } from '../ui/helpers.js';
import { icon } from '../ui/icons.js';
import { saveFile } from '../services/saveFile.js';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import VditorZh from '../ui/vditorI18n.js';

let vd = null; // 当前 Vditor 实例（render 重建时销毁）
let curView = 'goal'; // 当前视图：goal | day | week | month（模块级，跨 render 保留）
let viewAnchor = null; // 当前视图锚点日期（YYYY-M-D；null = 今天，跨 render 保留）
let CURRENT_APP = null; // 完成面板回调用的 App 引用（跨 render 保留）
let completeQueue = []; // 待唤起完成面板的活动（勾选 [x] 但需走完成流程）
let completing = false; // 完成面板是否已打开（防重复）
// —— 移动端同步加固 ——
// Android WebView 里 blur 不可靠（键盘收起/点工具栏外/切后台都可能不触发），仅靠失焦提交会丢编辑。
let syncFn = null; // 当前 render 闭包里的 sync（文档级 flush 监听只绑一次，经此转发）
let inputTimer = null; // 停手后自动提交的防抖定时器
let composing = false; // IME 组合输入中（中文输入法拼音期间绝不提交/重写）
let docSyncBound = false; // visibilitychange/pagehide flush 只绑一次
let syncing = false; // sync 防重入
let bufferDirty = false; // 缓冲区有未提交编辑（input 置位，sync 成功清零）
let inputSeq = 0; // input 事件序号（reload 后判定「期间没有新输入」用）
let wsExitFullRef = null; // 当前实例的退出全屏（文档级 Esc 只绑一次，经此转发）

const WD_CN = ['日', '一', '二', '三', '四', '五', '六'];
function weekStartOf(k) { const d = parseKey(k); const off = (d.getDay() + 6) % 7; return dkey(new Date(d.getTime() - off * 86400000)); }

// 逐个唤起完成面板：勾选完成 → 填了就完成、取消才回滚（不报错回退）
function pumpComplete() {
  if (completing) return;
  const next = completeQueue.shift();
  if (!next) return;
  const App = CURRENT_APP;
  if (!App) return;
  completing = true;
  const rollback = () => {
    try {
      const text = vd ? vd.getValue() : '';
      const ex = findEntity(App.db, 'activity', next.id);
      const t2 = replaceEntityLine(text, next.id, ex ? serializeEntityLine(App.db, ex) : '');
      if (t2 !== text && vd) vd.setValue(t2);
    } catch (e) { /* 忽略 */ }
  };
  const finish = () => { completing = false; pumpComplete(); };
  if (App.overview && App.overview.openCompleteModal) {
    App.overview.openCompleteModal(next.id, { onDone: finish, onCancel: () => { rollback(); finish(); } });
  } else {
    rollback(); finish();
  }
}
function queueComplete(id, title) {
  if (completing || completeQueue.some((q) => q.id === id)) return;
  completeQueue.push({ id, title });
  pumpComplete();
}

const VIEW_LABEL = { goal: '目标', day: '日', week: '周', month: '月' };
const VIEW_ICON = { goal: 'layers', day: 'calendar', week: 'calendar', month: 'calendar' };
const VIEW_ORG = { day: organizeDay, week: organizeWeek, month: organizeMonth };
// 各视图语法提示（随 curView 切换，卡片头部下方）
const WS_HINT = {
  goal: `🧭 # 目标 ｜ ## 计划 ｜ - [ ] 活动 @ 9:00 30分钟 (计划) #标签 ｜ - [x] 已完成 ｜ 全量镜像·缺失即删`,
  day: `🧭 ## 日期 ｜ - [ ] 活动 @ 9:00 30分钟 ｜ 在「## 某日」下直接新行 → 自动排到当期日程`,
  week: `🧭 ## 周内日期 ｜ - [ ] 活动 @ 9:00 30分钟 ｜ 在「## 某日」下直接新行 → 自动排到当期日程`,
  month: `🧭 ## 月内日期 ｜ - [ ] 活动 @ 9:00 30分钟 ｜ 在「## 某日」下直接新行 → 自动排到当期日程`,
};
function viewHint() { return WS_HINT[curView] || WS_HINT.goal; }
function organizeView(db, view, anchor = null) {
  return view === 'goal' ? serializeDbToMd(db) : VIEW_ORG[view](db, anchor, Date.now());
}
// 导航标签（当前视图锚点范围）
function anchorLabel(view) {
  const k = viewAnchor || todayKey();
  const d = parseKey(k);
  if (view === 'day') return `日 · ${k} 周${WD_CN[d.getDay()]}`;
  if (view === 'week') { const ws = weekStartOf(k); return `周 · ${ws} ~ ${addDays(ws, 6)}`; }
  return `月 · ${d.getFullYear()}年${d.getMonth() + 1}月`;
}
function findEntity(db, type, id) {
  if (type === 'goal') return (db.goals || []).find((x) => x.id === id);
  if (type === 'plan') return (db.plans || []).find((x) => x.id === id);
  return (db.activities || []).find((x) => x.id === id);
}

export function render(App, el) {
  // 容器已被重渲染替换（异步 import 迟到的旧回调）：直接丢弃，别在新界面上弹报错
  if (!el || !el.isConnected) return;
  CURRENT_APP = App; // 完成面板回调的 App 引用
  if (vd) { try { vd.destroy(); } catch (e) { /* 忽略旧实例销毁异常 */ } vd = null; }
  if (inputTimer) { clearTimeout(inputTimer); inputTimer = null; } // 旧实例的防抖提交作废
  composing = false;
  bufferDirty = false; // 新实例的初始内容来自 db，天然一致
  // 全屏模式的卡片被挂到 body 下（见 setFull）：旧实例残留直接清除，状态复位
  if (typeof document !== 'undefined') {
    document.querySelectorAll('body > .card.ws-full').forEach((c) => c.remove());
    document.body.classList.remove('ws-lock');
  }
  const prefs = Prefs.load();
  const initialMd = organizeView(App.db, curView, viewAnchor);
  const ignoredDeletes = new Set(); // 用户取消过的删除项（type:id），本轮不再弹（每次 render 重置）
  el.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>${icon('note')} 编辑器</h3>
        <div class="row-gap">
          <button class="btn sm" data-ws-full title="全屏编辑（Esc/返回键退出）">${icon('expand')} 全屏</button>
          <button class="btn sm" data-ws-syntax title="当前视图语法">？语法</button>
          <button class="btn sm" data-ws-export>${icon('download')} 导出 .md</button>
        </div>
      </div>
      <div class="ws-tabs" data-ws-tabs>
        ${Object.entries(VIEW_LABEL).map(([v, label]) => `<button class="ws-tab${v === curView ? ' on' : ''}" data-v="${v}">${icon(VIEW_ICON[v])} ${label}</button>`).join('')}
      </div>
      <div class="ws-nav" data-ws-nav hidden>
        <button class="btn sm" data-nav="prev">${icon('arrow-left')}</button>
        <button class="btn sm" data-nav="today">今天</button>
        <button class="btn sm" data-nav="next">${icon('arrow-right')}</button>
        <span class="ws-nav-label" data-nav-label></span>
      </div>
      <div id="ws-vditor" data-ws-md></div>
      <div class="ws-preview" data-ws-preview></div>
    </div>`;

  const preview = el.querySelector('[data-ws-preview]');
  const getText = () => { try { return vd && vd.getValue ? vd.getValue() : initialMd; } catch (e) { return initialMd; } };

  const updatePreview = (r, stat) => {
    // 安静原则：无变更、无警告时状态行留空 —— 一屏只给用户真正需要看的数字
    const hasInfo = (stat && (stat.created || stat.updated || (stat.deletions && stat.deletions.length)))
      || r.warnings.length > 0;
    if (!hasInfo) { preview.innerHTML = ''; return; }
    const tag = r.view ? `${VIEW_LABEL[r.view] || r.view}视图` : (r.mirror ? '镜像' : '增量');
    const syncInfo = stat ? (stat.created ? ` · 新建 ${stat.created}` : '') + (stat.updated ? ` · 更新 ${stat.updated}` : '') : '';
    preview.innerHTML =
      `<span>${esc(tag)}${syncInfo}</span>` +
      (r.warnings.length ? `<span class="warn">${icon('warning')} ${r.warnings.length} 条提示</span>` : '') +
      (stat && stat.deletions.length ? `<span class="warn">${icon('warning')} 将删除 ${stat.deletions.length} 项</span>` : '');
  };

  // 实时同步：解析当前 md → 写回 db → 持久化。任何解析异常都不应中断编辑。
  // 移动端纪律：blur/isFocused 在 Android WebView 里会说谎（键盘收起/切后台不触发 blur），
  // 因此 id 绑定回填**不看聚焦状态**（与创建同轮必达，否则行永远拿不到 id → 每轮复制副本）；
  // 仅「全文修复」和「弹窗/提示」这类打断性动作避开打字窗口。
  const backfill = (t2, text, force) => {
    if (t2 === text) return;
    try { vd.setValue(t2); } catch (e) { /* 忽略 */ }
  };
  const sync = (force = false, fromInput = false) => {
    if (syncing) return;
    syncing = true;
    try {
      const text = getText();
      // 空行 id 错位修复：回车把上一行 id 下移到空待办行 → 把 id 归还给原行，杜绝副本。
      // 文本被改写则 setValue 后让下轮 sync 带已修复文本重走一轮（幂等），不在错误文本上继续同步。
      const repaired = repairIdMarkers(text);
      if (repaired !== text) {
        // 打字途中（防抖触发）不重写全文（防光标丢失）；失焦/切视图/flush 必达
        if (!fromInput || force) backfill(repaired, text, force);
        return;
      }
      const r = parseMdImport(text, { now: Date.now(), view: curView === 'goal' ? null : curView });
      const stat = applyCandidates(App.db, r);
      saveDB(App.db); // 写回内存后立即落盘（实时同步必须持久化）
      const statusFails = stat.statusFails || [];
      // 新建/匹配绑定：无 id 行刚入库或命中既有 → 给对应行补隐藏式 id（防重复创建/误判缺失即删）。
      // 编辑中回填被推迟也不影响正确性：db 侧已对账收敛，行补 id 只是编辑器侧的绑定优化。
      const refs = stat.createdRefs || [];
      if (refs.length) {
        let t2 = text;
        for (const ref of refs) t2 = bindEntityLine(t2, ref.type, ref.title, ref.id, ref.occ || 0);
        backfill(t2, text, force);
        updatePreview(r, stat);
        return; // 下轮 sync（失焦/停手/flush）行已有 id，再处理状态/删除
      }
      // 勾选完成（[x]）但 db 无法直接完成 → 唤起完成面板（填了就完成、取消才回滚）
      const wantComplete = statusFails.filter((f) => f.type === 'activity' && f.to === 'Completed');
      // 其他非法流转（Completed 不回退 / 改归档等）→ 回滚该行为 db 实际状态 + 明确提示
      const otherFails = statusFails.filter((f) => !(f.type === 'activity' && f.to === 'Completed'));
      if (otherFails.length) {
        let t2 = text;
        for (const f of otherFails) {
          const ex = findEntity(App.db, f.type, f.id);
          if (ex) t2 = replaceEntityLine(t2, f.id, serializeEntityLine(App.db, ex));
        }
        backfill(t2, text, force);
        if (!fromInput) { // 打字途中不弹提示打断
          const first = otherFails[0];
          const typeName = { goal: '目标', plan: '计划', activity: '活动' }[first.type] || '活动';
          toast(`「${first.title}」${typeName}状态未生效：仅支持合法流转`, 'warn');
        }
      }
      wantComplete.forEach((f) => queueComplete(f.id, f.title));
      // 镜像缺失即删：仅未忽略项弹确认（打字途中的瞬时缺失不弹，推迟到失焦/flush 再确认）
      const fresh = stat.deletions.filter((d) => !ignoredDeletes.has(d.type + ':' + d.id));
      if (fresh.length && !fromInput) {
        confirmDeletes(App, fresh, () => {
          // 删除已执行；忽略标记对应项避免再次触发
          fresh.forEach((d) => ignoredDeletes.add(d.type + ':' + d.id));
          updatePreview(r, { ...stat, deletions: [] });
        }, () => {
          // 取消：本轮忽略
          fresh.forEach((d) => ignoredDeletes.add(d.type + ':' + d.id));
          updatePreview(r, stat);
        });
      } else {
        updatePreview(r, stat);
      }
      // 走到这里的所有路径（含提前 return 的修复/绑定）缓冲区都与 db 一致 → 清脏标记
      bufferDirty = false;
    } catch (e) {
      console.error('[ws] 实时同步异常', e);
    } finally {
      syncing = false;
    }
  };
  syncFn = sync; // 文档级 flush 转发到当前实例

  // 外部改库（目标页改名/删除、小组件、同步、恢复备份……）后由 App.render 调用：
  // 缓冲区无未提交编辑时，用 db 重新组织当前视图——否则陈旧缓冲会在下次 sync 把
  // 外部修改改回去（例如目标页改名 → 编辑器又把名字改回来）。
  const reloadFromDb = () => {
    if (bufferDirty || composing || !vd || syncing) return;
    const fresh = organizeView(App.db, curView, viewAnchor);
    if (getText() === fresh) return;
    const mySeq = ++inputSeq;
    try { vd.setValue(fresh); } catch (e) { /* 忽略 */ }
    // 我们自己的 setValue 可能触发 input（误置脏标记）：期间没有真实输入才清零
    setTimeout(() => { if (inputSeq === mySeq) bufferDirty = false; }, 80);
  };
  window.__wsReloadFromDb = reloadFromDb;

  // Vditor 实例（WYSIWYG；sanitize:false 保留隐藏式 id 绑定标记）
  // 主题跟随夜间模式：dark 强制 / auto 且系统深色也算深（与 applyNightTheme 同一判据），
  // 否则 auto+系统深色时会得到「页面深色、编辑器纯白」的割裂观感。
  const darkNow = prefs.nightTheme === 'dark'
    || (prefs.nightTheme !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  // 同步模型：编辑器是纯编辑缓冲——编辑中系统绝不触碰（不 setValue、不写 db），
  // 失焦（blur）才一次性 reconcile 提交。杜绝 input 重入导致的跳顶/光标丢失/覆盖输入。
  // 用 id 挂载：Vditor 对字符串 id 的分支会顺带补全 cache 等默认项，
  // 元素挂载在 WebView2（Tauri）/部分 WebView 上会导致编辑器初始化异常。
  // 容器有效性由上面的 el.isConnected 守卫保证，所以不会出现「找不到元素」。
  if (!document.getElementById('ws-vditor')) return;
  vd = new Vditor('ws-vditor', {
    mode: 'wysiwyg',
    height: 440,
    // 编辑器依赖的两份运行时资源改为本地：i18n 内置、lute 随包发布。
    // Vditor 默认从 unpkg 拉这两样，网络不通/被墙时编辑器直接初始化失败（白板）。
    i18n: VditorZh,
    _lutePath: './vditor-assets/lute.min.js',
    cache: { enable: false }, // 数据由 db 统一管理，禁用编辑器内缓存
    sanitize: false, // 保留 <!--id:--> 的 lute 链接形式（CSS 隐藏，绑定身份用）
    theme: darkNow ? 'dark' : 'classic',
    value: initialMd,
    toolbar: [
      'headings', 'bold', 'italic', 'strike', '|',
      'list', 'ordered-list', 'check', 'quote', 'code', 'inline-code', '|',
      'link', 'table', 'undo', 'redo', 'outline',
    ],
    input: () => {
      bufferDirty = true; // 有未提交编辑：外部触发的「从 db 重置」必须让位
      inputSeq++;
      // 只读更新预览统计（parse 纯函数，零副作用，不触碰编辑器内容）
      const text = getText();
      const r = parseMdImport(text, { now: Date.now(), view: curView === 'goal' ? null : curView });
      updatePreview(r, null);
      // 移动端 blur 不可靠：停手 900ms 自动提交（fromInput：打字途中不弹窗打断）。
      // IME 组合输入中推迟——组合结束的下一次 input 会续期定时器。
      if (inputTimer) clearTimeout(inputTimer);
      inputTimer = setTimeout(() => { if (!composing) sync(false, true); }, 900);
    },
    blur: () => { if (inputTimer) clearTimeout(inputTimer); sync(); }, // 失焦提交：一次性 parse → reconcile → 落库 → 回填
    after: () => setTimeout(sync, 60), // 初始化稳定后同步一次
  });
  // IME 组合输入探测（编辑器容器每次 render 重建，监听随元素走，无堆积）
  const wsEd = document.getElementById('ws-vditor');
  if (wsEd) {
    wsEd.addEventListener('compositionstart', () => { composing = true; });
    wsEd.addEventListener('compositionend', () => { composing = false; });
  }
  // 文档级 flush（只绑一次）：切后台/页面卸载时提交编辑缓冲——Android WebView 切后台不触发 blur，
  // 不 flush 的话用户最后一次编辑会随重渲染丢失。
  if (!docSyncBound && typeof document !== 'undefined') {
    docSyncBound = true;
    const flush = () => { if (inputTimer) { clearTimeout(inputTimer); inputTimer = null; } if (syncFn) syncFn(true); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    window.addEventListener('pagehide', flush);
    // Esc 退出全屏编辑（只绑一次；转发到当前实例）
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.querySelector('.card.ws-full') && wsExitFullRef) wsExitFullRef();
    });
  }
  if (typeof window !== 'undefined') { window.__wsVd = vd; window.__wsSync = sync; window.__wsView = () => curView; } // 调试/测试钩子

  // 日期视图导航（‹ 今天 ›）：日 ±1 天 / 周 ±1 周 / 月 ±1 月；「今天」回到当前
  const navEl = el.querySelector('[data-ws-nav]');
  const navLabel = el.querySelector('[data-nav-label]');
  const showNav = (view) => {
    const isDate = view !== 'goal';
    navEl.hidden = !isDate;
    if (isDate) navLabel.textContent = anchorLabel(view);
  };
  navEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-nav]');
    if (!b) return;
    const act = b.dataset.nav;
    if (act === 'today') viewAnchor = null;
    else {
      const dir = act === 'prev' ? -1 : 1;
      const base = viewAnchor || todayKey();
      if (curView === 'day') viewAnchor = addDays(base, dir);
      else if (curView === 'week') viewAnchor = addDays(base, dir * 7);
      else { const d = parseKey(base); viewAnchor = dkey(new Date(d.getFullYear(), d.getMonth() + dir, 1)); }
    }
    sync(); // 先落库当前视图编辑，再切到新视图内容
    vd.setValue(organizeView(App.db, curView, viewAnchor)); // 触发 after → sync
    showNav(curView);
  });

  // 视图切换 = 换内容（db 重排成另一份 md 填入同一编辑器）
  el.querySelector('[data-ws-tabs]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b || b.dataset.v === curView) return;
    // ★ 顺序纪律：先按**旧**视图身份落库当前编辑，再改 curView、再换内容。
    // 若先改 curView，旧视图内容会被套上新区块的解析规则——
    // 日视图内容被当 goal 镜像解析会凭空创建「今日」目标/「未分类」计划（移动端重复污染源）。
    sync(); // 落库旧视图编辑（此时 curView 仍指向旧内容）
    curView = b.dataset.v;
    viewAnchor = null; // 每个视图从今天开始浏览
    el.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x.dataset.v === curView));
    vd.setValue(organizeView(App.db, curView, viewAnchor)); // 触发 after → sync
    showNav(curView);
  });
  // 「？语法」：需要时点击弹窗（不常驻，不干扰写作）
  el.querySelector('[data-ws-syntax]').onclick = () => {
    openModal({
      title: `${VIEW_LABEL[curView]}视图 · 标记语法`,
      bodyHTML: `<div class="ws-syntax-body"><code>${esc(viewHint())}</code>
        <p class="muted" style="margin-top:8px">备注写在活动行尾，用全角分号<code>；</code>分隔：
        <code>标题 @ 9:00 30分钟；这是备注</code>；快速标签用 <code>#标签</code>。</p></div>`,
      footerHTML: `<button class="btn primary" data-ok>知道了</button>`,
    });
    const m = document.querySelector('.modal-mask:last-of-type');
    if (m) { const ok = m.querySelector('[data-ok]'); if (ok) ok.onclick = () => { const mm = m; mm.remove(); }; }
  };
  showNav(curView);

  // —— 全屏编辑模式 ——
  // 卡片 fixed 铺满视口（z=55：高于内容、低于弹窗 60 与计时 90，弹窗仍可浮在其上），
  // Vditor 高度按剩余空间实测；按钮 / Esc / 硬件返回键均可退出。
  let wsFull = false;
  const wsCard = el.querySelector('.card'); // ★ 先抓引用：reparent 到 body 后 el.querySelector 会找不到
  const fullBtn = el.querySelector('[data-ws-full]');
  const fitFull = () => {
    const wrap = document.getElementById('ws-vditor');
    if (!wsFull || !wsCard || !wrap) return;
    const chrome = (wsCard.querySelector('.card-head')?.offsetHeight || 0)
      + (wsCard.querySelector('.ws-tabs')?.offsetHeight || 0)
      + (wsCard.querySelector('.ws-nav')?.offsetHeight || 0) + 34; // 卡片内边距 + 预览行余量
    wrap.style.height = Math.max(220, window.innerHeight - chrome) + 'px';
  };
  const setFull = (on) => {
    wsFull = on;
    if (!wsCard) return;
    // ★ 必须 reparent 到 body：祖先 .dash-track 带轮播 transform，会把 fixed 的包含块
    //   劫持成轨道区域（顶栏盖不住）。挂到 body 下才是真正的视口全屏。
    if (on && wsCard.parentElement !== document.body) document.body.appendChild(wsCard);
    if (!on && wsCard.parentElement !== el) el.appendChild(wsCard);
    wsCard.classList.toggle('ws-full', on);
    document.body.classList.toggle('ws-lock', on);
    if (fullBtn) fullBtn.innerHTML = on ? `${icon('expand')} 退出全屏` : `${icon('expand')} 全屏`;
    const wrap = document.getElementById('ws-vditor');
    if (on) {
      setTimeout(fitFull, 60); // 等布局稳定后实测一次
      window.addEventListener('resize', fitFull);
    } else {
      window.removeEventListener('resize', fitFull);
      if (wrap) wrap.style.height = '440px'; // 还原常规高度（与初始化一致）
    }
  };
  wsExitFullRef = () => setFull(false);
  if (typeof window !== 'undefined') window.__wsExitFull = wsExitFullRef; // 硬件返回键用
  if (fullBtn) fullBtn.onclick = () => setFull(!wsFull);
  // 夜间模式切换即时生效（applyNightTheme 调用）：不必等重渲染重建编辑器
  if (typeof window !== 'undefined' && vd.setTheme) {
    window.__wsApplyTheme = (dark) => { try { vd.setTheme(dark ? 'dark' : 'classic'); } catch (e) { /* 忽略 */ } };
  }

  // 导出 .md 文件（lute 链接式 id 标记 → 可读注释）
  // 走统一导出出口：native 落盘 Documents/exports（WebView 里 <a download> 是 no-op），web 保持下载
  el.querySelector('[data-ws-export]').onclick = async () => {
    const name = `erp-${new Date().toISOString().slice(0, 10)}.md`;
    const r = await saveFile(name, 'text/markdown', normalizeIdMarkers(getText()));
    if (r.ok && r.how === 'download') toast('已导出 Markdown', 'ok');
  };
}

// 镜像缺失即删确认（不可逆，级联删除含产出/价值流/流水）
function confirmDeletes(App, deletions, onOk, onCancel) {
  const byType = { activity: '活动', plan: '计划', goal: '目标' };
  const list = deletions.map((d) => `<div class="ws-del-item">${byType[d.type] || d.type} · ${esc(d.title)}</div>`).join('');
  const m = openModal({
    title: `⚠ 将删除 ${deletions.length} 项（不可逆）`,
    bodyHTML: `<div class="muted" style="margin-bottom:8px">md 中已不存在这些条目，按「完整镜像」语义将从账本级联删除（含产出/价值流/流水）。</div><div class="ws-del-list">${list}</div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn danger" data-enter data-confirm>确认删除 ${deletions.length} 项</button>`,
    accent: 'danger',
    width: 480,
  });
  m.q('[data-cancel]').onclick = () => { m.close(); onCancel(); };
  m.q('[data-confirm]').onclick = () => {
    const del = applyDeletions(App.db, deletions);
    saveDB(App.db); // 删除后立即落盘（删除不能只停留在内存）
    m.close();
    toast(`已删除 ${del.deleted} 项${del.warnings.length ? ` · ⚠ ${del.warnings.length}` : ''}`, del.warnings.length ? 'warn' : 'ok');
    onOk();
  };
}

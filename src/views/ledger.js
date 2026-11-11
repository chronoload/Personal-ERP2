// ============================================================
// views/ledger.js — 文本版账单（资源 Tab「📒 文本账单」）
// 仿 workspace.js：单一 Vditor 编辑兼展示器，实时同步镜像 manual 流水。
//  - 序列化：db.txs(manual/reversal) → md 行（带隐藏 id 绑定）
//  - 解析：md → 行候选 → applyLedger 镜像（新增/冲正，遵循不变量5）
//  - 实时同步：编辑(防抖) + 失焦/flush 提交，删除/更正 = 冲正，不物理删除
// db 是唯一真源；md 是流水的可交换视图面。
// Vditor 实例生命周期：render 重建前 destroy 旧实例。
// ============================================================
import { serializeLedger, parseLedger, applyLedger } from '../domain/ledger.js';
import { Prefs } from '../store/prefs.js';
import { saveDB } from '../store/db.js';
import { toast, esc, openModal } from '../ui/helpers.js';
import Vditor from 'vditor';
import 'vditor/dist/index.css';

let vd = null;          // 当前 Vditor 实例
let CURRENT_APP = null; // 完成面板回调用 App 引用（跨 render 保留）
let inputTimer = null;  // 停手自动提交防抖
let composing = false;  // IME 组合输入中
let syncing = false;    // sync 防重入
let docSyncBound = false;
let syncFn = null;      // 文档级 flush 转发

const MD_HEADER = '# 📒 文本账单 · 手动流水\n\n> 一行一笔：`- 备注 -8 @资源名`；`+` 收入、`-` 支出；删行/改行 = 冲正原单（不物理删除）。\n\n';

export function render(App, el) {
  CURRENT_APP = App;
  if (vd) { try { vd.destroy(); } catch (e) {} vd = null; }
  if (inputTimer) { clearTimeout(inputTimer); inputTimer = null; }
  composing = false;
  const prefs = Prefs.load();
  const initialMd = serializeLedger(App.db).md;

  el.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>📒 文本账单</h3>
        <div class="row-gap">
          <button class="btn sm" data-lg-syntax title="账单语法">？语法</button>
          <button class="btn sm primary" data-lg-refresh title="用 db 重新组织账单">↻ 重建</button>
        </div>
      </div>
      <div id="ledger-vditor" data-lg-md></div>
      <div class="ws-preview" data-lg-preview></div>
    </div>`;

  const preview = el.querySelector('[data-lg-preview]');
  const getText = () => { try { return vd && vd.getValue ? vd.getValue() : initialMd; } catch (e) { return initialMd; } };

  const updatePreview = (stat, warnings) => {
    const hasInfo = (stat && (stat.created || stat.reversed)) || (warnings && warnings.length);
    if (!hasInfo) { preview.innerHTML = ''; return; }
    const parts = [];
    if (stat) {
      if (stat.created) parts.push(`新建 ${stat.created}`);
      if (stat.reversed) parts.push(`冲正 ${stat.reversed}`);
    }
    preview.innerHTML =
      `<span>${esc(parts.join(' · ') || '已同步')}</span>` +
      (warnings && warnings.length ? `<span class="warn">⚠ ${warnings.length} 条提示</span>` : '');
  };

  const sync = (force = false, fromInput = false) => {
    if (syncing) return;
    syncing = true;
    try {
      const text = getText();
      const { rows, warnings } = parseLedger(text);
      const stat = applyLedger(App.db, App.engine, rows);
      saveDB(App.db);
      updatePreview(stat, warnings.length ? warnings : (stat.warnings || []));
    } catch (e) {
      console.error('[ledger] 同步异常', e);
    } finally {
      syncing = false;
    }
  };
  syncFn = sync;

  const darkNow = prefs.nightTheme === 'dark'
    || (prefs.nightTheme !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

  vd = new Vditor('ledger-vditor', {
    mode: 'wysiwyg',
    height: 380,
    cache: { enable: false },
    sanitize: false,
    theme: darkNow ? 'dark' : 'classic',
    value: initialMd,
    toolbar: ['headings', 'bold', 'italic', 'strike', '|', 'list', 'check', 'quote', 'inline-code', '|', 'undo', 'redo', 'outline'],
    input: () => {
      if (inputTimer) clearTimeout(inputTimer);
      inputTimer = setTimeout(() => { if (!composing) sync(false, true); }, 900);
    },
    blur: () => { if (inputTimer) { clearTimeout(inputTimer); inputTimer = null; } sync(); },
    after: () => setTimeout(sync, 60),
  });

  const ed = document.getElementById('ledger-vditor');
  if (ed) {
    ed.addEventListener('compositionstart', () => { composing = true; });
    ed.addEventListener('compositionend', () => { composing = false; });
  }
  if (!docSyncBound && typeof document !== 'undefined') {
    docSyncBound = true;
    const flush = () => { if (inputTimer) { clearTimeout(inputTimer); inputTimer = null; } if (syncFn) syncFn(true); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    window.addEventListener('pagehide', flush);
  }
  if (typeof window !== 'undefined') { window.__lgVd = vd; window.__lgSync = sync; } // 调试/测试钩子

  el.querySelector('[data-lg-syntax]').onclick = () => {
    openModal({
      title: '文本账单 · 语法',
      bodyHTML: `<div class="ws-syntax-body"><code>${esc(MD_HEADER.replace(/\n/g, ''))}</code>
        <p class="muted" style="margin-top:8px">每行一笔：<code>- 早餐 -8 @灵感</code>。新增 = 入账；删除/改行 = 冲正原单+（改行）新流水。</p></div>`,
      footerHTML: `<button class="btn primary" data-ok>知道了</button>`,
    });
    const m = document.querySelector('.modal-mask:last-of-type');
    if (m) { const ok = m.querySelector('[data-ok]'); if (ok) ok.onclick = () => m.remove(); }
  };
  el.querySelector('[data-lg-refresh]').onclick = () => {
    sync(); // 先落当前编辑
    const fresh = serializeLedger(App.db).md;
    if (getText() !== fresh) { try { vd.setValue(fresh); } catch (e) {} }
    toast('账单已按 db 重建', 'ok');
  };

  // 重建后（外部改库/同步/恢复）由 App.render 调用：缓冲区无未提交编辑时用 db 重置
  if (typeof window !== 'undefined') { window.__lgReloadFromDb = () => { if (!vd || syncing) return; const fresh = serializeLedger(App.db).md; if (getText() !== fresh) { try { vd.setValue(fresh); } catch (e) {} } }; }
}

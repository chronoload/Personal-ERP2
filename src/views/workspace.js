// ============================================================
// views/workspace.js
// Markdown 编辑器卡片（活动 Tab 滑动容器「📝 编辑器」页）：
//   Vditor WYSIWYG 编辑 md（任务列表可勾选切换完成状态），
//   「应用」→ parseMdImport + applyCandidates 写 db；「导出」→ .md 文件。
// 双向：编辑器内容即 md；看板/日历操作 → db 变 → App.render 重渲染 → 编辑器同步最新 md。
// Vditor 实例生命周期：render 重建前 destroy 旧实例。
// ============================================================
import { serializeDbToMd, parseMdImport } from '../domain/mdimport.js';
import { applyCandidates } from '../domain/mdapply.js';
import { Prefs } from '../store/prefs.js';
import { toast, esc } from '../ui/helpers.js';
import Vditor from 'vditor';
import 'vditor/dist/index.css';

let vd = null; // 当前 Vditor 实例（render 重建时销毁）

export function render(App, el) {
  if (vd) { try { vd.destroy(); } catch (e) { /* 忽略旧实例销毁异常 */ } vd = null; }
  const md = serializeDbToMd(App.db);
  const prefs = Prefs.load();
  el.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>📝 编辑查看器</h3>
        <div class="row-gap">
          <span class="muted">WYSIWYG · 任务可勾选 · md ⇄ 数据 双向同步</span>
          <button class="btn sm" data-ws-export>⬇ 导出 .md</button>
          <button class="btn sm primary" data-ws-apply>✓ 应用到数据</button>
        </div>
      </div>
      <div id="ws-vditor"></div>
      <div class="ws-preview" data-ws-preview></div>
    </div>`;

  // 预览统计（Vditor input 回调驱动）
  const preview = el.querySelector('[data-ws-preview]');
  const updatePreview = () => {
    let text = md;
    try { text = vd && vd.getValue ? vd.getValue() : md; } catch (e) { /* Vditor 未就绪 */ }
    const r = parseMdImport(text, { now: Date.now() });
    const done = r.activities.filter((a) => a.status === 'Completed').length;
    preview.innerHTML =
      `<span>解析：目标 <b>${r.goals.length}</b> · 计划 <b>${r.plans.length}</b> · 活动 <b>${r.activities.length}</b> · 完成 <b>${done}</b></span>` +
      (r.warnings.length ? `<span class="warn">⚠ ${r.warnings.length} 条提示</span>` : '');
  };

  // Vditor 实例（WYSIWYG；任务列表 checkbox 可直接勾选切换完成状态）
  vd = new Vditor('ws-vditor', {
    mode: 'wysiwyg',
    height: 460,
    cache: { enable: false }, // 数据由 db 统一管理，禁用编辑器内缓存
    theme: prefs.nightTheme === 'dark' ? 'dark' : 'classic',
    value: md,
    toolbar: [
      'headings', 'bold', 'italic', 'strike', '|',
      'list', 'ordered-list', 'check', 'quote', 'code', 'inline-code', '|',
      'link', 'table', 'undo', 'redo', 'outline',
    ],
    input: () => updatePreview(),
    after: () => updatePreview(),
  });

  // 应用 → 写 db → 整页刷新（看板/日历/编辑器同步为最新 md）
  el.querySelector('[data-ws-apply]').onclick = () => {
    let text = md;
    try { text = vd && vd.getValue ? vd.getValue() : md; } catch (e) { /* 未就绪用初始值 */ }
    const r = parseMdImport(text, { now: Date.now() });
    const stat = applyCandidates(App.db, r);
    App.render(true);
    toast(`已应用：新建 ${stat.created} · 更新 ${stat.updated}${stat.warnings.length ? ` · ⚠ ${stat.warnings.length}` : ''}`, stat.warnings.length ? 'warn' : 'ok');
  };
  // 导出 .md 文件
  el.querySelector('[data-ws-export]').onclick = () => {
    let text = md;
    try { text = vd && vd.getValue ? vd.getValue() : md; } catch (e) { /* 未就绪用初始值 */ }
    const blob = new Blob([text], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `erp-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出 Markdown', 'ok');
  };
}

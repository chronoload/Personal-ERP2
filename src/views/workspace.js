// ============================================================
// views/workspace.js
// 三视图工作台：横向滑动容器（scroll-snap）并排三个面板
//   ① 编辑查看器 —— Markdown 手打（双向：解析预览 → 应用；导出 .md）
//   ② 看板 —— 五态活动精简列（开始/完成/编辑，走 engine）
//   ③ 日历 —— 复用 calendar.renderSection
// 双向同步：编辑器「应用」→ applyCandidates 写 db → 整页刷新；
//           看板/日历操作 → db 变 → App.render 重渲染，textarea 同步为最新 md。
// ============================================================
import { serializeDbToMd, parseMdImport } from '../domain/mdimport.js';
import { applyCandidates } from '../domain/mdapply.js';
import { renderSection as renderCalendar } from './calendar.js';
import { toast, esc } from '../ui/helpers.js';

function kanbanHTML(App) {
  const { db } = App;
  const cols = [
    { key: 'Planned', label: '📋 待办', match: (s) => s === 'Planned', act: 'start' },
    { key: 'Started', label: '⚡ 进行中', match: (s) => s === 'Started', act: 'done' },
    { key: 'Done', label: '✅ 已完成', match: (s) => s === 'Completed' || s === 'Reviewed', act: null },
  ];
  return cols.map((c) => {
    const items = db.activities.filter((a) => c.match(a.status));
    return `
      <div class="ws-kcol">
        <div class="ws-khead">${c.label}<span class="cnt">${items.length}</span></div>
        ${items.map((a) => {
          const startBtn = c.act === 'start'
            ? `<button class="btn sm primary" data-start="${esc(a.id)}">开始</button>` : '';
          const doneBtn = c.act === 'done'
            ? `<button class="btn sm primary" data-done="${esc(a.id)}">完成</button>` : '';
          return `
            <div class="ws-kcard">
              <div class="grow">${esc(a.title)}
                ${a.planned_start ? `<div class="muted">${esc(String(a.planned_start).replace('T', ' '))}</div>` : ''}
              </div>
              <div class="row-gap">${startBtn}${doneBtn}<button class="btn sm" data-edit="${esc(a.id)}">编辑</button></div>
            </div>`;
        }).join('') || '<div class="muted" style="padding:6px">空</div>'}
      </div>`;
  }).join('');
}

export function render(App, el) {
  const md = serializeDbToMd(App.db);
  el.innerHTML = `
    <div class="ws">
      <section class="ws-pane">
        <div class="ws-head">
          <b>📝 编辑查看器</b>
          <span class="muted">手打 md · 双向</span>
          <span class="grow"></span>
          <button class="btn sm" data-ws-export>⬇ 导出 .md</button>
          <button class="btn sm primary" data-ws-apply>✓ 应用到数据</button>
        </div>
        <textarea class="ws-md" data-ws-md spellcheck="false">${esc(md)}</textarea>
        <div class="ws-preview" data-ws-preview></div>
      </section>
      <section class="ws-pane">
        <div class="ws-head"><b>📋 看板</b><span class="muted">五态 · 点击操作</span></div>
        <div class="ws-kanban" data-ws-kanban>${kanbanHTML(App)}</div>
      </section>
      <section class="ws-pane">
        <div class="ws-head"><b>📅 日历</b><span class="muted">月/周 · 与看板同数据源</span></div>
        <div data-ws-cal></div>
      </section>
    </div>`;

  // 日历面板：复用现有 renderSection
  renderCalendar(App, el.querySelector('[data-ws-cal]'));

  // 编辑器：实时解析预览
  const ta = el.querySelector('[data-ws-md]');
  const preview = el.querySelector('[data-ws-preview]');
  const updatePreview = () => {
    const r = parseMdImport(ta.value, { now: Date.now() });
    preview.innerHTML =
      `<span>解析：目标 <b>${r.goals.length}</b> · 计划 <b>${r.plans.length}</b> · 活动 <b>${r.activities.length}</b></span>` +
      (r.warnings.length ? `<span class="warn">⚠ ${r.warnings.length} 条提示</span>` : '');
  };
  ta.addEventListener('input', updatePreview);
  updatePreview();

  // 应用 → 写 db → 整页刷新（看板/日历/textarea 同步为最新 md）
  el.querySelector('[data-ws-apply]').onclick = () => {
    const r = parseMdImport(ta.value, { now: Date.now() });
    const stat = applyCandidates(App.db, r);
    App.render(true);
    toast(`已应用：新建 ${stat.created} · 更新 ${stat.updated}${stat.warnings.length ? ` · ⚠ ${stat.warnings.length}` : ''}`, stat.warnings.length ? 'warn' : 'ok');
  };
  // 导出 .md 文件
  el.querySelector('[data-ws-export]').onclick = () => {
    const blob = new Blob([ta.value], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `erp-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出 Markdown', 'ok');
  };

  // 看板操作：开始 / 完成 / 编辑（各自走 App 现有流程）
  el.querySelectorAll('[data-start]').forEach((b) => b.onclick = () => App.startAct(b.dataset.start));
  el.querySelectorAll('[data-done]').forEach((b) => b.onclick = () => App.overview.openCompleteModal(b.dataset.done));
  el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => App.overview.openActModal(b.dataset.edit));
}

// ============================================================
// ui/stepWizard.js
// 分步新建向导：一次只显示一个属性，逐步前进。
// 只负责壳与导航；每一步的控件与取值由调用方给出。
// ============================================================

let active = null; // 当前打开的向导遮罩

/**
 * @param {object} cfg
 * @param {string} cfg.title      顶部标题（例：新建活动）
 * @param {string} cfg.kind       goal / plan / activity：决定整体强调色
 * @param {Array}  cfg.steps      每步：{ label, desc, html(root) => string, bind(root), read(root) => boolean }
 * @param {string} cfg.finishLabel 最后一步的主按钮文案
 * @param {Function} cfg.onFinish 全部读完后执行；返回 false 表示留在当前步
 */
export function openStepWizard({ title = '分步新建', steps = [], finishLabel = '完成', onFinish, kind = 'activity' }) {
  closeStepWizard();
  if (!steps.length) return null;

  const el = document.createElement('div');
  el.className = 'wiz-mask';
  el.innerHTML = `
    <div class="wiz-panel" data-kind="${kind}" role="dialog" aria-label="${title}">
      <div class="wiz-head">
        <span class="wiz-title">${title}</span>
        <span class="wiz-step" data-wiz-count></span>
        <button class="wiz-close" data-wiz-close aria-label="关闭">✕</button>
      </div>
      <div class="wiz-bar"><i data-wiz-bar></i></div>
      <div class="wiz-body" data-wiz-body></div>
      <div class="wiz-foot">
        <button class="btn" data-wiz-back>上一步</button>
        <button class="btn primary" data-wiz-next>下一步</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  active = el;

  const body = el.querySelector('[data-wiz-body]');
  const count = el.querySelector('[data-wiz-count]');
  const bar = el.querySelector('[data-wiz-bar]');
  const back = el.querySelector('[data-wiz-back]');
  const next = el.querySelector('[data-wiz-next]');
  let i = 0;

  const render = () => {
    const s = steps[i];
    count.textContent = `${i + 1} / ${steps.length}`;
    bar.style.width = `${((i + 1) / steps.length) * 100}%`;
    body.innerHTML = `
      <div class="wiz-label">${s.label}</div>
      ${s.desc ? `<div class="wiz-desc">${s.desc}</div>` : ''}
      <div class="wiz-control">${s.html ? s.html() : ''}</div>`;
    if (s.bind) { try { s.bind(body); } catch (e) { /* 绑定失败不阻塞导航 */ } }
    back.style.visibility = i === 0 ? 'hidden' : '';
    next.textContent = i === steps.length - 1 ? finishLabel : '下一步';
    const first = body.querySelector('input, select');
    if (first) {
      setTimeout(() => {
        try {
          first.focus();
          if (first.select && first.tagName === 'INPUT' && first.type !== 'number') first.select();
        } catch (e) { /* 聚焦失败不影响 */ }
      }, 30);
    }
  };

  const advance = () => {
    const s = steps[i];
    if (s.read && s.read(body) === false) return;
    if (i < steps.length - 1) { i += 1; render(); return; }
    let r;
    try { r = onFinish ? onFinish() : undefined; } catch (e) { r = false; }
    if (r !== false) closeStepWizard();
  };

  next.onclick = advance;
  back.onclick = () => { if (i > 0) { i -= 1; render(); } };
  el.querySelector('[data-wiz-close]').onclick = () => closeStepWizard();
  el.addEventListener('click', (e) => { if (e.target === el) closeStepWizard(); });
  // 回车直达下一步（文本框内不换行，选择框也照常确认）
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeStepWizard(); return; }
    if (e.key !== 'Enter') return;
    const t = e.target;
    if (t && t.tagName === 'TEXTAREA') return;
    e.preventDefault();
    advance();
  });

  render();
  return { close: closeStepWizard };
}

export function closeStepWizard() {
  if (active && active.parentElement) active.parentElement.removeChild(active);
  active = null;
}

export function isStepWizardOpen() {
  return !!active;
}

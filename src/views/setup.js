// ============================================================
// views/setup.js
// 首次启动「初始化资源」：不预设任何资源，由用户在此配置账户。
// 至少添加 1 个资源后才能进入主界面。
// ============================================================
import { esc, fmtNum, toast } from '../ui/helpers.js';
import { icon } from '../ui/icons.js';

// data-* 属性值转义（同 overview.js）：\ 与 ' 按 JS 转义，" 转 \x22 防止属性提前闭合
function jsStr(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\x22')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

// 快捷建议（仅填充表单，不自动创建）
const QUICK = [
  { name: '价值元', unit: '价值元', initial: 1000 },
  { name: '时间', unit: '小时', initial: 168 },
  { name: '精力', unit: '点', initial: 100 },
  { name: '金钱', unit: '元', initial: 5000 },
];

export function render(App, el) {
  const { db } = App;
  el.innerHTML = `
    <div class="card setup-card">
      <div class="setup-logo">P</div>
      <h2 class="setup-title">初始化个人经济系统</h2>
      <p class="muted setup-sub">先建立你的资源账户（价值元 / 时间 / 精力 / 金钱…），可随时在「活动」页增删。点下方建议快捷填入。</p>

      <div class="row-gap setup-quick">
        ${QUICK.map((q) => `<button class="btn sm" data-quick="${esc(q.name)}" data-unit="${esc(q.unit)}" data-init="${q.initial}">${esc(q.name)}</button>`).join('')}
      </div>

      <div class="grid2">
        <div class="field"><label>资源名称 *</label><input id="s-name" placeholder="例：价值元"></div>
        <div class="field"><label>单位</label><input id="s-unit" placeholder="点 / 小时 / 元"></div>
      </div>
      <div class="field"><label>初始余额</label><input id="s-init" type="number" value="0" step="0.01"></div>
      <button class="btn primary" id="s-add">＋ 添加资源</button>

      <div id="s-list" class="setup-list"></div>

      <div class="setup-foot">
        <button class="btn primary" id="s-done" ${db.resources.length ? '' : 'disabled'}>完成初始化，开始使用 ${icon('arrow-right')}</button>
      </div>
    </div>
  `;

  const list = el.querySelector('#s-list');
  const done = el.querySelector('#s-done');
  const renderList = () => {
    list.innerHTML = db.resources.map((r) => `
      <div class="row-gap setup-item">
        <span>${esc(r.name)} <span class="muted">${esc(r.unit)} · 初始 ${fmtNum(r.initial)}</span></span>
        <button class="btn sm danger" data-del="${jsStr(r.id)}">移除</button>
      </div>`).join('') || '<div class="muted" style="text-align:center;padding:8px">尚未添加资源</div>';
    done.disabled = !db.resources.length;
    list.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => {
        const r = App.engine.deleteResource(db, b.dataset.del);
        if (!r?.ok) toast(r?.error || '删除资源失败', 'err');
        renderList();
      };
    });
  };

  el.querySelectorAll('[data-quick]').forEach((b) => {
    b.onclick = () => {
      el.querySelector('#s-name').value = b.dataset.quick;
      el.querySelector('#s-unit').value = b.dataset.unit;
      el.querySelector('#s-init').value = b.dataset.init;
    };
  });

  el.querySelector('#s-add').onclick = () => {
    const r = App.engine.createResource(db, {
      name: el.querySelector('#s-name').value,
      unit: el.querySelector('#s-unit').value,
      initial: el.querySelector('#s-init').value,
    });
    if (!r.ok) return toast(r.error, 'err');
    el.querySelector('#s-name').value = '';
    el.querySelector('#s-unit').value = '';
    el.querySelector('#s-init').value = '0';
    renderList();
    toast('资源已添加', 'ok');
  };

  done.onclick = () => { App.render(); }; // 已有资源 → 进入主界面
  renderList();
}

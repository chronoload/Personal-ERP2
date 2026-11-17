// ============================================================
// ui/quickCreate.js
// 右下角黄色悬浮新建钮：点开选 目标 / 计划 / 活动 / 需求，各走既有弹窗。
// 只装配 DOM 与事件；数据写入仍由各视图的既有表单负责。
// ============================================================
import { toast } from './helpers.js';
import { openGoalModal, openPlanModal } from '../views/goals.js';
import { openActModal } from '../views/overview.js';
import { openAddDemand } from '../views/demands.js';

const ITEMS = [
  {
    key: 'goal', label: '目标', hint: '长期方向',
    run: () => openGoalModal(null),
  },
  {
    key: 'plan', label: '计划', hint: '中期抓手',
    run: (App) => {
      const goals = (App.db.goals || []).filter((g) => (g.status || 'Active') !== 'Archived');
      if (!goals.length) { toast('计划要挂在目标下：先建一个目标', 'warn'); return; }
      openPlanModal(goals[0].id);
    },
  },
  {
    key: 'activity', label: '活动', hint: '可排程的事',
    run: () => openActModal(null),
  },
  {
    key: 'demand', label: '需求', hint: '谁要什么',
    run: () => openAddDemand(),
  },
];

let el = null;
let menu = null;
let btn = null;
let open = false;
let listening = false;

function setOpen(v) {
  open = v;
  if (!el) return;
  el.classList.toggle('open', open);
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open && !listening) {
    listening = true;
    // 点空白处收起；菜单内部点击自己处理
    setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 0);
  }
}

function onOutside(e) {
  if (!open) { document.removeEventListener('pointerdown', onOutside, true); listening = false; return; }
  if (el && el.contains(e.target)) return;
  setOpen(false);
  document.removeEventListener('pointerdown', onOutside, true);
  listening = false;
}

/** 只挂一次；App 装配完成后调用 */
export function mount(App) {
  if (el) return el;
  el = document.createElement('div');
  el.className = 'qc';
  el.id = 'quick-create';
  el.innerHTML = `
    <div class="qc-menu" data-qc-menu>
      ${ITEMS.map((it) => `
        <button class="qc-item" data-qc="${it.key}">
          <span class="qc-dot"></span>
          <span class="qc-label">${it.label}</span>
          <span class="qc-hint">${it.hint}</span>
        </button>`).join('')}
    </div>
    <button class="qc-btn" data-qc-toggle aria-label="新建" aria-expanded="false">＋</button>`;
  document.body.appendChild(el);
  menu = el.querySelector('[data-qc-menu]');
  btn = el.querySelector('[data-qc-toggle]');

  btn.onclick = () => setOpen(!open);
  el.querySelectorAll('[data-qc]').forEach((b) => {
    b.onclick = () => {
      setOpen(false);
      const item = ITEMS.find((x) => x.key === b.dataset.qc);
      if (item) item.run(App);
    };
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) setOpen(false); });
  return el;
}

/** 渲染时同步显隐：引导配置资源阶段（无资源）不显示 */
export function sync(App) {
  if (!el) return;
  const show = !!(App && App.db && Array.isArray(App.db.resources) && App.db.resources.length);
  el.style.display = show ? '' : 'none';
  if (!show && open) setOpen(false);
}

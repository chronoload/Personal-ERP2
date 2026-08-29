// ============================================================
// views/hud.js — HUD 侧边栏（可开关）
// 目标 → 计划 → 活动 层级树，右上角常驻浮层（HUD 感），层级可展开/收起。
//  - 开关：顶栏 ☰ 按钮 或 面板 ✕；持久化 Prefs.hudEnabled
//  - 折叠态：模块内存（'g:{id}' 目标 / 'p:{id}' 计划 → true=收起；目标默认展开、计划默认收起）
//  - 活动列表每计划限 20 条防撑爆（预生成循环可能上百期）
//  - 点击活动行 → 打开编辑弹窗（日历/看板外又多一个入口）
// ============================================================
import { esc, badge, toast } from '../ui/helpers.js';
import { Prefs } from '../store/prefs.js';

const MAX_ACTS = 20;
const collapsed = {}; // 'g:x' / 'p:x' → true=收起
let refreshTimer = null;

export function isEnabled() { return Prefs.load().hudEnabled === true; }

export function setEnabled(v) {
  Prefs.set({ hudEnabled: !!v });
  sync();
  if (v) toast('HUD 侧边栏已开启', 'ok');
}

export function toggle() { setEnabled(!isEnabled()); }

// 每次 App.render 后的数据同步：防抖合并，避免手势切 Tab 等高频渲染时反复重建树
export function refresh() {
  if (!isEnabled()) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(sync, 250);
}

function sync() {
  let el = document.getElementById('hud-root');
  if (!isEnabled()) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'hud-root';
    el.style.cssText = [
      'position:fixed', 'top:56px', 'right:0', 'bottom:0', 'z-index:40',
      'width:min(330px,88vw)', 'background:rgba(18,22,30,.94)', 'color:#e8ebf0',
      'border-top-left-radius:14px', 'border-bottom-left-radius:14px',
      'padding:10px', 'box-sizing:border-box', 'overflow:auto',
      'box-shadow:-6px 0 24px rgba(0,0,0,.35)', 'backdrop-filter:blur(6px)',
    ].join(';');
    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-toggle]');
      if (t) { const k = t.dataset.toggle; collapsed[k] = !collapsed[k]; sync(); return; }
      const act = e.target.closest('[data-act]');
      if (act) { App.overview.openActModal(act.dataset.act); }
    });
    document.body.appendChild(el);
  }
  el.innerHTML = renderHTML(App.db);
  const close = el.querySelector('[data-hud-close]');
  if (close) close.onclick = () => setEnabled(false);
}

function renderHTML(db) {
  const actsOfPlan = (pid) => db.activities.filter((a) => (a.plan_ids || []).includes(pid));
  const rows = [];
  const actRow = (a) => `<div class="hud-act" data-act="${esc(a.id)}">${badge(a.status)}<span class="hud-act-t">${esc(a.title)}</span></div>`;
  const planNode = (p) => {
    const pk = 'p:' + p.id;
    const openP = !collapsed[pk];
    const acts = actsOfPlan(p.id);
    const blocked = App.engine.isPlanBlocked(db, p.id);
    rows.push(`<div class="hud-node hud-plan" data-toggle="${pk}">
      <span class="hud-caret">${openP ? '▾' : '▸'}</span>
      <span class="hud-dot" style="background:${esc(p.color || '#889')}"></span>
      <span class="hud-plan-t">${esc(p.title)}</span>
      <span class="hud-cnt">${acts.length}</span>${blocked ? '<span class="hud-block" title="预算耗尽">⛔</span>' : ''}</div>`);
    if (openP) {
      const shown = acts.slice(0, MAX_ACTS);
      for (const a of shown) rows.push(actRow(a));
      if (acts.length > MAX_ACTS) rows.push(`<div class="hud-more">…共 ${acts.length} 个活动</div>`);
    }
  };
  const goalNode = (g, plans) => {
    const gk = 'g:' + g.id;
    const openG = !collapsed[gk];
    const total = plans.reduce((s, p) => s + actsOfPlan(p.id).length, 0);
    rows.push(`<div class="hud-node hud-goal" data-toggle="${gk}">
      <span class="hud-caret">${openG ? '▾' : '▸'}</span>
      <b>🎯 ${esc(g.title)}</b><span class="hud-cnt">${plans.length} 计划 · ${total} 活动</span></div>`);
    if (openG) for (const p of plans) planNode(p);
  };

  for (const g of db.goals) goalNode(g, db.plans.filter((p) => p.goal_id === g.id));
  const orphanPlans = db.plans.filter((p) => !db.goals.some((g) => g.id === p.goal_id));
  if (orphanPlans.length) goalNode({ id: '__orphan', title: '未归组' }, orphanPlans);

  const noPlanActs = db.activities.filter((a) => !(a.plan_ids || []).length);
  if (noPlanActs.length) {
    const gk = 'g:__noplan';
    const openG = !collapsed[gk];
    rows.push(`<div class="hud-node hud-goal" data-toggle="${gk}">
      <span class="hud-caret">${openG ? '▾' : '▸'}</span><b>📦 无计划活动</b><span class="hud-cnt">${noPlanActs.length}</span></div>`);
    if (openG) for (const a of noPlanActs.slice(0, MAX_ACTS)) rows.push(actRow(a));
  }

  return `
    <div class="hud-head">
      <b>📊 HUD</b>
      <span class="muted">目标 → 计划 → 活动</span>
      <button class="btn sm" data-hud-close style="margin-left:auto">✕</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:1px;margin-top:8px">
      ${rows.join('') || '<div class="muted" style="padding:8px">暂无数据</div>'}
    </div>`;
}

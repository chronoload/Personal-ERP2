// ============================================================
// views/dayGuide.js
// 新一天引导模式：每天第一次启动应用时弹出，
// 根据启动时间引导：问候 → 建目标(可多个) → 建计划(可多个) → 排满一整天(逐个关联计划) → 今日清单。
// 完成/跳过后记录 dayGuideLast，当天不再打扰。
// ============================================================
import { esc } from '../ui/helpers.js';
import { icon } from '../ui/icons.js';
import { Prefs } from '../store/prefs.js';

const STEPS = ['welcome', 'goal', 'plan', 'acts', 'summary'];
let el = null;
// st: { App, step, goals:[{id,title}], plans:[{id,title}], lastPlanId, acts:[{title,start,minutes,plan_id}], slot }
let st = null;

function dayKey(d) { return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
function hm(d) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}
// 从当前时间取整到下一个半点，作为首个活动的开始
function firstSlot() {
  const d = new Date();
  d.setSeconds(0, 0);
  const min = d.getMinutes();
  d.setMinutes(min + (min % 30 === 0 ? 30 : 30 - (min % 30)));
  return d;
}

export function maybeShow(App) {
  const today = dayKey(new Date());
  const p = Prefs.load();
  if (p.dayGuideLast === today) return;
  if (!App.db.resources.length) return; // 首次初始化流程优先
  open(App);
}

function open(App) {
  st = {
    App, step: 'welcome',
    goals: [], plans: [],       // 本次引导中累计创建/选用的目标与计划
    lastPlanId: '',             // 最近一次关联的计划（新活动默认预选）
    acts: [], slot: firstSlot(),
  };
  if (!el) build();
  render();
  el.classList.add('show');
}

function close(done) {
  Prefs.set({ dayGuideLast: dayKey(new Date()) });
  el.classList.remove('show');
  if (!done && st && st.acts.length) toastSkip();
  st = null;
  if (done) { window.App.setTab('overview'); }
}
function toastMsg(msg, type) {
  import('../ui/helpers.js').then((m) => m.toast(msg, type));
}

function build() {
  el = document.createElement('div');
  el.id = 'dayGuide';
  el.className = 'dg-overlay';
  document.body.appendChild(el);
}

function head(title, sub) {
  return `<div class="dg-head"><div class="dg-greet">${greeting()}</div><h2>${title}</h2><p class="muted">${sub}</p></div>`;
}
function foot(backLabel, nextLabel, nextDisabled) {
  return `<div class="dg-foot">
    ${backLabel ? `<button class="btn" data-back>${esc(backLabel)}</button>` : '<span></span>'}
    ${nextLabel ? `<button class="btn primary" data-next ${nextDisabled ? 'disabled' : ''}>${esc(nextLabel)}</button>` : '<span></span>'}
  </div>`;
}
// 步骤进度点：goal → plan → acts 三步可视化
function stepDots(step) {
  const steps = ['goal', 'plan', 'acts'];
  const idx = steps.indexOf(step);
  if (idx === -1) return '';
  return `<div class="dg-dots">${steps.map((s, i) =>
    `<i class="${i < idx ? 'done' : i === idx ? 'on' : ''}"></i>`).join('')}</div>`;
}
// 已累计的目标/计划小芯片（展示已添加项，提示可继续追加）
function chips(list, emptyHint) {
  if (!list.length) return `<div class="muted" style="text-align:center;margin-bottom:8px">${emptyHint}</div>`;
  return `<div class="dg-chips">${list.map((x) => `<span class="dg-chip">${esc(x.title)}</span>`).join('')}</div>`;
}

function render() {
  const { App, step } = st;
  const db = App.db;
  let body = '';

  if (step === 'welcome') {
    body = `
      ${head('开启新的一天', `现在是 ${hm(new Date())}，把剩下的时间安排好`)}
      <div class="dg-cards">
        <div class="dg-card">${icon('target')} 定一个目标</div>
        <div class="dg-card">${icon('note')} 拆成今天的计划</div>
        <div class="dg-card">${icon('clock')} 从现在起排满一整天</div>
      </div>
      ${foot('先跳过', '开始规划')}`;
  }

  if (step === 'goal') {
    const goals = db.goals.map((g) => `<option value="${esc(g.id)}">${esc(g.title)}</option>`).join('');
    body = `
      ${head('第一步 · 目标', '长期方向，可连续添加多个，也可直接选用已有')}
      ${stepDots('goal')}
      ${chips(st.goals, '还没添加目标')}
      <div class="field"><label>新建目标</label><input id="dg-goal" placeholder="例：写完一本书"></div>
      <button class="btn sm" data-addg>${icon('plus')} 添加这个目标</button>
      <div class="dg-or">或选用已有目标</div>
      <select id="dg-goal-existing"><option value="">— 选择 —</option>${goals}</select>
      <button class="btn sm" data-adde style="margin-top:8px">${icon('plus')} 选用已有目标</button>
      ${foot('上一步', '下一步，定计划')}`;
  }

  if (step === 'plan') {
    // 计划必须挂在目标下：优先用本次引导建的目标，一个都没有则用库里的
    const goalSrc = st.goals.length ? st.goals : db.goals;
    const gOpts = goalSrc.map((g) => `<option value="${esc(g.id)}">${esc(g.title)}</option>`).join('')
      || '<option value="">（请先返回上一步建目标）</option>';
    body = `
      ${head('第二步 · 计划', '今天要推进的具体事项，可建多个')}
      ${stepDots('plan')}
      ${chips(st.plans, '还没添加计划')}
      <div class="field"><label>所属目标</label><select id="dg-plangoal">${gOpts}</select></div>
      <div class="field"><label>计划名称 *</label><input id="dg-plan" placeholder="例：每天写 2000 字"></div>
      <div class="field"><label>预算 价值元（留空 = 无限）</label><input id="dg-budget" type="number" min="0"></div>
      <button class="btn sm" data-addp>${icon('plus')} 添加这个计划</button>
      ${foot('上一步', '下一步，排活动')}`;
  }

  if (step === 'acts') {
    const planOpts = ['<option value="">不关联计划</option>']
      .concat(db.plans.map((p) => `<option value="${esc(p.id)}" ${p.id === st.lastPlanId ? 'selected' : ''}>${esc(p.title)}</option>`))
      .join('');
    const rows = st.acts.map((x, i) => `
      <div class="dg-act-row">
        <span class="dg-act-time">${hm(x.start)}</span>
        <span class="grow">${esc(x.title)}<span class="muted"> · ${x.minutes}m${x.plan_id ? ' · ' + esc((db.plans.find((p) => p.id === x.plan_id) || {}).title || '') : ''}</span></span>
        <button class="btn sm danger" data-del="${i}">${icon('close')}</button>
      </div>`).join('');
    body = `
      ${head('第三步 · 排满一整天', `从 ${hm(st.slot)} 起，新活动自动顺延`)}
      ${stepDots('acts')}
      <div class="dg-add">
        <select id="dg-act-plan" style="margin-bottom:8px">${planOpts}</select>
        <input id="dg-act-title" placeholder="活动名称，例：写第二章初稿">
        <div class="row-gap">
          <input id="dg-act-min" type="number" min="5" step="5" value="60" style="width:90px"><span class="muted">分钟</span>
          <button class="btn primary sm" data-add>${icon('plus')} 加入日程</button>
        </div>
      </div>
      <div class="dg-act-list">${rows || '<div class="empty">还没添加，从上一行开始吧</div>'}</div>
      ${foot('上一步', st.acts.length ? '预览今天' : '跳过预览')}`;
  }

  if (step === 'summary') {
    const rows = st.acts.map((x) => `
      <div class="dg-sum-row">
        <span class="dg-act-time" style="color:#4A7FBF">${hm(x.start)}</span>
        <span class="grow">${esc(x.title)}</span>
        <span class="muted">${x.minutes}m</span>
      </div>`).join('');
    const total = st.acts.reduce((s, x) => s + x.minutes, 0);
    body = `
      ${head('今天就绪 🎉', `${st.acts.length} 项活动 · 共 ${total >= 60 ? Math.floor(total / 60) + 'h' : ''}${total % 60 ? (total % 60) + 'm' : ''}`)}
      <div class="dg-act-list">${rows}</div>
      <div class="callout ok">按清单推进，每完成一项记得回来闭环入账。</div>
      ${foot('', '开始今天')}`;
  }

  el.innerHTML = `<div class="dg-panel accent-brand">${body}</div>`;

  // 绑定
  const back = el.querySelector('[data-back]');
  const next = el.querySelector('[data-next]');
  if (back) back.onclick = () => st._pendingBack && st._pendingBack();
  if (next) next.onclick = () => st._pendingNext && st._pendingNext();
  // 输入框内回车 = 点「下一步」（移动端省去抬手点按钮）
  el.querySelectorAll('input, select').forEach((inp) => {
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); st._pendingNext && st._pendingNext(); } };
  });

  // 各步的回调注入
  if (step === 'welcome') { st._pendingBack = () => close(false); st._pendingNext = () => { st.step = 'goal'; render(); }; }
  if (step === 'goal') {
    st._pendingBack = () => { st.step = 'welcome'; render(); };
    st._pendingNext = () => { st.step = 'plan'; render(); };
    const ag = el.querySelector('[data-addg]');
    const ae = el.querySelector('[data-adde]');
    if (ag) ag.onclick = () => addGoal(false);
    if (ae) ae.onclick = () => addGoal(true);
  }
  if (step === 'plan') {
    st._pendingBack = () => { st.step = 'goal'; render(); };
    st._pendingNext = () => { st.step = 'acts'; render(); };
    const ap = el.querySelector('[data-addp]');
    if (ap) ap.onclick = addPlan;
  }
  if (step === 'acts') {
    st._pendingBack = () => { st.step = 'plan'; render(); };
    st._pendingNext = () => finishActs();
    const add = el.querySelector('[data-add]');
    if (add) add.onclick = addAct;
    // 排活动步骤：回车语义是「加入日程」，覆盖通用「下一步」绑定
    el.querySelectorAll('#dg-act-title, #dg-act-min').forEach((inp) => {
      inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addAct(); } };
    });
    el.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => {
        st.acts.splice(Number(b.dataset.del), 1);
        reflow(); // 后续活动时间回退重排
        render();
      };
    });
    const t = el.querySelector('#dg-act-title');
    if (t) t.focus();
  }
  if (step === 'summary') {
    st._pendingNext = () => close(true);
  }
}

// ---- 第一步：目标（可连续添加） ----
function addGoal(useExisting) {
  const existSel = el.querySelector('#dg-goal-existing');
  if (useExisting) {
    const v = existSel ? existSel.value : '';
    if (!v) return toastMsg('请先在上方选择一个已有目标', 'err');
    const g = st.App.db.goals.find((x) => x.id === v);
    if (!g) return toastMsg('目标不存在', 'err');
    if (!st.goals.some((x) => x.id === v)) st.goals.push({ id: v, title: g.title });
    render();
    return;
  }
  const inp = el.querySelector('#dg-goal');
  const title = inp.value.trim();
  if (!title) { inp.focus(); return; }
  const r = st.App.engine.createGoal(st.App.db, { title });
  if (!r.ok) return toastMsg(r.error, 'err');
  const g = st.App.db.goals[st.App.db.goals.length - 1];
  st.goals.push({ id: g.id, title: g.title });
  render();
}

// ---- 第二步：计划（可连续添加） ----
function addPlan() {
  const name = el.querySelector('#dg-plan').value.trim();
  if (!name) { el.querySelector('#dg-plan').focus(); return; }
  const goalSel = el.querySelector('#dg-plangoal');
  const goal_id = goalSel ? goalSel.value : '';
  if (!goal_id) return toastMsg('没有可选目标，请回上一步先建目标', 'err');
  const bRaw = el.querySelector('#dg-budget').value.trim();
  const budget = bRaw === '' ? null : Number(bRaw);
  const r = st.App.engine.createPlan(st.App.db, { goal_id, title: name, budget });
  if (!r.ok) return toastMsg(r.error, 'err');
  const p = st.App.db.plans[st.App.db.plans.length - 1];
  st.plans.push({ id: p.id, title: p.title });
  st.lastPlanId = p.id;
  render();
}

// ---- 第三步：排活动（逐个可选关联计划） ----
function addAct() {
  const t = el.querySelector('#dg-act-title');
  const m = el.querySelector('#dg-act-min');
  const ps = el.querySelector('#dg-act-plan');
  const title = t.value.trim();
  const minutes = Math.max(5, Number(m.value) || 60);
  if (!title) { t.focus(); return; }
  const plan_id = ps && ps.value ? ps.value : '';
  if (plan_id) st.lastPlanId = plan_id; // 连续添加同类活动时保持上次关联
  st.acts.push({ title, start: new Date(st.slot), minutes, plan_id });
  st.slot = new Date(st.slot.getTime() + minutes * 60000);
  render();
  const nt = el.querySelector('#dg-act-title');
  if (nt) nt.focus();
}

function reflow() {
  // 保留首项原定时间（删中间项时不把整天的起点拉回「现在」），仅后续顺延
  let s = st.acts.length ? st.acts[0].start : firstSlot();
  for (const x of st.acts) { x.start = new Date(s); s = new Date(s.getTime() + x.minutes * 60000); }
  st.slot = s;
}

function finishActs() {
  if (!st.acts.length) { st.step = 'summary'; render(); return; }
  const { App } = st;
  const todayK = dayKey(new Date());
  for (const x of st.acts) {
    const r = App.engine.createActivity(App.db, {
      title: x.title, note: '',
      plan_ids: x.plan_id ? [x.plan_id] : [],
      planned_start: `${pad(todayK)}T${hm(x.start)}`,
      planned_minutes: x.minutes,
    });
    if (!r.ok) { toastMsg(r.error, 'err'); return; }
  }
  App.refresh();
  st.step = 'summary'; render();
}

function pad(k) {
  const [y, m, d] = String(k).split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ============================================================
// views/goals.js
// 「目标与计划」Tab —— 战略层
//   目标(Goal) 1:N 计划(Plan)；计划 18C 状态机；19BC 混合预算
// ============================================================
import { esc, fmtNum, badge, openModal, toast } from '../ui/helpers.js';
import { PLAN_COLORS } from '../domain/engine.js';
import { Prefs } from '../store/prefs.js';

// 折叠状态（目标/计划可收起展开，跨会话记忆）
const collapsedGoals = new Set(Prefs.load().collapsedGoals || []);
const collapsedPlans = new Set(Prefs.load().collapsedPlans || []);
// 内联 onclick 字符串参数转义：反斜杠/单引号按 JS 转义，双引号按 HTML 属性转义
function jsStr(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
// 颜色白名单（同 overview.js）：仅放行 #rgb~#rrggbbaa 十六进制，其余回落中性色，防 style 注入
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
function safeColor(c) {
  if (typeof c !== 'string') return null;
  const t = c.trim();
  return COLOR_RE.test(t) ? t : null;
}
function persistCollapsed() {
  Prefs.set({ collapsedGoals: [...collapsedGoals], collapsedPlans: [...collapsedPlans] });
}
export function toggleGoal(id) {
  collapsedGoals.has(id) ? collapsedGoals.delete(id) : collapsedGoals.add(id);
  persistCollapsed(); App.refresh();
}
export function togglePlan(id) {
  collapsedPlans.has(id) ? collapsedPlans.delete(id) : collapsedPlans.add(id);
  persistCollapsed(); App.refresh();
}
export function openGoalModal(editId) {
  const g = editId ? App.db.goals.find((x) => x.id === editId) : null;
  const m = openModal({
    title: g ? '编辑目标' : '新建目标',
    bodyHTML: `
      <div class="field"><label>目标名称 *</label><input id="f-gname" value="${esc(g?.title || '')}" placeholder="例：写一本书"></div>
      <div class="field"><label>描述</label><input id="f-gdesc" value="${esc(g?.desc || '')}"></div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>保存</button>`,
  });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const r = g
      ? App.engine.updateGoal(App.db, g.id, { title: m.q('#f-gname').value, desc: m.q('#f-gdesc').value })
      : App.engine.createGoal(App.db, { title: m.q('#f-gname').value, desc: m.q('#f-gdesc').value });
    if (!r.ok) return toast(r.error, 'err');
    m.close(); App.refresh();
  };
}

export async function delGoal(id) {
  const g = App.db.goals.find((x) => x.id === id);
  if (!g) return;
  const im = App.engine.goalDeleteImpact(App.db, id);
  const parts = [`${im.plans} 个计划`];
  if (im.acts) parts.push(`级联删除 ${im.acts} 个活动（含 ${im.outs} 个产出、${im.vfs} 条价值流及流水）`);
  if (im.unlink) parts.push(`${im.unlink} 个多计划活动解除关联（保留）`);
  const msg = `删除目标「${g.title}」将连带删除：${parts.join('；')}。确定？`;
  if (!(await App.system.confirm({ title: '删除目标', message: msg }))) return;
  const r = App.engine.deleteGoalCascade(App.db, id);
  if (!r.ok) return toast(r.error, 'err');
  App.refresh(); toast('目标已删除');
}

export function openPlanModal(goalId, editId) {
  const p = editId ? App.db.plans.find((x) => x.id === editId) : null;
  const goalOpts = App.db.goals.map((g) =>
    `<option value="${g.id}" ${g.id === (p ? p.goal_id : goalId) ? 'selected' : ''}>${esc(g.title)}</option>`).join('');
  const defColor = p?.color || PLAN_COLORS[0];
  const activeRes = App.db.resources.filter((r) => r.status === 'Active');
  const resOptsPlan = (sel) => activeRes.map((r) =>
    `<option value="${esc(r.id)}" ${r.id === sel ? 'selected' : ''}>${esc(r.name)}</option>`).join('')
    || '<option value="">（请先创建资源）</option>';
  const defPE = p?.default_expenses || [];
  const defPI = p?.default_incomes || [];
  const defRowHTML = (entry) => `
    <div class="preset-row" style="display:grid;grid-template-columns:1fr 84px 1fr auto;gap:6px;align-items:center;margin:4px 0">
      <select class="pr-res">${resOptsPlan(entry ? entry.resource_id : '')}</select>
      <input class="pr-amt" type="number" min="0" step="0.01" value="${esc(entry ? entry.amount : '')}" placeholder="金额">
      <input class="pr-note" value="${esc(entry ? (entry.note || '') : '')}" placeholder="备注">
      <button type="button" class="btn sm pr-del" title="移除">✕</button>
    </div>`;
  const m = openModal({
    title: p ? '编辑计划' : '新建计划（挂在目标下）',
    bodyHTML: `
      <div class="field"><label>所属目标</label><select id="f-pgoal">${goalOpts}</select></div>
      <div class="field"><label>计划名称 *</label><input id="f-pname" value="${esc(p?.title || '')}" placeholder="例：每天写 2000 字"></div>
      <div class="field"><label>计划颜色（按计划染色任务卡片）</label>
        <div class="color-row">${PLAN_COLORS.map((c) => `<button type="button" class="swatch ${c === defColor ? 'on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}</div>
      </div>
      <div class="field"><label>预算 价值元（留空 = 无限 ∞，19BC 混合预算）</label><input id="f-pbudget" type="number" min="0" value="${Number.isFinite(p?.budget) ? p.budget : ''}" placeholder="∞"></div>
      <div class="step-divider">默认预设收支（该计划下新建活动自动继承，可空 · 多资源）</div>
      <div style="font-size:12px;font-weight:700;color:#3f4753">默认支出<button type="button" class="btn sm" id="pd-e-add" style="float:right">＋ 添加</button></div>
      <div id="pd-e-rows">${defPE.map((x) => defRowHTML(x)).join('')}</div>
      <div style="font-size:12px;font-weight:700;color:#3f4753;margin-top:6px">默认收入<button type="button" class="btn sm" id="pd-i-add" style="float:right">＋ 添加</button></div>
      <div id="pd-i-rows">${defPI.map((x) => defRowHTML(x)).join('')}</div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>保存</button>`,
  });
  m.qa('.swatch').forEach((s) => {
    s.onclick = () => { m.qa('.swatch').forEach((x) => x.classList.remove('on')); s.classList.add('on'); };
  });
  m.q('[data-cancel]').onclick = () => m.close();
  // 多行默认预设编辑器：＋添加 / ✕移除（事件委托）
  const bindRows = (boxId, addId) => {
    const box = m.q('#' + boxId);
    const add = m.q('#' + addId);
    if (box) box.addEventListener('click', (e) => { const d = e.target.closest('.pr-del'); if (d) d.closest('.preset-row').remove(); });
    if (add) add.onclick = () => { box.insertAdjacentHTML('beforeend', defRowHTML(null)); };
  };
  bindRows('pd-e-rows', 'pd-e-add');
  bindRows('pd-i-rows', 'pd-i-add');
  m.q('[data-save]').onclick = () => {
    const bRaw = m.q('#f-pbudget').value.trim();
    const budget = bRaw === '' ? null : Number(bRaw);
    const color = m.q('.swatch.on')?.dataset.c || null;
    const readRows = (boxId) => [...m.q('#' + boxId).querySelectorAll('.preset-row')].map((row) => ({
      resource_id: row.querySelector('.pr-res').value,
      amount: row.querySelector('.pr-amt').value,
      note: row.querySelector('.pr-note').value,
    }));
    const payload = {
      goal_id: m.q('#f-pgoal').value, title: m.q('#f-pname').value, budget, color,
      default_expenses: readRows('pd-e-rows'),
      default_incomes: readRows('pd-i-rows'),
    };
    const r = p
      ? App.engine.updatePlan(App.db, p.id, payload)
      : App.engine.createPlan(App.db, payload);
    if (!r.ok) return toast(r.error, 'err');
    m.close(); App.refresh();
  };
}

export async function delPlan(id) {
  const p = App.db.plans.find((x) => x.id === id);
  if (!p) return;
  const im = App.engine.planDeleteImpact(App.db, id);
  const parts = [];
  if (im.acts) parts.push(`级联删除 ${im.acts} 个活动（含 ${im.outs} 个产出、${im.vfs} 条价值流及流水）`);
  if (im.unlink) parts.push(`${im.unlink} 个多计划活动解除关联（保留）`);
  const msg = parts.length ? `删除计划「${p.title}」将：${parts.join('；')}。确定？` : `删除计划「${p.title}」？`;
  if (!(await App.system.confirm({ title: '删除计划', message: msg }))) return;
  const r = App.engine.deletePlanCascade(App.db, id);
  if (!r.ok) return toast(r.error, 'err');
  App.refresh(); toast('计划已删除');
}

// 计划状态：下拉选择切换（非法流转由引擎拒绝）
export function setPlanStatus(pid, status) {
  const r = App.engine.setPlanStatus(App.db, pid, status);
  if (!r.ok) return toast(r.error, 'err');
  App.refresh();
}

function planCard(App, p) {
  const { engine } = App;
  const cost = engine.planCost(App.db, p.id);
  const blocked = engine.isPlanBlocked(App.db, p.id);
  const pct = p.budget !== null ? Math.min(100, (cost / p.budget) * 100) : 0;
  const acts = App.db.activities.filter((a) => (a.plan_ids || []).includes(p.id));
  const collapsed = collapsedPlans.has(p.id);
  return `
    <div class="plan-card ${collapsed ? 'collapsed' : ''}" style="border-left:4px solid ${safeColor(p.color) || '#e5e8ee'}">
      <div class="plan-head" onclick="App.goals.togglePlan('${jsStr(p.id)}')" title="点击收起 / 展开">
        <button class="collapse-btn" tabindex="-1" onclick="event.stopPropagation();App.goals.togglePlan('${jsStr(p.id)}')" aria-label="收起/展开">${collapsed ? '▸' : '▾'}</button>
        <div class="grow">
          <span class="plan-chip" style="background:${safeColor(p.color) || '#e5e8ee'}"></span>
          <b>${esc(p.title)}</b> ${badge(p.status)}
          <span class="muted">${acts.length} 活动</span>
        </div>
        <span class="muted">预算 ${p.budget === null ? '∞' : fmtNum(p.budget)} · 已耗 ${fmtNum(cost)}${p.budget !== null ? ` · ${pct.toFixed(0)}%` : ''}</span>
      </div>
      <div class="plan-details ${collapsed ? 'hidden' : ''}">
      ${p.budget !== null ? `
        <div class="progress"><i class="bar ${blocked ? 'danger' : pct >= 70 ? 'warn' : ''}" style="width:${pct}%"></i></div>
        ${blocked ? '<div class="muted warn">⛔ 硬约束触发：禁止新活动开始/完成</div>' : ''}` : ''}
      ${acts.length ? `
      <div class="plan-acts">
        <div class="plan-acts-head"><span>活动（${acts.length}）</span><span class="muted">点击可编辑</span></div>
        ${acts.map((a) => `
          <div class="plan-act" onclick="event.stopPropagation();App.overview.openActModal('${jsStr(a.id)}')" title="点击编辑">
            <span class="grow">
              ${esc(a.title)}${a.planned_minutes ? ` <span class="muted">· ${a.planned_minutes}m</span>` : ''}
              ${a.note ? `<div class="plan-act-note">📝 ${esc(a.note)}</div>` : ''}
            </span>
            ${badge(a.status)}
          </div>`).join('')}
      </div>` : ''}
      <div class="row-gap" style="margin-top:8px" onclick="event.stopPropagation()">
        <button class="btn sm primary" onclick="App.overview.openActModal(null,'${jsStr(p.id)}')">＋ 活动</button>
        <label class="status-select">状态
          <select onchange="App.goals.setPlanStatus('${jsStr(p.id)}', this.value)">
            <option value="Active" ${p.status === 'Active' ? 'selected' : ''}>进行中</option>
            <option value="Paused" ${p.status === 'Paused' ? 'selected' : ''}>已暂停</option>
            <option value="Completed" ${p.status === 'Completed' ? 'selected' : ''}>已完成</option>
            <option value="Archived" ${p.status === 'Archived' ? 'selected' : ''}>已归档</option>
          </select>
        </label>
        <span class="grow"></span>
        <button class="btn sm" onclick="App.goals.openPlanModal('${jsStr(p.goal_id)}','${jsStr(p.id)}')">编辑</button>
        <button class="btn sm danger" onclick="App.goals.delPlan('${jsStr(p.id)}')">删除</button>
      </div>
      </div>
    </div>`;
}

export function render(App, el) {
  const { db } = App;
  if (!db.goals.length) {
    el.innerHTML = `
      <div class="card"><div class="card-head"><h3>目标与计划</h3></div>
        <div class="plan-add" onclick="App.goals.openGoalModal()">＋ 点击创建你的第一个目标</div>
        <button class="btn primary" style="margin-top:10px" onclick="App.goals.openGoalModal()">＋ 创建目标</button>
      </div>`;
    return;
  }
  el.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>目标 Goals <span class="muted">1 : N 计划</span></h3>
        <button class="btn sm" onclick="App.goals.openGoalModal()">＋ 新建目标</button>
      </div>
      ${db.goals.map((g) => {
        const plans = db.plans.filter((p) => p.goal_id === g.id);
        const gcoll = collapsedGoals.has(g.id);
        return `
          <div class="goal-block ${gcoll ? 'collapsed' : ''}">
            <div class="goal-head" onclick="App.goals.toggleGoal('${jsStr(g.id)}')" title="点击收起 / 展开">
              <button class="collapse-btn" tabindex="-1" onclick="event.stopPropagation();App.goals.toggleGoal('${jsStr(g.id)}')" aria-label="收起/展开">${gcoll ? '▸' : '▾'}</button>
              <div class="grow">
                <b class="goal-title">🎯 ${esc(g.title)}</b>
                <span class="muted">${esc(g.desc || '')} · ${plans.length} 个计划</span>
              </div>
              <div class="row-gap" onclick="event.stopPropagation()">
                <button class="btn sm primary" onclick="App.goals.openPlanModal('${jsStr(g.id)}')">＋ 计划</button>
                <button class="btn sm" onclick="App.goals.openGoalModal('${jsStr(g.id)}')">编辑</button>
                <button class="btn sm danger" onclick="App.goals.delGoal('${jsStr(g.id)}')">删除</button>
              </div>
            </div>
            <div class="goal-plans ${gcoll ? 'hidden' : ''}">
            ${plans.length ? `<div class="plan-list">${plans.map((p) => planCard(App, p)).join('')}</div>` : `<div class="plan-add" onclick="App.goals.openPlanModal('${jsStr(g.id)}')">＋ 点击添加计划</div>`}
            </div>
          </div>`;
      }).join('')}
    </div>
  `;
}

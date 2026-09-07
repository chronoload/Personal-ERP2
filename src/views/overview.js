// ============================================================
// views/overview.js
// 「活动」Tab —— 主战场：
//   资源总览 / 兑换规则 / 活动看板(五态) / 价值流
// 所有写操作均经 App.engine（不变量强制），成功后才 refresh。
// ============================================================
import { esc, fmtNum, fmtDate, fmtDateTime, badge, openModal, closeModal, toast, btn, empty, resColor } from '../ui/helpers.js';
import * as calendar from './calendar.js';
import { Prefs } from '../store/prefs.js';
import { themeStyle, themePickerHTML, bindThemePicker, readImageAsDataURL, themeTone, sampleImageTone } from '../ui/themes.js';
import { defaultStartPrefill } from '../domain/schedule.js';

// 批量排程入口：re-export 后自动挂到 App.overview.openBatchCreate
export { openBatchCreate } from './batchCreate.js';

const REPEAT_LABEL = { daily: '每天', weekday: '工作日', weekly: '每周', monthly: '每月' };

// 计划截止时刻的 HH:mm 部分（无则 null）
function plannedEndOf(a) {
  const m = String(a && a.planned_end || '').match(/T(\d{1,2}:\d{2})/);
  return m ? m[1] : null;
}

// 语境辅助：今天（补零 YYYY-MM-DD）、由计划标题推导活动标题建议
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// YYYY-M-D / YYYY-MM-DD → 补零（date input 需要）
function toDateInput(s) {
  if (!s) return '';
  const [y, m, d] = String(s).split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function suggestTitle(planTitle) {
  const t = String(planTitle || '').trim();
  const stripped = t.replace(/^(每天|每日|每周|每月|工作日|按日|按周|按月)\s*/, '').trim();
  return stripped || t;
}
// #rrggbb → rgba(..., alpha)
function hexToRgba(hex, alpha) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (Number.isNaN(n)) return `rgba(0,0,0,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
// 活动关联计划的染色（取第一个有颜色的计划）
function activityPlanColor(db, planIds) {
  for (const pid of planIds) {
    const p = db.plans.find((x) => x.id === pid);
    const c = p && safeColor(p.color);
    if (c) return c;
  }
  return null;
}

// 内联事件参数转义：按 JS 单引号字符串字面量转义 \ 和 '；
// " 转为 \x22 防止提前闭合双引号 HTML 属性；换行转为转义序列防断行
function jsStr(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\x22')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

function safeColor(c) {
  if (typeof c !== 'string') return null;
  const t = c.trim();
  return COLOR_RE.test(t) ? t : null;
}

function safeGradient(v) {
  if (typeof v !== 'string' || !v || v.length > 300) return null;
  if (!/^linear-gradient\([0-9a-fA-F#,.\s%()-]+\)$/i.test(v)) return null;
  const hexes = v.match(/#[0-9a-fA-F]+/g) || [];
  if ((v.match(/#/g) || []).length !== hexes.length) return null;
  return hexes.every((h) => COLOR_RE.test(h)) ? v : null;
}

function safeTheme(t) {
  if (!t || typeof t !== 'object') return null;
  if (t.type === 'gradient') {
    const v = safeGradient(t.value);
    return v ? { type: 'gradient', value: v } : null;
  }
  if (t.type === 'image') {
    const url = t.url;
    if (typeof url === 'string' && url.startsWith('data:image/') && url.length <= 3000000) {
      return { type: 'image', url };
    }
    return null;
  }
  return null;
}





// ---------------- 活动：新建 / 编辑 / 完成弹窗 ----------------
// prePlanId：从「目标与计划」Tab 进来时预选该计划；presetStart：日历快捷新建预填该日
export function openActModal(editId, prePlanId, presetStart, presetMinutes, presetTitle) {
  const { db, engine } = App;
  const a = editId ? db.activities.find((x) => x.id === editId) : null;
  const selected = new Set(a ? a.plan_ids : (prePlanId ? [prePlanId] : []));
  // 语境预填：新建时默认今天/上次用时/上次循环；从计划进来推导标题建议
  const prefs = Prefs.load();
  const plan = prePlanId ? db.plans.find((p) => p.id === prePlanId) : null;
  const defTitle = a ? a.title : (presetTitle || (plan ? suggestTitle(plan.title) : ''));
  const defStart = a ? (a.planned_start || (toDateInput(a.planned_date) + 'T09:00')) : (presetStart || defaultStartPrefill(Date.now()));
  const defMin = a && a.planned_minutes ? a.planned_minutes : (presetMinutes ?? prefs.lastMinutes ?? 60);
  const defRepeat = a ? a.repeat : (prefs.lastRepeat ?? '');
  let chosenTheme = a && a.theme ? safeTheme(a.theme) : null;
  // 预设收支（多资源，同 Goods.costs）：编辑 → 活动自身预设；新建 → 预填首个关联计划的默认（可再改，保存即快照）
  const activeRes = db.resources.filter((r) => r.status === 'Active');
  const resOptsAct = (sel) => activeRes.map((r) =>
    `<option value="${esc(r.id)}" ${r.id === sel ? 'selected' : ''}>${esc(r.name)}（余额 ${fmtNum(engine.balanceOf(db, r.id))}）</option>`).join('')
    || '<option value="">（请先创建资源）</option>';
  let defPE = [], defPI = [];
  if (a) { defPE = a.preset_expenses || []; defPI = a.preset_incomes || []; }
  else {
    const srcPlanId = prePlanId || (selected.size ? [...selected][0] : null);
    const sp = srcPlanId ? db.plans.find((x) => x.id === srcPlanId) : null;
    if (sp) { defPE = sp.default_expenses || []; defPI = sp.default_incomes || []; }
  }
  const hasPreset = defPE.length > 0 || defPI.length > 0;
  // 一行 = 资源 + 金额 + 备注 + 移除
  const presetRowHTML = (entry) => `
    <div class="preset-row" style="display:grid;grid-template-columns:1fr 84px 1fr auto;gap:6px;align-items:center;margin:4px 0">
      <select class="pr-res">${resOptsAct(entry ? entry.resource_id : '')}</select>
      <input class="pr-amt" type="number" min="0" step="0.01" value="${esc(entry ? entry.amount : '')}" placeholder="金额">
      <input class="pr-note" value="${esc(entry ? (entry.note || '') : '')}" placeholder="备注">
      <button type="button" class="btn sm pr-del" title="移除">✕</button>
    </div>`;
  const plansHTML = () =>
    db.plans.map((p) =>
      `<label class="chk"><input type="checkbox" value="${esc(p.id)}" ${selected.has(p.id) ? 'checked' : ''}> ${esc(p.title)}</label>`
    ).join('') || '<div class="muted">请先创建计划</div>';
  const goalOptsHTML = (selectedId) =>
    db.goals.map((g) => `<option value="${esc(g.id)}" ${g.id === selectedId ? 'selected' : ''}>${esc(g.title)}</option>`).join('')
    || '<option value="">（请先创建目标）</option>';

  const m = openModal({
    title: a ? '编辑活动' : '新建活动',
    bodyHTML: `
      <div class="field"><label>活动名称 *</label><input id="f-aname" value="${esc(defTitle)}" placeholder="例：写 2000 字章节 1"></div>
      <div class="field"><label>备注</label><input id="f-anote" value="${esc(a?.note || '')}" placeholder="例：卡在第二章，注意节奏"></div>

      <div class="step-divider">关联计划（多选 N:M）</div>
      <div class="chk-group" id="actPlanChips">${plansHTML()}</div>
      <div class="row-gap" style="margin-top:8px">
        <button class="btn sm" data-newplan>＋ 新建计划</button>
        <button class="btn sm" data-newgoal>＋ 新建目标</button>
      </div>
      <div id="quick-create" data-enter-zone style="display:none;border:1px dashed #dfe3ea;border-radius:10px;padding:12px;margin-top:10px">
        <div id="quick-goal" style="display:none">
          <div class="step-divider">新目标</div>
          <div class="field"><label>目标名称 *</label><input id="f-qgoal" placeholder="例：写一本书"></div>
          <div class="field"><label>描述</label><input id="f-qgoaldesc"></div>
          <button class="btn sm primary" data-enter data-savegoal>保存目标</button>
        </div>
        <div id="quick-plan" style="display:none">
          <div class="step-divider">新计划</div>
          <div class="field"><label>所属目标</label><select id="f-qplangoal">${goalOptsHTML()}</select></div>
          <div class="field"><label>计划名称 *</label><input id="f-qplan" placeholder="例：每天写 2000 字"></div>
          <div class="field"><label>预算 价值元（留空 = 无限 ∞）</label><input id="f-qbudget" type="number" min="0"></div>
          <button class="btn sm primary" data-enter data-saveplan>保存计划</button>
        </div>
      </div>

      <div class="grid2">
        <div class="field"><label>计划开始时间（分钟级）</label><input id="f-ps" type="datetime-local" value="${esc(defStart)}"></div>
        <div class="field"><label>计划投入（分钟）</label><input id="f-apmin" type="number" min="0" value="${esc(defMin)}"></div>
      </div>
      <div id="atomic-preview" class="muted" style="display:none;font-size:12px;margin:2px 0 4px"></div>
      <label class="chk" id="keep-conflict-row" style="display:none;margin:0 0 8px"><input type="checkbox" id="f-keepconflict"> 坚持此时间（与冲突活动捆绑，开始时仲裁先后）</label>
      <div class="grid2">
        <div class="field"><label>循环</label><select id="f-arepeat">
          <option value="">不循环</option>
          <option value="daily" ${defRepeat === 'daily' ? 'selected' : ''}>每天</option>
          <option value="weekday" ${defRepeat === 'weekday' ? 'selected' : ''}>工作日</option>
          <option value="weekly" ${defRepeat === 'weekly' ? 'selected' : ''}>每周</option>
          <option value="monthly" ${defRepeat === 'monthly' ? 'selected' : ''}>每月</option>
        </select></div>
        <div class="field"><label>循环结束日（留空 = 一直）</label><input id="f-arepuntil" type="date" value="${esc(a?.repeat_until || '')}"></div>
      </div>
      ${a && a.repeat ? `
      <div class="field"><label>编辑范围（循环）</label>
        <div class="row-gap" id="series-scope">
          <button type="button" class="btn sm primary" data-scope="all">全部</button>
          <button type="button" class="btn sm" data-scope="following">此期及后续</button>
          <button type="button" class="btn sm" data-scope="only">仅此期</button>
        </div>
        <div class="muted" style="margin-top:4px">仅此期 = 把当期拆成独立活动；此期及后续 = 当期与其后全部期次日期整体平移</div>
      </div>` : ''}
      <label class="chk" style="margin:0 0 4px"><input type="checkbox" id="f-haspreset" ${hasPreset ? 'checked' : ''}> ⚡ 预设收支（完成后一键入账，可空 · 多资源）</label>
      <div id="preset-rows" class="preset-rows" style="${hasPreset ? '' : 'display:none'}">
        <div class="step-divider">预设支出（消耗 · 可空）<button type="button" class="btn sm" id="pe-add">＋ 添加</button></div>
        <div id="pe-rows">${defPE.map((x) => presetRowHTML(x)).join('')}</div>
        <div class="step-divider">预设收入（获得 · 可空）<button type="button" class="btn sm" id="pi-add">＋ 添加</button></div>
        <div id="pi-rows">${defPI.map((x) => presetRowHTML(x)).join('')}</div>
      </div>
      <div class="field"><label>卡片主题（虚化背景，可选）</label><div id="actThemePicker"></div></div>`,
    footerHTML: `<button class="btn danger" data-del style="margin-right:auto" ${a ? '' : 'hidden'}>删除</button><button class="btn" data-cancel>取消</button><button class="btn primary" data-save>${a ? '保存' : '创建（Planned）'}</button>`,
  });

  const quick = m.q('#quick-create');
  const qGoal = m.q('#quick-goal');
  const qPlan = m.q('#quick-plan');
  const refreshPlanChips = (selId) => { if (selId) selected.add(selId); m.q('#actPlanChips').innerHTML = plansHTML(); };
  const refreshGoalSelect = (selId) => { m.q('#f-qplangoal').innerHTML = goalOptsHTML(selId); };

  // 卡片主题选择（渐变 / 上传图片 / 无）
  const tp = m.q('#actThemePicker');
  if (tp) {
    tp.innerHTML = themePickerHTML({ chosen: chosenTheme });
    bindThemePicker(tp, {
      onPick: (t) => { chosenTheme = t; },
      onUpload: (f) => readImageAsDataURL(f, (url) => { if (url) chosenTheme = { type: 'image', url }; }),
    });
  }
  // 预设收支折叠开关
  const presetToggle = m.q('#f-haspreset');
  const presetBox = m.q('#preset-rows');
  if (presetToggle && presetBox) {
    presetToggle.onchange = () => { presetBox.style.display = presetToggle.checked ? '' : 'none'; };
  }
  // 多行预设编辑器：＋添加 / ✕移除（事件委托，动态行无需逐个绑定）
  const bindPresetRows = (boxId, addBtnId) => {
    const box = m.q('#' + boxId);
    const add = m.q('#' + addBtnId);
    if (box) box.addEventListener('click', (e) => { const d = e.target.closest('.pr-del'); if (d) d.closest('.preset-row').remove(); });
    if (add) add.onclick = () => { box.insertAdjacentHTML('beforeend', presetRowHTML(null)); };
  };
  bindPresetRows('pe-rows', 'pe-add');
  bindPresetRows('pi-rows', 'pi-add');

  // ＋ 新建计划：无目标则先引导建目标，否则展开计划表单
  m.q('[data-newplan]').onclick = () => {
    quick.style.display = 'block';
    if (!db.goals.length) {
      qGoal.style.display = 'block'; qPlan.style.display = 'none';
      toast('请先创建目标', 'info'); m.q('#f-qgoal').focus();
    } else {
      qPlan.style.display = 'block'; qGoal.style.display = 'none';
      refreshGoalSelect(); m.q('#f-qplan').focus();
    }
  };
  // ＋ 新建目标：展开目标表单
  m.q('[data-newgoal]').onclick = () => {
    quick.style.display = 'block'; qGoal.style.display = 'block'; qPlan.style.display = 'none';
    m.q('#f-qgoal').focus();
  };
  // 保存目标 → 刷新目标下拉并自动切到计划表单
  m.q('[data-savegoal]').onclick = () => {
    const r = engine.createGoal(db, { title: m.q('#f-qgoal').value, desc: m.q('#f-qgoaldesc').value });
    if (!r.ok) return toast(r.error, 'err');
    const gid = db.goals[db.goals.length - 1].id;
    m.q('#f-qgoal').value = ''; m.q('#f-qgoaldesc').value = '';
    refreshGoalSelect(gid);
    qGoal.style.display = 'none'; qPlan.style.display = 'block';
    toast('目标已创建，可继续建计划');
    m.q('#f-qplan').focus();
  };
  // 保存计划 → 刷新计划多选并默认勾选新计划
  m.q('[data-saveplan]').onclick = () => {
    const bRaw = m.q('#f-qbudget').value.trim();
    const budget = bRaw === '' ? null : Number(bRaw);
    const r = engine.createPlan(db, { goal_id: m.q('#f-qplangoal').value, title: m.q('#f-qplan').value, budget });
    if (!r.ok) return toast(r.error, 'err');
    const pid = db.plans[db.plans.length - 1].id;
    m.q('#f-qplan').value = ''; m.q('#f-qbudget').value = '';
    refreshPlanChips(pid);
    toast('计划已创建并勾选', 'ok');
  };

  m.q('[data-cancel]').onclick = () => m.close();
  // 编辑态删除（日历/看板里都能直接删活动，不必切换页面）
  const delBtn = m.q('[data-del]');
  if (delBtn && a) delBtn.onclick = () => { m.close(); delAct(a.id); };
  // 时间原子性实时预览：截止时刻推算 + 冲突检测（撞车时给出「坚持并捆绑」选项）
  const hm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const previewAtomic = () => {
    const box = m.q('#atomic-preview');
    const row = m.q('#keep-conflict-row');
    const ps = m.q('#f-ps').value;
    const mins = Number(m.q('#f-apmin').value) || 0;
    if (!ps || mins <= 0 || isNaN(new Date(ps).getTime())) { box.style.display = 'none'; row.style.display = 'none'; return; }
    const s = new Date(ps).getTime(), e2 = s + mins * 60000;
    const hits = engine.findConflicts(db, { startMs: s, endMs: e2, excludeId: a ? a.id : null });
    box.style.display = 'block';
    if (!hits.length) {
      box.innerHTML = `🕐 ${hm(s)}–${hm(e2)} · 无冲突`;
      row.style.display = 'none';
    } else {
      box.innerHTML = `⚠ ${hm(s)}–${hm(e2)} 与 ${hits.map((h) => `「${esc(h.title)}」`).join('、')} 重叠，保存时将自动顺延`;
      row.style.display = 'block';
    }
  };
  m.q('#f-ps').addEventListener('input', previewAtomic);
  m.q('#f-apmin').addEventListener('input', previewAtomic);
  previewAtomic();
  // 周期编辑三态（仅循环活动编辑态显示）：全部 / 此期及后续 / 仅此期
  let seriesScope = 'all';
  const scopeRow = m.q('#series-scope');
  if (scopeRow) {
    const setScope = (s) => {
      seriesScope = s;
      scopeRow.querySelectorAll('[data-scope]').forEach((x) => x.classList.toggle('primary', x.dataset.scope === s));
    };
    scopeRow.querySelectorAll('[data-scope]').forEach((b) => {
      b.onclick = () => setScope(b.dataset.scope);
      if (a && a.status === 'Started') b.disabled = b.dataset.scope !== 'all'; // 进行中只能整体编辑
    });
  }
  m.q('[data-save]').onclick = () => {
    const plan_ids = [...m.qa('#actPlanChips input[type=checkbox]:checked')].map((e) => e.value);
    const presetOn = !!(presetToggle && presetToggle.checked);
    const readPresetRows = (boxId) => {
      if (!presetOn) return [];
      const box = m.q('#' + boxId);
      if (!box) return [];
      return [...box.querySelectorAll('.preset-row')].map((row) => ({
        resource_id: row.querySelector('.pr-res').value,
        amount: row.querySelector('.pr-amt').value,
        note: row.querySelector('.pr-note').value,
      }));
    };
    const payload = {
      title: m.q('#f-aname').value, note: m.q('#f-anote').value, plan_ids,
      planned_start: m.q('#f-ps').value || null,
      planned_minutes: m.q('#f-apmin').value,
      repeat: m.q('#f-arepeat').value || null,
      repeat_until: m.q('#f-arepuntil').value || null,
      theme: chosenTheme || null,
      keep_conflict: m.q('#f-keepconflict') ? m.q('#f-keepconflict').checked : false,
      preset_expenses: readPresetRows('pe-rows'),
      preset_incomes: readPresetRows('pi-rows'),
    };
    const r = a
      ? (a.repeat && seriesScope !== 'all' ? engine.updateSeries(db, a.id, seriesScope, payload) : engine.updateActivity(db, a.id, payload))
      : engine.createActivity(db, payload);
    if (!r.ok) return toast(r.error, 'err');
    // 记住输入习惯，下次按语境预填
    Prefs.set({
      lastMinutes: Number(payload.planned_minutes) || 0,
      lastRepeat: payload.repeat || '',
    });
    m.close(); App.refresh();
    if (r.split) toast('仅此期：已拆为独立活动，系列保留其余期次', 'ok');
    else if (r.shifted_dates !== undefined) toast(r.shifted_dates !== 0 ? `此期及后续：后续期次已平移 ${r.shifted_dates} 天` : '已保存（仅时间调整）', 'ok');
    else if (r.spawned) toast(`已按循环生成 ${r.spawned} 期后续活动（各期独立管理）`, 'ok');
    else if (r.shifted) toast(`⏩ 时段冲突，已自动顺延至 ${(r.to || '').replace('T', ' ')}`, 'ok');
    else if (r.bundled) toast('⚠ 已保留时间重叠并与冲突活动捆绑，开始时将仲裁先后', 'ok');
    else toast(a ? '已保存' : '活动已创建，去「开始」吧', 'ok');
  };
  // 进入即聚焦活动名称框，唤起输入
  setTimeout(() => { const el = m.q('#f-aname'); if (el) el.focus(); }, 60);
}

// 完成弹窗：同时登记 支出 + 收入 + 产出（不变量2 / 4A / 10B）
export function openCompleteModal(activityId, opts = {}) {
  const { db } = App;
  const a = db.activities.find((x) => x.id === activityId);
  if (!a) return;
  // 语境预填：有按任务计时 → 支出用「时间」并填已计分钟；否则用上次支出资源
  const prefs = Prefs.load();
  const tracked = App.engine.trackedMinutes(db, a.id);
  const timeRes = db.resources.find((r) => r.name === '时间');
  const active = db.resources.filter((r) => r.status === 'Active');
  const defExpenseRes = (tracked > 0 && timeRes) ? timeRes.id
    : (prefs.lastExpenseRes && active.some((r) => r.id === prefs.lastExpenseRes) ? prefs.lastExpenseRes
      : (active[0] ? active[0].id : ''));
  const resOpts = (sel) => active
    .map((r) => `<option value="${esc(r.id)}" ${r.id === sel ? 'selected' : ''}>${esc(r.name)}（余额 ${fmtNum(App.engine.balanceOf(db, r.id))}）</option>`).join('');
  // 多资源收支行（与预设收支/改账同构）：资源 + 金额 + 备注 + 移除
  const cRow = (sel, amt, note) => `
    <div class="preset-row" style="display:grid;grid-template-columns:1fr 84px 1fr auto;gap:6px;align-items:center;margin:4px 0">
      <select class="pr-res">${resOpts(sel)}</select>
      <input class="pr-amt" type="number" min="0" step="0.01" value="${esc(amt ?? '')}" placeholder="金额">
      <input class="pr-note" value="${esc(note || '')}" placeholder="备注">
      <button type="button" class="btn sm pr-del" title="移除">✕</button>
    </div>`;
  // 语境提速：收入金额/产出标题/tags 按上次或活动语境预填，用户只需微调
  const defIncomeAmt = prefs.lastIncomeAmount || '';
  const defExpenseAmt = tracked > 0 ? tracked : (prefs.lastExpenseAmount || '');
  const defOutTitle = a.title;
  const defTags = prefs.lastOutputTags || '';
  const recentTags = [...new Set(db.outputs.slice(-12).flatMap((o) => o.tags || []))].slice(0, 8);

  const m = openModal({
    title: `完成活动 · 收支闭环（不变量2）`,
    width: 560,
    accent: 'warn',
    bodyHTML: `
      <div class="callout warn">「${esc(a.title)}」进入 Completed 需登记 <b>支出/收入</b> 至少一笔，并挂 <b>产出</b>。可同时填收支两栏。</div>
      ${tracked > 0 ? `<div class="callout">⏱ 已按任务计时 <b>${tracked}</b> 分钟，支出金额已预填，可按需调整。</div>` : ''}
      <div class="step-divider step-1">① 支出（消耗 · 可空）<button type="button" class="btn sm" id="c-e-add">＋ 添加</button></div>
      <div id="c-e-rows">${cRow(defExpenseRes, tracked > 0 ? tracked : defExpenseAmt, '')}</div>
      <div class="step-divider step-1">② 收入（获得 · 可空）<button type="button" class="btn sm" id="c-i-add">＋ 添加</button></div>
      <div id="c-i-rows">${cRow(prefs.lastIncomeRes, defIncomeAmt, '')}</div>
      <div class="step-divider step-2">③ 产出（10B / 11B 自由标签）</div>
      <div class="field"><label>产出标题 *</label><input id="f-cout" value="${esc(defOutTitle)}"></div>
      <div class="field"><label>产出 tags（逗号分隔）</label><input id="f-ctags" value="${esc(defTags)}" placeholder="写作,交付">
        ${recentTags.length ? `<div class="tag-suggest">${recentTags.map((t) => `<button type="button" class="tag-chip" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
      </div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>原子提交 → Completed</button>`,
  });
  m.q('[data-cancel]').onclick = () => { m.close(); if (opts.onCancel) opts.onCancel(); };
  // 最近产出 tags 一键追加
  m.qa('.tag-chip').forEach((c) => {
    c.onclick = () => {
      const inp = m.q('#f-ctags');
      const cur = inp.value.split(',').map((s) => s.trim()).filter(Boolean);
      if (!cur.includes(c.dataset.tag)) { cur.push(c.dataset.tag); inp.value = cur.join(','); }
    };
  });
  // 多资源收支行：＋添加 / 移除（与改账弹窗同构）
  const bindRowBox = (boxId, addId) => {
    const box = m.q('#' + boxId);
    const add = m.q('#' + addId);
    if (box) box.addEventListener('click', (e) => { const d = e.target.closest('.pr-del'); if (d) d.closest('.preset-row').remove(); });
    if (add) add.onclick = () => { box.insertAdjacentHTML('beforeend', cRow('', '', '')); };
  };
  bindRowBox('c-e-rows', 'c-e-add');
  bindRowBox('c-i-rows', 'c-i-add');
  const readRowBox = (boxId) => [...m.q('#' + boxId).querySelectorAll('.preset-row')].map((row) => ({
    resource_id: row.querySelector('.pr-res').value,
    amount: row.querySelector('.pr-amt').value,
    note: row.querySelector('.pr-note').value,
  }));
  m.q('[data-save]').onclick = () => {
    const tags = m.q('#f-ctags').value.split(',').map((s) => s.trim()).filter(Boolean);
    const expenses = readRowBox('c-e-rows');
    const incomes = readRowBox('c-i-rows');
    const savePrefs = () => {
      const e1 = expenses.find((e) => Number(e.amount) > 0);
      const i1 = incomes.find((i) => Number(i.amount) > 0);
      Prefs.set({
        lastExpenseRes: e1 ? e1.resource_id : (expenses[0] ? expenses[0].resource_id : ''),
        lastExpenseAmount: e1 ? String(Number(e1.amount)) : '',
        lastIncomeRes: i1 ? i1.resource_id : (incomes[0] ? incomes[0].resource_id : ''),
        lastIncomeAmount: i1 ? String(Number(i1.amount)) : '',
        lastOutputTags: tags.join(','),
      });
    };
    // 指定期次完成（循环活动）：走 completeSeriesOccurrence，账挂该期，无需 start 前置
    if (opts.occurrenceDate) {
      const r = App.engine.completeSeriesOccurrence(App.db, activityId, opts.occurrenceDate, {
        expenses, incomes,
        output_title: m.q('#f-cout').value, output_tags: tags,
      });
      if (!r.ok) return toast(r.error, 'err');
      savePrefs();
      m.close(); App.refresh(); toast('该期次已完成，收支与产出已入账', 'ok');
      if (opts.onDone) opts.onDone();
      return;
    }
    // 原子完成流程（不绕过状态机）：尚未开始则先开始（无冲突），再登记收支产出完成。
    // 取消时活动保持原状态（Planned 不会因打开面板而被误改）。
    if (a.status === 'Planned') {
      const sr = App.engine.startActivity(App.db, activityId);
      if (!sr.ok) return toast(sr.error, 'err');
      if (sr.conflict_choice) return toast('⏱ 时间冲突：需先在 App 内仲裁开始', 'warn');
    }
    const r = App.engine.completeActivity(App.db, activityId, {
      expenses, incomes,
      output_title: m.q('#f-cout').value, output_tags: tags,
    });
    if (!r.ok) return toast(r.error, 'err');
    // 记住收支资源/金额与产出 tags 偏好，下次按语境预填（取首行有效值）
    savePrefs();
    m.close(); App.refresh(); toast('活动已完成，收支与产出已入账', 'ok');
    if (opts.onDone) opts.onDone();
  };
}

// 改账弹窗（Completed 活动收支修正，多资源）：列出已记全部支出/收入，改动走 amendActivityLedger（冲正语义）
export function openAmendModal(activityId) {
  const { db } = App;
  const a = db.activities.find((x) => x.id === activityId);
  if (!a || a.status !== 'Completed') return;
  const txs = db.txs.filter((t) => t.source_type === 'activity' && t.source_id === activityId && !t.reversal_of);
  const expenses = txs.filter((t) => t.credit > 0).map((t) => ({ resource_id: t.resource_id, amount: t.credit, note: t.note }));
  const incomes = txs.filter((t) => t.debit > 0).map((t) => ({ resource_id: t.resource_id, amount: t.debit, note: t.note }));
  const active = db.resources.filter((r) => r.status === 'Active');
  const resOptsAm = (sel) => active.map((r) =>
    `<option value="${esc(r.id)}" ${r.id === sel ? 'selected' : ''}>${esc(r.name)}（余额 ${fmtNum(App.engine.balanceOf(db, r.id))}）</option>`).join('')
    || '<option value="">（请先创建资源）</option>';
  const rowHTML = (entry) => `
    <div class="preset-row" style="display:grid;grid-template-columns:1fr 84px 1fr auto;gap:6px;align-items:center;margin:4px 0">
      <select class="pr-res">${resOptsAm(entry ? entry.resource_id : '')}</select>
      <input class="pr-amt" type="number" min="0" step="0.01" value="${esc(entry ? entry.amount : '')}" placeholder="金额">
      <input class="pr-note" value="${esc(entry ? (entry.note || '') : '')}" placeholder="备注">
      <button type="button" class="btn sm pr-del" title="移除">✕</button>
    </div>`;
  const m = openModal({
    title: '改账 · 收支修正',
    width: 560,
    accent: 'warn',
    bodyHTML: `
      <div class="callout warn">「${esc(a.title)}」已入账的收支将按<b>冲正语义</b>反转并重记（不变量5，审计留痕），产出与状态不变。</div>
      <div class="step-divider">① 支出（可空）<button type="button" class="btn sm" id="am-e-add">＋ 添加</button></div>
      <div id="am-e-rows">${expenses.map((x) => rowHTML(x)).join('')}</div>
      <div class="step-divider">② 收入（可空）<button type="button" class="btn sm" id="am-i-add">＋ 添加</button></div>
      <div id="am-i-rows">${incomes.map((x) => rowHTML(x)).join('')}</div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>冲正并重记</button>`,
  });
  m.q('[data-cancel]').onclick = () => m.close();
  const bindRows = (boxId, addId) => {
    const box = m.q('#' + boxId);
    const add = m.q('#' + addId);
    if (box) box.addEventListener('click', (e) => { const d = e.target.closest('.pr-del'); if (d) d.closest('.preset-row').remove(); });
    if (add) add.onclick = () => { box.insertAdjacentHTML('beforeend', rowHTML(null)); };
  };
  bindRows('am-e-rows', 'am-e-add');
  bindRows('am-i-rows', 'am-i-add');
  m.q('[data-save]').onclick = () => {
    const readRows = (boxId) => [...m.q('#' + boxId).querySelectorAll('.preset-row')].map((row) => ({
      resource_id: row.querySelector('.pr-res').value,
      amount: row.querySelector('.pr-amt').value,
      note: row.querySelector('.pr-note').value,
    }));
    const r = App.engine.amendActivityLedger(App.db, activityId, {
      expenses: readRows('am-e-rows'),
      incomes: readRows('am-i-rows'),
    });
    if (!r.ok) return toast(r.error, 'err');
    m.close(); App.refresh(); toast('已按冲正语义改账', 'ok');
  };
}

// ---------------- 活动看板 ----------------
// 拖拽标记：拖完不触发卡片点击进入编辑
let wasDragging = false;
let actMenuListenerBound = false;

function activityCard(App, a) {
  const { db, engine } = App;
  const pn = a.plan_ids.map((pid) => {
    const p = db.plans.find((x) => x.id === pid);
    if (!p) return '';
    const g = db.goals.find((x) => x.id === p.goal_id);
    return (g ? `${esc(g.title)}：` : '') + esc(p.title);
  }).filter(Boolean).join(' · ') || '未关联';
  const outs = db.outputs.filter((o) => o.activity_id === a.id);
  const blocked = engine.anyPlanBlocked(db, a.plan_ids);
  const tracked = engine.trackedMinutes(db, a.id);
  const plannedMin = a.planned_minutes || 0;
  const tpct = plannedMin > 0 ? Math.min(100, (tracked / plannedMin) * 100) : 0;
  const trackedLabel = tracked > 0 ? `${tracked}m` : '0m';
  // 循环进度：M/N 期
  const seriesProg = (act) => {
    if (!act.repeat) return '';
    const sp = engine.seriesProgress(db, act);
    return `${sp.done}/${sp.total} 期`;
  };

  const stateActions = {
    Planned: `<button class="btn sm primary" onclick="App.startAct('${jsStr(a.id)}')" ${blocked ? 'disabled title="预算耗尽"' : ''}>开始</button>`,
    Started: ((a.preset_expenses || []).length || (a.preset_incomes || []).length)
      ? `<button class="btn sm primary" onclick="App.quickComplete('${jsStr(a.id)}')" ${blocked ? 'disabled title="预算耗尽"' : ''}>完成</button>`
      : `<button class="btn sm primary" onclick="App.overview.openCompleteModal('${jsStr(a.id)}')" ${blocked ? 'disabled title="预算耗尽"' : ''}>完成</button>`,
    Completed: `<button class="btn sm" onclick="App.engine.setActivityStatus(App.db,'${jsStr(a.id)}','Reviewed');App.overview.refreshBoard()">复盘</button>`,
    Reviewed: `<button class="btn sm" onclick="App.engine.setActivityStatus(App.db,'${jsStr(a.id)}','Archived');App.overview.refreshBoard()">归档</button>`,
    Archived: '',
  }[a.status] || '';
  const pcolor = activityPlanColor(db, a.plan_ids);
  const stheme = safeTheme(a.theme);
  const th = themeStyle(stheme);
  const tone = themeTone(stheme); // 'dark' | 'light' | null(图片待采样)

  // 信息量压缩：归属/日期/循环 三行 meta 合一；实际起止移入 title（编辑弹窗/日历里仍可见）；
  // 计时进度条只在有实际计时值时出现（没开始计时的卡片不占一整行 0%）。
  const dateBit = (a.planned_start || a.planned_date)
    ? `📅 ${a.planned_start ? `${esc(String(a.planned_start).replace('T', ' ').slice(5))}${plannedEndOf(a) ? `–${plannedEndOf(a)}` : ''}` : esc(String(a.planned_date))}${a.planned_minutes ? ` · ${esc(a.planned_minutes)}m` : ''}`
    : (a.planned_minutes ? `⏱ ${esc(a.planned_minutes)}m` : '');
  const metaBits = [];
  if (pn && pn !== '未关联') metaBits.push(pn);
  if (dateBit) metaBits.push(dateBit);
  if (a.repeat) metaBits.push(`🔁 ${REPEAT_LABEL[a.repeat] || a.repeat} · ${seriesProg(a)}${a.repeat_until ? ` 至 ${esc(a.repeat_until)}` : ''}`);
  if (pn === '未关联') metaBits.push('未关联');
  // 未来待做期次（看板内嵌，与日历对齐）：pending 且非当前期
  const pendingFuture = (a.repeat && Array.isArray(a.occurrences))
    ? a.occurrences.filter((o) => o.status === 'pending' && o.date !== a.planned_date)
    : [];
  const occOpen = expandedSeries.has(a.id);

  return `
    <div class="kanban-card ${blocked ? 'warned' : ''} ${th ? 'themed' : ''} ${tone === 'light' ? 'tone-light' : ''}" draggable="true" data-id="${esc(a.id)}" ${th && tone === null ? 'data-await-tone="1"' : ''} onclick="App.overview.editActivityCard('${jsStr(a.id)}', event)" title="${esc(a.title)}${a.actual_start ? ` · 开始 ${fmtDateTime(a.actual_start)}` : ''}${a.actual_end ? ` · 结束 ${fmtDateTime(a.actual_end)}` : ''}" style="border-left:4px solid ${pcolor || '#e5e8ee'}${!th && pcolor ? `;background:${hexToRgba(pcolor, 0.05)}` : ''}">
      ${th ? `<div class="kc-bg" style="background:${th}"></div>` : ''}
      <div class="kc-head">
        <span class="kc-title">${esc(a.title)}</span>
        ${badge(a.status)}
      </div>
      ${a.note ? `<div class="kc-note" title="${esc(a.note)}">📝 ${esc(a.note)}</div>` : ''}
      ${metaBits.length ? `<div class="kc-meta">${metaBits.join(' · ')}</div>` : ''}
      ${tracked > 0 ? `
      <div class="kc-time-progress" title="已计时 ${trackedLabel} / 计划 ${plannedMin || '—'} 分钟">
        <div class="kc-tp-label"><span><b style="color:${pcolor || '#ff2d55'}">⏱ 已计时 ${trackedLabel}</b>${plannedMin ? ` / 计划 ${plannedMin}m` : ''}</span>${plannedMin ? `<span>${tpct >= 100 ? '100+' : Math.round(tpct)}%</span>` : ''}</div>
        ${plannedMin ? `<div class="progress"><i class="bar" style="width:${tpct}%;background:${pcolor || '#ff2d55'}"></i></div>` : ''}
      </div>` : ''}
      ${blocked ? `<div class="kc-meta warn">⛔ 关联计划预算已耗尽</div>` : ''}
      ${outs.length ? `<div class="kc-outs">${outs.map((o) => `
        <div class="kc-out">
          <span>📄 ${esc(o.title)} ${o.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')} ${badge(o.status)}</span>
          ${o.status === 'Draft' ? `<button class="btn sm" onclick="App.engine.setOutputStatus(App.db,'${jsStr(o.id)}','Published');App.overview.refreshBoard()">发布</button>`
            : o.status === 'Published' ? `<button class="btn sm primary" onclick="App.engine.setOutputStatus(App.db,'${jsStr(o.id)}','Archived');App.overview.refreshBoard()">归档 → 价值流</button>` : ''}
        </div>`).join('')}</div>` : ''}
      <div class="kc-actions">
        <button class="btn sm timer-btn" onclick="App.timer.openForActivity('${jsStr(a.id)}')">🍅 计时</button>
        ${stateActions}
        <div class="act-menu-wrap">
          <button class="btn sm" title="更多操作" onclick="App.overview.toggleActMenu('${jsStr(a.id)}')">⋯</button>
          <div class="act-menu hidden" id="am-${esc(a.id)}">
            <button onclick="App.overview.openActModal('${jsStr(a.id)}')">编辑</button>
            ${a.repeat ? `<button onclick="App.overview.openOccurrencesModal('${jsStr(a.id)}')">📅 期次</button>` : ''}
            ${a.repeat ? `<button onclick="App.overview.extendRecurrence('${jsStr(a.id)}')">＋ 续生成后续 30 期</button>` : ''}
            <button class="danger" onclick="App.overview.delAct('${jsStr(a.id)}')">删除</button>
          </div>
        </div>
      </div>
      ${pendingFuture.length ? `
      <div class="kc-occ" style="margin:6px 0 0;padding-top:6px;border-top:1px dashed var(--border)">
        <div class="kc-occ-head" onclick="event.stopPropagation();App.overview.toggleSeriesOccs('${jsStr(a.id)}')" style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);cursor:pointer;margin-bottom:4px">📅 未来 ${pendingFuture.length} 期 <span class="collapse-btn">${occOpen ? '▾' : '▸'}</span></div>
        <div class="kc-occ-body" style="${occOpen ? '' : 'display:none'}">
          ${pendingFuture.map((o) => `
          <div class="kc-occ-row" style="display:flex;gap:6px;align-items:center;margin:2px 0">
            <span class="grow" style="flex:1;font-size:11px">📅 ${esc(o.date)}</span>
            <button class="btn sm primary" title="完成该期并入账" onclick="event.stopPropagation();App.overview.completeOccurrence('${jsStr(a.id)}','${jsStr(o.date)}')">完成</button>
            <button class="btn sm" title="跳过该期" onclick="event.stopPropagation();App.overview.skipOccurrence('${jsStr(a.id)}','${jsStr(o.date)}')">跳过</button>
          </div>`).join('')}
        </div>
      </div>` : ''}
    </div>`;
}

// 溢出菜单：⋯ 展开/收起（同一时刻只开一个，点别处自动关闭）
export function toggleActMenu(id) {
  const el = document.getElementById('am-' + id);
  if (!el) return;
  const willOpen = el.classList.contains('hidden');
  closeActMenus();
  if (willOpen) el.classList.remove('hidden');
}
export function closeActMenus() {
  document.querySelectorAll('.act-menu:not(.hidden)').forEach((m) => m.classList.add('hidden'));
}

// 图片主题：异步采样平均亮度，补上「白字/深字」类
function settleThemeTones(App, root) {
  root.querySelectorAll('.kanban-card[data-await-tone]').forEach((card) => {
    const a = App.db.activities.find((x) => x.id === card.dataset.id);
    if (!a) return;
    const t = safeTheme(a.theme);
    if (!t) return;
    sampleImageTone(t, (tone) => {
      if (tone === 'light') card.classList.add('tone-light');
      card.removeAttribute('data-await-tone');
    });
  });
}

// 日程/看板 并列轮播：transform 平移（无滚动事件→无渲染冲突）+ 高度过渡，下方卡片平滑跟随
// 信息量纪律：不自动播放（每 2 秒自动翻页会让人无法专注当前画面）——只由用户滑动/点导航切换。
let pagerResizeBound = false;
let pagerPage = 0;     // 当前轮播页（跨渲染保留：App.refresh 不跳回日历/不重放动画）
function isCarousel() { return window.matchMedia('(max-width: 860px)').matches; }
function layoutPager(pager) {
  const pages = pager.querySelectorAll('.dash-page');
  const track = pager.querySelector('.dash-track');
  if (!pages.length || !track) return;
  const n = pages.length;
  track.style.width = (n * 100) + '%';
  pages.forEach((p) => { p.style.flex = `0 0 ${100 / n}%`; p.style.minWidth = `${100 / n}%`; });
}
function goToPage(pager, idx, instant) {
  if (!isCarousel()) return; // 桌面堆叠：不做轮播
  const pages = pager.querySelectorAll('.dash-page');
  const track = pager.querySelector('.dash-track');
  if (!pages.length || !track) return;
  // ★ 容器隐藏（display:none）时 offsetHeight=0：此时测量会把 pager 高度锁死为 0，
  //   切回活动 Tab 就是「整个 Tab 静默消失」。键盘开合触发的 resize 正好打在隐藏期。
  if (pager.offsetParent === null) return;
  const n = pages.length;
  const cur = Math.max(0, Math.min(idx, n - 1));
  if (instant) track.style.transition = 'none';
  track.style.transform = `translateX(-${(cur / n) * 100}%)`;
  if (instant) { void track.offsetWidth; track.style.transition = ''; }
  // 高度 = 当前页内容 + 顶部导航高度（否则下方内容被裁/重叠）
  const navH = (pager.querySelector('.dash-nav')?.offsetHeight) || 0;
  pager.style.height = ((pages[cur].offsetHeight || pager.offsetHeight) + navH) + 'px';
  pager.querySelectorAll('.dash-nav-item').forEach((b, i) => b.classList.toggle('on', i === cur));
  pagerPage = cur; // 记录当前页，供下次渲染保留
}
function syncPager(App, root) {
  const pager = root.querySelector('.dash-pager');
  if (!pager) return;
  layoutPager(pager);
  goToPage(pager, pagerPage, true); // 保留用户当前所在页，而不是重置回日历
  // 看板撞墙联动：内部横向滚动到边界后继续同向滑 → 切相邻容器页
  const kanban = pager.querySelector('.kanban');
  let kbScrolled = false, kbEdge = false, kbStartX = 0, kbLastScroll = 0;
  if (kanban && isCarousel()) {
    kanban.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      kbStartX = e.touches[0].clientX; kbLastScroll = kanban.scrollLeft; kbScrolled = false; kbEdge = false;
    }, { passive: true });
    kanban.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - kbStartX;
      if (kanban.scrollLeft !== kbLastScroll) kbScrolled = true;
      kbLastScroll = kanban.scrollLeft;
      const max = kanban.scrollWidth - kanban.clientWidth;
      if ((kanban.scrollLeft <= 1 && dx > 0) || (kanban.scrollLeft >= max - 1 && dx < 0)) kbEdge = true;
    }, { passive: true });
  }
  // 左右滑动切换（到边界后回退为 Tab 切换）
  let tx = null;
  pager.addEventListener('touchstart', (e) => { if (e.touches.length === 1) tx = e.touches[0].clientX; }, { passive: true });
  pager.addEventListener('touchend', (e) => {
    if (tx === null) return;
    const dx = e.changedTouches[0].clientX - tx;
    tx = null;
    const fromKanban = !!(e.target && e.target.closest && e.target.closest('.kanban'));
    if (fromKanban && kanban && isCarousel()) {
      const edge = kbEdge, scrolled = kbScrolled;
      kbEdge = false; kbScrolled = false;
      if (scrolled && !edge) return;             // 内部滚动消耗了手势 → 不翻页
      if (!edge && Math.abs(dx) <= 48) return;   // 未撞墙且位移小 → 不翻
    } else {
      if (Math.abs(dx) <= 48) return;
    }
    const items = [...pager.querySelectorAll('.dash-nav-item')];
    const cur = items.findIndex((b) => b.classList.contains('on'));
    const n = pager.querySelectorAll('.dash-page').length;
    const next = dx < 0 ? cur + 1 : cur - 1;
    if (next >= 0 && next < n) {
      goToPage(pager, next);
    } else if (next >= n) {
      // 右边界左滑：容器到底 → 回退为 Tab 切换，进入全局 Tab 序的**下一个** Tab
      //（活动(overview) → 资源(finance)）。此前硬编码 'goals'，越过了「资源」，不符合滑动直觉。
      const order = App.tabOrder || ['overview', 'finance', 'goals', 'stats'];
      const nextTab = order[order.indexOf('overview') + 1];
      if (nextTab) App.setTab(nextTab);
    }
    // 左边界右滑：overview 是首个 Tab，无上一页可回退，忽略
  }, { passive: true });
  // 点击导航切换
  pager.querySelectorAll('.dash-nav-item').forEach((b) => {
    b.onclick = () => { goToPage(pager, Number(b.dataset.page)); };
  });
  if (!pagerResizeBound) {
    pagerResizeBound = true;
    window.addEventListener('resize', () => {
      const p = document.querySelector('.dash-pager');
      if (!p) return;
      const cur = [...p.querySelectorAll('.dash-nav-item')].findIndex((b) => b.classList.contains('on'));
      layoutPager(p);
      goToPage(p, cur < 0 ? 0 : cur, true);
    });
  }
  // 图片主题采样后尺寸稳定：按当前页重新测量高度（不重置页码）
  setTimeout(() => {
    const cur = [...pager.querySelectorAll('.dash-nav-item')].findIndex((b) => b.classList.contains('on'));
    goToPage(pager, cur < 0 ? 0 : cur, true);
  }, 150);
}

// 日历等子视图就地重渲染后，按当前页重算轮播高度（不重置页码、无切换动画）。
// 供 calendar.renderSection 在切换日期/月份后调用，修复「容器高度不随日期内容伸缩」。
export function refreshPagerHeight() {
  const pager = document.getElementById('dash-pager');
  if (!pager) return;
  const cur = [...pager.querySelectorAll('.dash-nav-item')].findIndex((b) => b.classList.contains('on'));
  layoutPager(pager);
  goToPage(pager, cur < 0 ? 0 : cur, true);
}

// 点击卡片进入编辑（拖拽/点按钮不触发）
export function editActivityCard(id, ev) {
  if (wasDragging) return;
  if (ev && ev.target && ev.target.closest('button, input, select, textarea, .kc-out')) return;
  openActModal(id);
}

export async function delAct(id) {
  const a = App.db.activities.find((x) => x.id === id);
  if (!a) return;
  const im = App.engine.activityDeleteImpact(App.db, id);
  const parts = [];
  if (im.txs) parts.push(`${im.txs} 条流水`);
  if (im.outs) parts.push(`${im.outs} 个产出`);
  if (im.vfs) parts.push(`${im.vfs} 条价值流`);
  const msg = parts.length
    ? `删除活动「${a.title}」将连带删除：${parts.join('、')}。确定？`
    : `删除活动「${a.title}」？`;
  if (!(await App.system.confirm({ title: '删除活动', message: msg }))) return;
  const r = App.engine.deleteActivityCascade(App.db, id);
  if (!r.ok) return toast(r.error, 'err');
  App.refresh(); toast('已删除');
}

// 循环活动：在同类系列最后一期之后追加后续期次（各期独立管理，随时可扩期）
export function extendRecurrence(id) {
  const r = App.engine.extendRecurrence(App.db, id);
  if (!r.ok) return toast(r.error, 'err');
  toast(`已续生成后续 ${r.spawned} 期`, 'ok');
  refreshBoard(); // 只刷新看板
}

// 跳过单个期次（日历展开的未来期次用）
export function skipOccurrence(id, date) {
  const r = App.engine.skipOccurrence(App.db, id, date);
  if (!r.ok) return toast(r.error, 'err');
  toast('已跳过该期次', 'ok');
  App.refresh();
}

// 完成某个期次（对齐非循环活动）：预设了收支 → 按预设一键入账；否则弹完成面板登记收支+产出。
// 完整走引擎记账（occurrence_date 挂到该期），不再是纯打勾。
export function completeOccurrence(id, date) {
  const a = App.db.activities.find((x) => x.id === id);
  if (!a || !a.repeat) return;
  const presets = (a.preset_expenses || []).filter((e) => e && Number(e.amount) > 0)
    .concat((a.preset_incomes || []).filter((i) => i && Number(i.amount) > 0));
  if (presets.length) { quickCompleteOccurrence(id, date); return; }
  openCompleteModal(id, { occurrenceDate: date, title: `完成该期 · ${esc(a.title)}` });
}

// 按预设收支一键完成某期次（对齐 App.quickComplete 的预设语义；产出标题=活动名）
function quickCompleteOccurrence(id, date) {
  const a = App.db.activities.find((x) => x.id === id);
  if (!a) return;
  const r = App.engine.completeSeriesOccurrence(App.db, id, date, {
    expenses: (a.preset_expenses || []).filter((e) => e && Number(e.amount) > 0),
    incomes: (a.preset_incomes || []).filter((i) => i && Number(i.amount) > 0),
    output_title: a.title,
    output_tags: ['预设'],
  });
  if (!r.ok) return toast(r.error, 'err');
  App.refresh();
  toast(`该期次已按预设入账${r.advanced ? '，并推进下一期' : ''}`, 'ok');
}

// 期次弹窗：查看系列全部期次与状态（done ✓ / skipped 跳 / pending 待）
export function openOccurrencesModal(id) {
  const a = App.db.activities.find((x) => x.id === id);
  if (!a || !a.repeat) return;
  const occs = a.occurrences || [];
  const rows = occs.map((o) => {
    const st = o.status === 'done' ? '<span class="badge b-green">✓ 完成</span>'
      : o.status === 'skipped' ? '<span class="badge b-gray">跳过</span>'
        : '<span class="badge b-amber">待做</span>';
    // 该期账本：同一系列、occurrence_date === 该期日期的流水 / 产出
    const occTxs = App.db.txs.filter((t) => t.source_id === id && t.occurrence_date === o.date);
    const occOuts = App.db.outputs.filter((o2) => o2.activity_id === id && o2.occurrence_date === o.date);
    let ledger = '';
    if (o.status !== 'pending') {
      if (occTxs.length) {
        const inAmt = occTxs.reduce((s, t) => s + (t.debit || 0), 0);
        const outAmt = occTxs.reduce((s, t) => s + (t.credit || 0), 0);
        const bits = [];
        if (outAmt > 0) bits.push(`支 <b>−${fmtNum(outAmt)}</b>`);
        if (inAmt > 0) bits.push(`收 <b>+${fmtNum(inAmt)}</b>`);
        if (bits.length) ledger += `<span class="muted"> · ${bits.join(' ')}</span>`;
      }
      if (occOuts.length) ledger += `<span class="muted"> · 📤 ${esc(occOuts.map((x) => x.title).join('、'))}</span>`;
      if (!occTxs.length && !occOuts.length) ledger = '<span class="muted"> · 未记账</span>';
    }
    return `<div class="tx-row"><div class="grow"><div class="tx-main"><b>${esc(o.date)}</b>${o.status === 'done' ? `<span class="muted"> · ${fmtDateTime(o.completedAt)}</span>` : ''}${ledger}</div></div>${st}</div>`;
  }).join('');
  openModal({
    title: `📅 期次 · ${esc(a.title)}`,
    width: 520,
    bodyHTML: rows || empty('暂无期次'),
    footerHTML: `<button class="btn" data-close>关闭</button>`,
  });
}

const COLUMNS = [
  { key: 'Planned', label: '📋 待办', match: (s) => s === 'Planned' },
  { key: 'Started', label: '⚡ 进行中', match: (s) => s === 'Started' },
  { key: 'Done', label: '✅ 已完成 / 复盘', match: (s) => s === 'Completed' || s === 'Reviewed' },
];

// 已完成列防撑爆：默认只显最近完成的 3 条，点按钮展开/收起（内存态，刷新保留）
const DONE_PREVIEW = 3;
let doneExpanded = false;
// 活动级归档 = 隐藏：Archived 活动从五态看板退场，收进「📦 已归档」折叠区（可展开查看历史）
let archivedShown = false;
export function toggleArchived() {
  archivedShown = !archivedShown;
  renderKanbanRoot(App);
}

// 看板按计划过滤：'all'=全部 | 'none'=未关联 | planId（内存态，渲染重建保留）
let kanbanPlanFilter = 'all';
let kanbanGoalFilter = null;  // 目标上层汇聚：null=全部目标；goalId=只看该目标
let kanbanTodayOnly = false; // 「今日」模式：只看今天到期的活动
let kanbanGroup = 'todo';    // 看板分组视图：todo 待办 / doing 进行中 / done 已完成
const expandedSeries = new Set(); // 看板里已展开未来期次的循环活动
export function setKanbanPlanFilter(id) {
  kanbanPlanFilter = id;
  if (id === 'all') kanbanGoalFilter = null; // 点「全部」同时清目标汇聚
  renderKanbanRoot(App); // 就地重渲染看板，不整页刷新 → 不跳回日历、不重放轮播动画
}
export function setKanbanGoal(id) {
  kanbanGoalFilter = (kanbanGoalFilter === id ? null : id);
  kanbanPlanFilter = 'all'; // 展开目标时先看该目标全部计划
  renderKanbanRoot(App);
}
export function setKanbanGroup(g) {
  kanbanGroup = g;
  renderKanbanRoot(App); // 分组视图切换：待办 / 进行中 / 已完成
}
// 看板分组切换条（待办 / 进行中 / 已完成 —— 每次只看一个视图）
function kanbanGroupsBar() {
  return `<div class="kanban-groups">` +
    [{ g: 'todo', l: '📋 待办' }, { g: 'doing', l: '⚡ 进行中' }, { g: 'done', l: '✅ 已完成' }]
      .map((x) => `<button type="button" class="${kanbanGroup === x.g ? 'on' : ''}" data-group="${x.g}" onclick="App.overview.setKanbanGroup('${x.g}')">${x.l}</button>`).join('') +
    `</div>`;
}
export function setKanbanToday(v) {
  kanbanTodayOnly = !!v;
  renderKanbanRoot(App);
}
// 看板展开/收起某个循环活动的未来期次（局部，不整页）
export function toggleSeriesOccs(id) {
  expandedSeries.has(id) ? expandedSeries.delete(id) : expandedSeries.add(id);
  refreshBoard();
}
function isTodayAct(a) {
  const t = new Date();
  const tk = `${t.getFullYear()}-${t.getMonth() + 1}-${t.getDate()}`;
  // 循环活动：今天是否有任一 pending 期次（含当前期与未来期）→ 纳入今日看板（对齐日历）
  if (a.repeat && Array.isArray(a.occurrences) && a.occurrences.length) {
    return a.occurrences.some((o) => o.status === 'pending' && String(o.date) === tk);
  }
  if (a.actual_start) {
    const d = new Date(a.actual_start);
    return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  }
  return a.planned_date === `${t.getFullYear()}-${t.getMonth() + 1}-${t.getDate()}`;
}
function kanbanFilterBar(App) {
  const { db } = App;
  const countOf = (pred) => db.activities.filter(pred).length;
  const todayN = countOf((a) => isTodayAct(a));
  const chip = (id, label, cnt, on) => `
    <button type="button" class="tag-chip ${on ? 'on' : ''}" data-f="${id}" onclick="App.overview.setKanbanPlanFilter('${jsStr(id)}')">${label} <span class="muted">${cnt}</span></button>`;
  // 第一层（单一横向滚动条 + 边缘渐隐光晕提示可滑动）：今日 / 全部 / 未关联 + 目标汇聚 chips
  let html = `<div class="kb-scroll-wrap" data-edge><div class="kanban-filter">`;
  html += `<button type="button" class="tag-chip ${kanbanTodayOnly ? 'on' : ''}" data-today="1" onclick="App.overview.setKanbanToday(${!kanbanTodayOnly})">📅 今日 <span class="muted">${todayN}</span></button>`;
  html += chip('all', '全部', db.activities.length, !kanbanTodayOnly && !kanbanGoalFilter && kanbanPlanFilter === 'all');
  html += chip('none', '未关联', countOf((a) => !a.plan_ids || !a.plan_ids.length), !kanbanTodayOnly && !kanbanGoalFilter && kanbanPlanFilter === 'none');
  for (const g of db.goals) {
    const gPlans = db.plans.filter((p) => p.goal_id === g.id).map((p) => p.id);
    const gCnt = db.activities.filter((a) => (a.plan_ids || []).some((pid) => gPlans.includes(pid))).length;
    html += `<button type="button" class="tag-chip ${kanbanGoalFilter === g.id ? 'on' : ''}" data-goal="${jsStr(g.id)}" onclick="App.overview.setKanbanGoal('${jsStr(g.id)}')">🎯 ${esc(g.title)} <span class="muted">${gCnt}</span></button>`;
  }
  html += `</div></div>`;
  // 第二层（目标展开）：该目标下计划 chips，仍单一横向滚动条 + 边缘光晕
  if (kanbanGoalFilter && db.plans.some((p) => p.goal_id === kanbanGoalFilter)) {
    html += `<div class="kb-scroll-wrap" data-edge><div class="kanban-filter sub">`;
    for (const p of db.plans.filter((x) => x.goal_id === kanbanGoalFilter)) {
      html += chip(p.id, esc(p.title), countOf((a) => (a.plan_ids || []).includes(p.id)), kanbanPlanFilter === p.id);
    }
    html += `</div></div>`;
  }
  return html;
}

// 边缘渐隐光晕：横向可滚动且未到尽头 → 对应侧淡出渐变提示（隐藏滚动条下的「还有内容」信号）
function bindEdgeFade(wrap) {
  if (!wrap || wrap.dataset.edgeBound) return;
  wrap.dataset.edgeBound = '1';
  const scroller = wrap.querySelector('.kanban-filter');
  if (!scroller) return;
  const update = () => {
    const max = scroller.scrollWidth - scroller.clientWidth;
    wrap.classList.toggle('edge-left', scroller.scrollLeft > 2);
    wrap.classList.toggle('edge-right', scroller.scrollLeft < max - 2);
  };
  scroller.addEventListener('scroll', update, { passive: true });
  requestAnimationFrame(update);
}

// 仅重渲染看板容器：过滤条 + 五态看板。重绑看板交互，保持当前轮播页（不 reset 到日历、无切换动画）
function renderKanbanRoot(App) {
  const root = document.getElementById('kanban-root');
  if (!root) return;
  root.innerHTML = kanbanGroupsBar(App) + kanbanFilterBar(App) + `<div class="kanban">${kanbanHTML(App)}</div>`;
  root.querySelectorAll('[data-edge]').forEach(bindEdgeFade); // 过滤条边缘光晕提示可滑动
  setupDrag(App);           // 重绑拖拽/列点击（document 级菜单监听有去重守卫）
  settleThemeTones(App, root); // 图片主题采样补亮暗类
  const pager = document.getElementById('dash-pager');
  if (pager) {
    const cur = [...pager.querySelectorAll('.dash-nav-item')].findIndex((b) => b.classList.contains('on'));
    layoutPager(pager);                      // 内容高度变化后重算轮播轨道
    goToPage(pager, cur < 0 ? 0 : cur, true); // 停在当前页，instant=无过渡动画
  }
}

// 看板就地刷新：只重渲染过滤条 + 五态看板（保留轮播页、无整页重建），
// 供看板自身的 复盘/归档/输出发布/续生成/展开收起 等操作调用，替代 App.refresh。
export function refreshBoard() { renderKanbanRoot(App); }

function kanbanHTML(App) {
  const { db } = App;
  const byPlan = (a) => {
    if (kanbanTodayOnly && !isTodayAct(a)) return false; // 今日模式：只看今天到期
    // 目标汇聚层：活动须属于该目标下任一计划（可再叠加具体计划过滤）
    if (kanbanGoalFilter) {
      const gPlans = (db.plans || []).filter((p) => p.goal_id === kanbanGoalFilter).map((p) => p.id);
      const inGoal = (a.plan_ids || []).some((pid) => gPlans.includes(pid));
      if (!inGoal) return false;
      if (kanbanPlanFilter === 'all') return true;
      if (kanbanPlanFilter === 'none') return false;
      return (a.plan_ids || []).includes(kanbanPlanFilter);
    }
    if (kanbanPlanFilter === 'all') return true;
    if (kanbanPlanFilter === 'none') return !a.plan_ids || !a.plan_ids.length;
    return (a.plan_ids || []).includes(kanbanPlanFilter);
  };
  // 当前分组视图：待办(Planned) / 进行中(Started) / 已完成(Completed+Reviewed+归档)
  const inGroup = (a) => a.status !== 'Archived' && byPlan(a)
    && (kanbanGroup === 'todo' ? a.status === 'Planned'
      : kanbanGroup === 'doing' ? a.status === 'Started'
        : (a.status === 'Completed' || a.status === 'Reviewed'));
  let items = db.activities.filter(inGroup);
  if (kanbanGroup === 'done') {
    items = [...items].sort((x, y) => (y.actual_end || y.created || 0) - (x.actual_end || x.created || 0));
    const shown = !doneExpanded ? items.slice(0, DONE_PREVIEW) : items;
    const hidden = items.length - shown.length;
    const more = (hidden > 0 || doneExpanded) && items.length > DONE_PREVIEW
      ? `<button class="btn sm" style="margin:8px auto 0;display:block;width:auto" onclick="App.overview.toggleDone()">${doneExpanded ? '⬆ 收起，只看最近 ' + DONE_PREVIEW + ' 条' : `⬇ 展开更早的 ${hidden} 条`}</button>`
      : '';
    const archived = db.activities.filter((a) => a.status === 'Archived' && byPlan(a));
    const archivedHTML = archived.length ? `
      <div class="kanban-arch">
        <div class="kanban-arch-head" onclick="App.overview.toggleArchived()">
          <span class="collapse-btn">${archivedShown ? '▾' : '▸'}</span>
          <b>📦 已归档（${archived.length}）</b>
          <span class="muted">活动 · 历史存档，默认从视图隐藏</span>
        </div>
        <div class="kanban-arch-body" style="${archivedShown ? '' : 'display:none'}">
          ${archived.map((a) => activityCard(App, a)).join('') || ''}
        </div>
      </div>` : '';
    return `
      <div class="kanban-col" data-col="Done">
        <div class="kanban-head">✅ 已完成 <span class="cnt">${items.length}</span>
          <button class="btn sm" title="快速添加待办" onclick="App.overview.openActModal()">＋</button>
        </div>
        <div class="kanban-body">${shown.map((a) => activityCard(App, a)).join('') || '<div class="kanban-add">＋ 点击添加待办</div>'}${more}</div>
      </div>${archivedHTML}`;
  }
  const label = kanbanGroup === 'todo' ? '📋 待办' : '⚡ 进行中';
  const colKey = kanbanGroup === 'todo' ? 'Planned' : 'Started';
  return `
    <div class="kanban-col" data-col="${colKey}">
      <div class="kanban-head">${label} <span class="cnt">${items.length}</span>
        <button class="btn sm" title="快速添加待办" onclick="App.overview.openActModal()">＋</button>
      </div>
      <div class="kanban-body">${items.map((a) => activityCard(App, a)).join('') || '<div class="kanban-add">＋ 点击添加待办</div>'}</div>
    </div>`;
}

export function toggleDone() {
  doneExpanded = !doneExpanded;
  refreshBoard(); // 只刷新看板，不整页重建
}

function setupDrag(App) {
  const content = document.getElementById('content');
  let dragId = null;
  // 点溢出菜单外部 → 关闭菜单（仅注册一次）
  if (!actMenuListenerBound) {
    actMenuListenerBound = true;
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.act-menu, .act-menu-wrap')) closeActMenus();
    });
  }
  // 点击看板列空白处 → 快速添加待办
  content.querySelectorAll('.kanban-col').forEach((col) => {
    col.onclick = (e) => {
      if (e.target.closest('.kanban-card, .kanban-head, button, input, select, textarea')) return;
      App.overview.openActModal();
    };
  });
  content.querySelectorAll('.kanban-card').forEach((c) => {
    if (c.closest('.kanban-arch')) { c.draggable = false; return; } // 归档区卡片只读，禁止拖回看板
    c.ondragstart = () => { dragId = c.dataset.id; wasDragging = true; c.classList.add('dragging'); };
    c.ondragend = () => { c.classList.remove('dragging'); dragId = null; wasDragging = false; content.querySelectorAll('.kanban-col').forEach((x) => x.classList.remove('drag-over')); };
  });
  content.querySelectorAll('.kanban-col').forEach((col) => {
    col.ondragover = (e) => { e.preventDefault(); col.classList.add('drag-over'); };
    col.ondragleave = () => col.classList.remove('drag-over');
    col.ondrop = (e) => {
      e.preventDefault(); col.classList.remove('drag-over');
      if (!dragId) return;
      const a = App.db.activities.find((x) => x.id === dragId);
      if (!a) return;
      const target = col.dataset.col;
      const r = (fn) => { const res = fn(); if (res && !res.ok) toast(res.error, 'err'); else App.refresh(); };
      if (target === 'Started') {
        if (a.status === 'Planned') { App.startAct(a.id); return; }
      } else if (target === 'Done') {
        if (a.status === 'Started') openCompleteModal(a.id);
      }
      // 其余回退/非法拖拽：忽略（状态机铁律）
    };
  });
}


  // ---------------- 主渲染 ----------------
export function render(App, el) {
  const { db } = App;

  el.innerHTML = `
    <div class="dash-pager" id="dash-pager">
      <div class="dash-nav">
        <button type="button" class="dash-nav-item on" data-page="0">📋 活动看板</button>
        <button type="button" class="dash-nav-item" data-page="1">📅 当日日程</button>
        <button type="button" class="dash-nav-item" data-page="2">📝 编辑器</button>
      </div>
      <div class="dash-track">
        <section class="dash-page">
          <div class="card">
            <div class="card-head">
              <h3>活动看板</h3>
              <div class="row-gap">
                <button class="btn sm primary" onclick="App.overview.openActModal()">＋ 活动</button>
              </div>
            </div>
            <div id="kanban-root">${kanbanFilterBar(App)}<div class="kanban">${kanbanHTML(App)}</div></div>
          </div>
        </section>
        <section class="dash-page">
          <div id="calendar-section"></div>
        </section>
        <section class="dash-page">
          <div data-ws-host></div>
        </section>
      </div>
    </div>
  `;
  calendar.renderSection(App, el.querySelector('#calendar-section'));
  const wsHost = el.querySelector('[data-ws-host]');
  // 三视图工作台（Vditor 编辑器 + 看板 + 日历）——延迟加载：把它打成独立 async chunk，
  // 只有切到「📝 编辑器」页才拉取，首屏不再背负造 570KB 的 Vditor 整包。
  if (wsHost) import('./workspace.js').then((ws) => ws.render(App, wsHost));
  setupDrag(App);
  settleThemeTones(App, el);
  syncPager(App, el);
}

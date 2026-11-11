// ============================================================
// views/hud.js — HUD 侧边栏（可开关）
// 目标 → 计划 → 活动 层级树，右上角常驻浮层（HUD 感），层级可展开/收起。
//  - 开关：顶栏 ☰ 按钮 或 面板 ✕；持久化 Prefs.hudEnabled
//  - 折叠态：模块内存（'g:{id}' 目标 / 'p:{id}' 计划 → true=收起；目标默认展开、计划默认收起）
//  - 活动列表每计划限 20 条防撑爆（预生成循环可能上百期）
//  - 点击活动行 → 打开编辑弹窗（日历/看板外又多一个入口）
// ============================================================
import { esc, badge, toast, openModal } from '../ui/helpers.js';
import { Prefs } from '../store/prefs.js';
import { getPlace, createPlace, updatePlace, removePlace, setCommute, isGeofenceable } from '../domain/places.js';
import { Geo } from '../services/geo.js';
import { System } from '../services/system.js';
import { generateDayPlan } from '../domain/plangen.js';
import { buildActivityGraph, shortestPathToGoal } from '../domain/activitygraph.js';
import { CHRONOTYPES } from '../domain/attention.js';

const MAX_ACTS = 20;
const collapsed = {}; // 'g:x' / 'p:x' → true=收起
let refreshTimer = null;
let hudFocusId = null; // 多视图联动：看板点击活动 → 展开所属分支并加亮该活动行
let planCache = null;  // 今日排班建议（咨询性，不落库；采纳才写活动）
let planKey = '';

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
      const regen = e.target.closest('[data-plan-regen]');
      if (regen) { planCache = null; planKey = ''; sync(); return; }
      const apply = e.target.closest('[data-plan-apply]');
      if (apply) { applyPlan(); return; }
      const edit = e.target.closest('[data-place-edit]');
      if (edit) { e.stopPropagation(); openPlaceModal(getPlace(App.db, edit.dataset.placeEdit)); return; }
      const del = e.target.closest('[data-place-del]');
      if (del) { e.stopPropagation(); deletePlace(del.dataset.placeDel); return; }
      const add = e.target.closest('[data-place-add]');
      if (add) { openPlaceModal(null); return; }
      const locate = e.target.closest('[data-place-locate]');
      if (locate) { locateOnce(); return; }
      const perm = e.target.closest('[data-place-perm]');
      if (perm) { openPermission(); return; }
      const place = e.target.closest('[data-place]');
      if (place) { setPlace(place.dataset.place); return; }
      const t = e.target.closest('[data-toggle]');
      if (t) { const k = t.dataset.toggle; collapsed[k] = !collapsed[k]; sync(); return; }
      const act = e.target.closest('[data-act]');
      if (act) { App.overview.openActModal(act.dataset.act); }
    });
    // 通勤分钟就地编辑（change 比 input 稳：不会每次敲键都重建 HUD）
    el.addEventListener('change', (e) => {
      const c = e.target.closest('[data-commute]');
      if (!c) return;
      const [from, to] = c.dataset.commute.split('|');
      const r = setCommute(App.db, from, to, c.value);
      if (!r.ok) return toast(r.error, 'err');
      App.refresh();
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
  const actRow = (a) => `<div class="hud-act${a.id === hudFocusId ? ' hud-focus' : ''}" data-act="${esc(a.id)}">${badge(a.status)}<span class="hud-act-t">${esc(a.title)}</span></div>`;
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

  rows.push(dayPlanBlock(db));
  rows.push(placesBlock(db));
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

// ---------- 地点块（Phase 1：手动切换兜底 + 围栏状态） ----------
function placesBlock(db) {
  const list = db.places || [];
  const cur = getPlace(db, db.currentPlaceId);
  const open = !collapsed.places;
  const head = `<div class="hud-node hud-goal" data-toggle="places">
    <span class="hud-caret">${open ? '▾' : '▸'}</span>
    <b>📍 地点</b>
    <span class="hud-cnt">${cur ? esc(cur.name) : '未定位'}</span>
  </div>`;
  if (!open) return head;

  const rows = list.map((p) => {
    const on = p.id === db.currentPlaceId;
    const meta = isGeofenceable(p) ? `${Number(p.radius) || 120}m` : '手动';
    return `<div class="hud-place${on ? ' on' : ''}" data-place="${esc(p.id)}" title="点击设为当前地点">
      <span class="hud-dot" style="background:${on ? '#4ade80' : '#667'}"></span>
      <span class="hud-place-t">${esc(p.name)}</span>
      <span class="hud-place-meta">${meta}</span>
      ${on ? '<span class="hud-tag">当前</span>' : ''}
      <span class="hud-place-edit" data-place-edit="${esc(p.id)}" title="编辑">✎</span>
      <span class="hud-place-del" data-place-del="${esc(p.id)}" title="删除">×</span>
    </div>`;
  }).join('');

  let commutes = '';
  if (cur && list.length > 1) {
    const lines = list.filter((p) => p.id !== cur.id).map((p) => {
      const c = (db.commutes || []).find((x) => (x.from_id === cur.id && x.to_id === p.id)
        || (x.from_id === p.id && x.to_id === cur.id));
      return `<div class="hud-commute">
        <span>${esc(cur.name)} ↔ ${esc(p.name)}</span>
        <input type="number" min="0" step="5" inputmode="numeric" placeholder="分"
          data-commute="${esc(cur.id)}|${esc(p.id)}" value="${c ? c.minutes : ''}">
      </div>`;
    }).join('');
    commutes = `<div class="hud-sub">🚗 通勤（分钟，留空清除）</div>${lines}`;
  }

  return `${head}
    ${rows || '<div class="muted" style="padding:4px 8px">还没有地点</div>'}
    <div class="hud-place-actions">
      <span data-place-add>＋ 地点</span>
      <span data-place-locate>◎ 定位</span>
      <span data-place-perm>权限</span>
    </div>
    ${commutes}`;
}

function setPlace(id) {
  const r = Geo.setCurrent(App.db, id);
  if (!r.ok) return toast(r.error, 'err');
  App.refresh();
}

function openPlaceModal(existing) {
  const p = existing || { name: '', lat: '', lng: '', radius: 120 };
  const m = openModal({
    title: existing ? '编辑地点' : '添加地点',
    bodyHTML: `
      <div class="field"><label>名称</label><input id="pl-name" value="${esc(p.name || '')}" placeholder="家 / 工位 / 健身房"></div>
      <div class="grid2">
        <div class="field"><label>纬度</label><input id="pl-lat" inputmode="decimal" value="${p.lat == null ? '' : esc(String(p.lat))}" placeholder="自动获取"></div>
        <div class="field"><label>经度</label><input id="pl-lng" inputmode="decimal" value="${p.lng == null ? '' : esc(String(p.lng))}" placeholder="自动获取"></div>
      </div>
      <div class="row-gap" style="margin-bottom:6px;align-items:center">
        <button type="button" class="btn sm" id="pl-locate">◎ 用当前位置</button>
        <span id="pl-loc-hint" class="muted" style="font-size:12px"></span>
      </div>
      <div class="field"><label>半径（米）</label><input id="pl-radius" inputmode="numeric" value="${esc(String(p.radius || 120))}"></div>
      <p class="muted">没有坐标的地点只能手动切换，不注册原生围栏。</p>`,
    footerHTML: '<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>保存</button>',
  });
  // 自动校准：新建（或旧地点缺坐标）时先取一次当前位置，把真实坐标截留下来，
  // 用户只需填名称。定位失败不阻塞，仍可手动填写。
  // 无论成功/失败/异常都必须复位按钮与提示——否则一旦原生无响应就会永远停在「定位中」。
  const fillLoc = async () => {
    const btn = m.q('#pl-locate');
    const hint = m.q('#pl-loc-hint');
    if (btn) btn.disabled = true;
    if (hint) hint.textContent = '定位中…';
    try {
      const r = await Geo.getLocation();
      if (!r.ok) {
        if (hint) hint.textContent = r.error || '定位失败，可手动填写';
        return;
      }
      m.q('#pl-lat').value = String(r.lat.toFixed(6));
      m.q('#pl-lng').value = String(r.lng.toFixed(6));
      if (hint) {
        hint.textContent = r.accuracy
          ? `已取当前位置（±${Math.round(r.accuracy)} 米）`
          : '已取当前位置';
      }
    } catch (e) {
      if (hint) hint.textContent = '定位失败，可手动填写';
    } finally {
      if (btn) btn.disabled = false;
    }
  };
  if (m.q('#pl-locate')) m.q('#pl-locate').onclick = fillLoc;
  const needLoc = existing ? (p.lat == null || p.lng == null) : true;
  if (needLoc) fillLoc();
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const input = {
      name: m.q('#pl-name').value,
      lat: m.q('#pl-lat').value,
      lng: m.q('#pl-lng').value,
      radius: m.q('#pl-radius').value,
    };
    const r = existing ? updatePlace(App.db, existing.id, input) : createPlace(App.db, input);
    if (!r.ok) return toast(r.error, 'err');
    m.close();
    App.refresh();
    Geo.sync(App.db);
    toast(existing ? '地点已更新' : '地点已添加', 'ok');
  };
}

async function deletePlace(id) {
  const p = getPlace(App.db, id);
  if (!p) return;
  if (!(await System.confirm({ title: '删除地点', message: `删除「${p.name}」？相关通勤边会一并移除。` }))) return;
  const r = removePlace(App.db, id);
  if (!r.ok) return toast(r.error, 'err');
  App.refresh();
  Geo.sync(App.db);
}

async function locateOnce() {
  try {
    const r = await Geo.locateOnce(App.db);
    if (!r.ok) return toast(r.error || '定位失败', 'err');
    App.refresh();
    if (r.placeId) toast(`已定位到「${r.name}」（约 ${r.distance} 米）`, 'ok');
    else toast('当前位置不在任何地点半径内', 'warn');
  } catch (e) {
    toast('定位失败，可手动切换地点', 'err');
  }
}

async function openPermission() {
  let st = { ok: false };
  try { st = await Geo.status(); } catch (e) { /* 忽略 */ }
  if (!Geo.isNative()) { toast('Web/Tauri 无需定位权限，点地点即可切换', 'info'); return; }
  // 缺 Play Services 时围栏根本注册不了：直接说清，避免用户误以为「定位坏了」
  if (st.gms === false) {
    toast('设备缺少 Google Play 服务：地理围栏不可用，请用「点地点」手动切换', 'warn');
    return;
  }
  if (st.location === 'granted' && st.background === 'granted') {
    toast(`围栏已注册：${st.registered ? '是' : '否'}`, 'ok');
    return;
  }
  toast('去系统设置开启「始终允许」定位权限', 'warn');
  Geo.openSettings();
}

// ---------- 今日排班（咨询性；采纳才写活动） ----------
const PLAN_REASON = {
  place: '地点不匹配',
  'commute-gap': '通勤来不及',
  budget: '深度预算已满',
  time: '当天无空档',
};

function dayKeyOf(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function hhmm(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtPlanStart(ts) {
  return `${dayKeyOf(ts)}T${hhmm(ts)}`;
}

// 影响排班的输入指纹：日期 / 当前地点 / 弹性活动 / 地点 / 通勤
function planFingerprint(db) {
  return JSON.stringify({
    d: dayKeyOf(Date.now()),
    p: db.currentPlaceId || null,
    a: (db.activities || [])
      .filter((a) => a.status === 'Planned')
      .map((a) => [a.id, a.title, a.place_id || null, Number(a.planned_minutes) || 0, a.planned_start || null, a.planned_date || null]),
    l: (db.places || []).map((p) => [p.id, p.lat, p.lng, p.radius]),
    c: db.commutes || [],
  });
}

function ensurePlan(db) {
  const key = planFingerprint(db);
  if (planCache && planKey === key) return planCache;
  planKey = key;
  planCache = generateDayPlan(db, {
    date: Date.now(),
    now: Date.now(),
    currentPlaceId: db.currentPlaceId || null,
    profile: 'deep',
    peaks: CHRONOTYPES.lark,
  });
  return planCache;
}

function dayPlanBlock(db) {
  const open = !collapsed.plan;
  const head = `<div class="hud-node hud-goal" data-toggle="plan">
    <span class="hud-caret">${open ? '▾' : '▸'}</span>
    <b>🗓 今日排班</b>
    <span class="hud-cnt">${open ? '' : '点开生成'}</span>
  </div>`;
  if (!open) return head;

  const plan = ensurePlan(db);
  const actMap = new Map((db.activities || []).map((a) => [a.id, a]));
  const levelTxt = { ok: '宽松', tight: '偏紧', over: '过载' }[plan.rho.level] || plan.rho.level;

  const rows = plan.assignments.map((x) => {
    const a = actMap.get(x.activityId);
    if (!a) return '';
    return `<div class="hud-plan-row" data-act="${esc(a.id)}" title="点击编辑活动">
      <span class="hud-time">${hhmm(x.start)}–${hhmm(x.end)}</span>
      <span class="hud-plan-t">${esc(a.title)}</span>
      <span class="hud-depth">${x.depth ? '深度' : ''}</span>
    </div>`;
  }).join('');

  const un = plan.unplaced.map((x) => {
    const a = actMap.get(x.activityId);
    return a ? `<div class="hud-unplaced">· ${esc(a.title)} — ${PLAN_REASON[x.reason] || x.reason}</div>` : '';
  }).join('');

  const over = plan.rho.level === 'ok' ? '' : `<div class="hud-overload${plan.rho.level === 'over' ? ' over' : ''}">
      <b>${plan.rho.level === 'over' ? '⚠ 过载' : '◐ 偏紧'}</b>
      <span>时间 ${plan.rho.rhoTime} · 深度 ${plan.rho.rhoDepth}${plan.rho.depthOverMin ? ` · 超出 ${plan.rho.depthOverMin} 分` : ''}</span>
    </div>`;

  const body = rows || (un ? '' : '<div class="muted" style="padding:4px 8px">今天没有可排的弹性活动</div>');

  return `${head}
    <div class="hud-plan-meta">ρ ${plan.rho.rhoTime}/${plan.rho.rhoDepth} · ${levelTxt}</div>
    ${over}
    ${body}
    ${un ? `<div class="hud-sub">未排</div>${un}` : ''}
    ${rerouteLine(db)}
    <div class="hud-place-actions">
      <span data-plan-regen>↻ 重新生成</span>
      <span data-plan-apply>✓ 采纳座次</span>
    </div>`;
}

// 战略图：当前位置 → 最近目标链的首个活动（改道建议，不自动执行）
function rerouteLine(db) {
  try {
    const g = buildActivityGraph(db, { currentPlaceId: db.currentPlaceId || null });
    const r = shortestPathToGoal(g, 'start');
    if (!r || !Array.isArray(r.path) || r.path.length < 3) return '';
    const node = r.path[1];
    if (!node || !node.startsWith('act:')) return '';
    const a = (db.activities || []).find((x) => x.id === node.slice(4));
    if (!a) return '';
    return `<div class="hud-reroute">↯ 改道：先做「${esc(a.title)}」（${Math.ceil(r.cost)} 分当量）</div>`;
  } catch (e) {
    return '';
  }
}

async function applyPlan() {
  const plan = ensurePlan(App.db);
  if (!plan.assignments.length) return toast('没有可采纳的座次', 'warn');
  const ok = await System.confirm({
    title: '采纳今日排班',
    message: `把 ${plan.assignments.length} 个活动的计划时间写入？未排的活动不受影响。`,
  });
  if (!ok) return;

  let done = 0;
  const errs = [];
  for (const x of plan.assignments) {
    const a = App.db.activities.find((y) => y.id === x.activityId);
    if (!a) continue;
    const r = App.engine.updateActivity(App.db, a.id, {
      planned_start: fmtPlanStart(x.start),
      planned_minutes: Math.round((x.end - x.start) / 60000),
    });
    if (r && r.ok) done++;
    else errs.push((r && r.error) || '未知错误');
  }
  planCache = null;
  planKey = '';
  App.refresh();
  toast(errs.length ? `已采纳 ${done} 个，${errs.length} 个失败` : `已采纳 ${done} 个座次`, errs.length ? 'warn' : 'ok');
}

// 多视图联动：看板/日历广播 app:focus-activity → 展开所属 目标→计划→活动 并加亮该活动
export function focusActivity(id) {
  if (!isEnabled()) return;
  const db = App.db;
  if (!db) return;
  const a = db.activities.find((x) => x.id === id);
  if (!a) return;
  for (const pid of a.plan_ids || []) {
    const p = db.plans.find((x) => x.id === pid);
    collapsed['p:' + pid] = false;
    if (p && p.goal_id) collapsed['g:' + p.goal_id] = false;
  }
  hudFocusId = id;
  sync();
}
window.addEventListener('app:focus-activity', (e) => { if (e && e.detail && e.detail.id) focusActivity(e.detail.id); });

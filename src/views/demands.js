// ============================================================
// views/demands.js
// 需求档案：按来源用户分组，逐条手写记录他们要什么。
// 展示成一条连续清单：来源用户是分组标题，需求是下面的清单项。
// 记录时只存原文、来源和备注，不预设时间与层级；
// 之后由我决定这条需求入列成目标 / 计划 / 活动（弹既有表单预填）。
// ============================================================
import { esc, toast, openModal, fmtDateTime } from '../ui/helpers.js';
import { themeStyle, themePickerHTML, bindThemePicker, readImageAsDataURL, themeTone, sampleImageTone, safeTheme } from '../ui/themes.js';
import { openGoalModal, openPlanModal } from './goals.js';
import { openActModal } from './overview.js';

let App = null;
const collapsed = new Set(); // 收起的来源分组（会话内记忆）

const STATUS_LABEL = { open: '待处理', admitted: '已入列', dropped: '已搁置' };
const STATUS_MARK = { open: '○', admitted: '✓', dropped: '—' };
const KIND_LABEL = { goal: '目标', plan: '计划', activity: '活动' };

// 来源用户区分色：刻意避开状态色（琥珀/绿/灰），用冷色系并与条目染色错开
const USER_COLORS = ['#5b6ee1', '#7c5cd6', '#2f7fd0', '#0e7490', '#be185d', '#6d28d9', '#2563eb', '#0f766e'];
function userColor(u) {
  const s = String((u && (u.id || u.name)) || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return USER_COLORS[h % USER_COLORS.length];
}
function tint(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// 旧库可能没有这两个集合 / seq，读写前补齐
function pools(db) {
  if (!Array.isArray(db.requesters)) db.requesters = [];
  if (!Array.isArray(db.demands)) db.demands = [];
  if (!db.seq || typeof db.seq !== 'object') db.seq = {};
  return db;
}

function nextId(db, seqKey, prefix) {
  db.seq[seqKey] = (Number(db.seq[seqKey]) || 0) + 1;
  return prefix + db.seq[seqKey];
}

function demandRow(d) {
  return `
    <div class="demand-row ${esc(d.status)}">
      <span class="demand-mark" title="${STATUS_LABEL[d.status] || ''}">${STATUS_MARK[d.status] || '○'}</span>
      <div class="demand-body">
        <div class="demand-text">${esc(d.text)}</div>
        <div class="demand-meta">
          <span class="demand-state ${esc(d.status)}">${STATUS_LABEL[d.status] || d.status}</span>
          ${d.status === 'admitted' && d.kind ? ` · ${KIND_LABEL[d.kind] || d.kind}` : ''}
          · ${fmtDateTime(d.createdAt)}${d.note ? ` · ${esc(d.note)}` : ''}
        </div>
      </div>
      <div class="demand-actions">
        ${d.status === 'open' ? `<button class="btn sm primary" data-admit="${esc(d.id)}">入列…</button>` : ''}
        ${d.status === 'admitted' && d.targetId ? `<button class="btn sm" data-open-target="${esc(d.id)}">打开</button>` : ''}
        ${d.status === 'dropped'
          ? `<button class="btn sm" data-restore="${esc(d.id)}">恢复</button>`
          : `<button class="btn sm" data-drop="${esc(d.id)}">搁置</button>`}
        <button class="btn sm danger" data-del-demand="${esc(d.id)}">删除</button>
      </div>
    </div>`;
}

function sectionHTML(u, list) {
  const open = list.filter((d) => d.status === 'open').length;
  const isCollapsed = collapsed.has(u.id);
  const sorted = list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const color = userColor(u);
  const style = `--uc:${color};--uc-soft:${tint(color, 0.06)};--uc-line:${tint(color, 0.42)}`;
  const initial = esc((u.name || '?').slice(0, 1));
  // 来源可以像活动一样设置背景（渐变 / 图片），整块档案都铺背景；
  // 图片背景异步采样像素亮度，决定用白字还是深字
  const th = u.theme ? themeStyle(safeTheme(u.theme)) : null;
  const tone = th ? themeTone(safeTheme(u.theme)) : '';
  const bgStyle = th ? `background:${th};background-size:cover;background-position:center;` : '';
  const secClass = th ? `themed${tone === 'light' ? ' tone-light' : ''}` : '';
  const awaitTone = th && tone === null ? ' data-await-tone="1"' : '';
  return `
    <div class="demand-section ${secClass}"${awaitTone} data-rq="${esc(u.id)}" style="${style};${bgStyle}">
      <div class="demand-section-head" style="${style}">
        <button class="demand-toggle" data-toggle="${esc(u.id)}" title="${isCollapsed ? '展开' : '收起'}">${isCollapsed ? '▸' : '▾'}</button>
        <span class="demand-avatar">${initial}</span>
        <b>${esc(u.name || '未命名')}</b>
        <span class="muted">${esc(u.role || '未填关系')}</span>
        ${u.note ? `<span class="muted demand-section-note">${esc(u.note)}</span>` : ''}
        <span class="demand-section-count">待处理 ${open} / 共 ${list.length}</span>
        <button class="btn sm" data-edit-user="${esc(u.id)}">编辑</button>
        <button class="btn sm danger" data-del-user="${esc(u.id)}">删除</button>
      </div>
      ${isCollapsed ? '' : `
      <div class="demand-items">
        ${sorted.map(demandRow).join('') || '<div class="muted demand-empty">还没有记录。下面写第一条。</div>'}
        <div class="demand-add">
          <textarea data-add-text="${esc(u.id)}" rows="1" placeholder="记录ta的需求"></textarea>
          <input data-add-note="${esc(u.id)}" placeholder="备注（可空）">
          <button class="btn sm primary" data-add="${esc(u.id)}">记下</button>
        </div>
      </div>`}
    </div>`;
}

export function render(AppRef, el) {
  App = AppRef;
  const db = pools(App.db);
  const users = db.requesters.slice().sort((a, b) => (a.created || 0) - (b.created || 0));
  const of = (uid) => db.demands.filter((d) => d.requesterId === uid);

  el.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>需求档案</h3>
      </div>
      <div class="demand-toolbar">
        <button class="btn sm primary" data-new-user>＋ 新增来源</button>
        <span class="muted">来源 ${users.length} 位 · 待处理 ${db.demands.filter((d) => d.status === 'open').length} 条</span>
      </div>
      <div class="demand-list">
        ${users.map((u) => sectionHTML(u, of(u.id))).join('')
          || '<div class="muted demand-empty">还没有来源用户。点「＋ 新增来源」把「谁提的要求」立成一份档案。</div>'}
      </div>
    </div>`;

  bind(el);
}

function bind(el) {
  const db = App.db;

  // 图片背景：异步采样像素亮度后补 tone-light（与活动卡片同一套对比度规则）
  el.querySelectorAll('.demand-section[data-await-tone="1"]').forEach((sec) => {
    const u = db.requesters.find((r) => r.id === sec.dataset.rq);
    if (!u) return;
    sampleImageTone(safeTheme(u.theme), (tone) => {
      if (tone === 'light') sec.classList.add('tone-light');
      sec.removeAttribute('data-await-tone');
    });
  });

  el.querySelector('[data-new-user]').onclick = () => userModal(null);

  // 整条需求头都可点：点空白/名称/箭头都折叠展开；编辑、删除按钮除外
  el.querySelectorAll('.demand-section-head').forEach((head) => {
    head.onclick = (e) => {
      if (e.target.closest('[data-edit-user]') || e.target.closest('[data-del-user]')) return;
      const btn = head.querySelector('[data-toggle]');
      if (!btn) return;
      const id = btn.dataset.toggle;
      if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
      App.refresh();
    };
  });

  el.querySelectorAll('[data-edit-user]').forEach((b) => {
    b.onclick = () => userModal(db.requesters.find((r) => r.id === b.dataset.editUser));
  });

  el.querySelectorAll('[data-del-user]').forEach((b) => {
    b.onclick = async () => {
      const u = db.requesters.find((r) => r.id === b.dataset.delUser);
      if (!u) return;
      const n = db.demands.filter((d) => d.requesterId === u.id).length;
      const ok = await App.system.confirm({
        title: '删除来源档案',
        message: `删除「${u.name || '未命名'}」${n ? `会一并删掉他的 ${n} 条需求记录` : ''}。确定？`,
      });
      if (!ok) return;
      db.demands = db.demands.filter((d) => d.requesterId !== u.id);
      db.requesters = db.requesters.filter((r) => r.id !== u.id);
      collapsed.delete(u.id);
      App.refresh();
      toast('档案已删除');
    };
  });

  el.querySelectorAll('[data-add]').forEach((b) => {
    b.onclick = () => {
      const uid = b.dataset.add;
      const ta = el.querySelector(`[data-add-text="${uid}"]`);
      const noteEl = el.querySelector(`[data-add-note="${uid}"]`);
      const text = ta ? ta.value.trim() : '';
      if (!text) return toast('先写下他要什么', 'warn');
      db.demands.push({
        id: nextId(db, 'dm', 'dm'),
        requesterId: uid,
        text,
        note: noteEl ? noteEl.value.trim() : '',
        status: 'open',
        kind: '',
        targetId: '',
        createdAt: Date.now(),
      });
      App.refresh();
      toast('已记下', 'ok');
    };
  });

  el.querySelectorAll('[data-admit]').forEach((b) => {
    b.onclick = () => admit(db.demands.find((d) => d.id === b.dataset.admit));
  });

  el.querySelectorAll('[data-drop]').forEach((b) => {
    b.onclick = () => {
      const d = db.demands.find((x) => x.id === b.dataset.drop);
      if (!d) return;
      d.status = 'dropped';
      App.refresh();
    };
  });

  el.querySelectorAll('[data-restore]').forEach((b) => {
    b.onclick = () => {
      const d = db.demands.find((x) => x.id === b.dataset.restore);
      if (!d) return;
      d.status = 'open';
      App.refresh();
    };
  });

  el.querySelectorAll('[data-del-demand]').forEach((b) => {
    b.onclick = async () => {
      const d = db.demands.find((x) => x.id === b.dataset.delDemand);
      if (!d) return;
      const ok = await App.system.confirm({ title: '删除需求', message: `删除这条记录：「${d.text.slice(0, 40)}」？` });
      if (!ok) return;
      db.demands = db.demands.filter((x) => x.id !== d.id);
      App.refresh();
    };
  });

  el.querySelectorAll('[data-open-target]').forEach((b) => {
    b.onclick = () => {
      const d = db.demands.find((x) => x.id === b.dataset.openTarget);
      if (!d) return;
      App.setTab(d.kind === 'activity' ? 'overview' : 'goals');
    };
  });
}

// 悬浮钮入口：弹窗直接记一条需求（先选来源），不跳页
export function openAddDemand() {
  const app = App || window.App;
  if (!app) return;
  const db = pools(app.db);
  const users = db.requesters.slice().sort((a, b) => (a.created || 0) - (b.created || 0));
  if (!users.length) { toast('还没有来源用户：先在「需求档案」新增一位', 'warn'); return; }
  const m = openModal({
    title: '记一条需求',
    bodyHTML: `
      <div class="field"><label>来源</label><select id="qd-user">
        ${users.map((u) => `<option value="${esc(u.id)}">${esc(u.name || '未命名')}${u.role ? ` · ${esc(u.role)}` : ''}</option>`).join('')}
      </select></div>
      <div class="field"><label>他要什么</label><textarea id="qd-text" rows="3" placeholder="原话即可"></textarea></div>
      <div class="field"><label>备注（可空）</label><input id="qd-note"></div>`,
    footerHTML: '<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>记下</button>',
  });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const text = m.q('#qd-text').value.trim();
    if (!text) return toast('先写下他要什么', 'warn');
    db.demands.push({
      id: nextId(db, 'dm', 'dm'),
      requesterId: m.q('#qd-user').value,
      text,
      note: m.q('#qd-note').value.trim(),
      status: 'open', kind: '', targetId: '', createdAt: Date.now(),
    });
    m.close();
    app.refresh();
    toast('已记下', 'ok');
  };
  setTimeout(() => { const t = m.q('#qd-text'); if (t) t.focus(); }, 40);
}

function userModal(u) {
  let chosenTheme = u && u.theme ? safeTheme(u.theme) : null;
  const m = openModal({
    title: u ? '编辑来源档案' : '新增来源',
    bodyHTML: `
      <div class="field"><label>名称 *</label><input id="rq-name" value="${esc(u ? u.name : '')}"></div>
      <div class="field"><label>关系 / 角色</label><input id="rq-role" value="${esc(u ? u.role : '')}"></div>
      <div class="field"><label>备注</label><input id="rq-note" value="${esc(u ? u.note : '')}"></div>
      <div class="field"><label>分组背景（渐变 / 图片，可留空）</label><div id="rq-theme"></div></div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>保存</button>`,
  });
  const tp = m.q('#rq-theme');
  tp.innerHTML = themePickerHTML({ chosen: chosenTheme });
  bindThemePicker(tp, {
    onPick: (t) => { chosenTheme = t; },
    onUpload: (f) => readImageAsDataURL(f, (url) => { if (url) chosenTheme = { type: 'image', url }; }),
  });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const db = pools(App.db);
    const name = m.q('#rq-name').value.trim();
    if (!name) return toast('名称必填', 'warn');
    const role = m.q('#rq-role').value.trim();
    const note = m.q('#rq-note').value.trim();
    if (u) {
      Object.assign(u, { name, role, note, theme: chosenTheme });
    } else {
      db.requesters.push({ id: nextId(db, 'rq', 'rq'), name, role, note, theme: chosenTheme, created: Date.now() });
    }
    m.close();
    App.refresh();
  };
}

// 入列：选形态 → 打开既有表单（标题预填）→ 保存后把需求标记为已入列
function admit(d) {
  if (!d) return;
  const m = openModal({
    title: '这条需求入列成什么？',
    bodyHTML: `
      <p class="muted" style="font-size: calc(12px * var(--fs))">原文：${esc(d.text)}</p>
      <p class="muted" style="font-size: calc(12px * var(--fs))">只把标题和备注带过去；时间和层级在各自表单里再定。</p>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn" data-goal>目标</button><button class="btn" data-plan>计划</button><button class="btn primary" data-act>活动</button>`,
  });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-goal]').onclick = () => {
    m.close();
    openGoalModal(null, { title: d.text, desc: d.note, onSaved: (g) => link(d, 'goal', g && g.id) });
  };
  m.q('[data-plan]').onclick = () => {
    m.close();
    pickGoal((gid) => openPlanModal(gid, null, { title: d.text, onSaved: (p) => link(d, 'plan', p && p.id) }));
  };
  m.q('[data-act]').onclick = () => {
    m.close();
    openActModal(null, null, null, null, d.text, { onSaved: (a) => link(d, 'activity', a && a.id) });
  };
}

// 计划必须挂在目标下：只有一个目标就直接用，多个让选
function pickGoal(cb) {
  const goals = (App.db.goals || []).filter((g) => (g.status || 'Active') !== 'Archived');
  if (!goals.length) {
    toast('计划要挂在目标下：先去「目标与计划」建一个目标', 'warn');
    return;
  }
  if (goals.length === 1) { cb(goals[0].id); return; }
  const m = openModal({
    title: '挂到哪个目标下？',
    bodyHTML: `<div class="field"><label>目标</label><select id="pk-goal">${goals
      .map((g) => `<option value="${esc(g.id)}">${esc(g.title)}</option>`).join('')}</select></div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-ok>继续</button>`,
  });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-ok]').onclick = () => {
    const id = m.q('#pk-goal').value;
    m.close();
    cb(id);
  };
}

function link(d, kind, targetId) {
  const db = pools(App.db);
  const t = db.demands.find((x) => x.id === d.id);
  if (!t) return;
  t.status = 'admitted';
  t.kind = kind;
  t.targetId = targetId || '';
  t.admittedAt = Date.now();
  App.refresh();
  toast(`已入列成${KIND_LABEL[kind] || '行动'}`, 'ok');
}

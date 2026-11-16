// ============================================================
// views/demands.js
// 需求档案：把「来源用户」当顾客，像点菜一样手写记录他们要什么。
// 记录时只存原文、来源和备注，不预设时间与层级；
// 之后由我决定这条需求入列成目标 / 计划 / 活动（弹既有表单预填）。
// ============================================================
import { esc, toast, openModal, fmtDateTime } from '../ui/helpers.js';
import { openGoalModal, openPlanModal } from './goals.js';
import { openActModal } from './overview.js';

let App = null;
let selId = null;

const STATUS_LABEL = { open: '待处理', admitted: '已入列', dropped: '已搁置' };
const STATUS_CLASS = { open: 'b-amber', admitted: 'b-green', dropped: 'b-gray' };
const KIND_LABEL = { goal: '目标', plan: '计划', activity: '活动' };

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
    <div class="demand-item">
      <div class="demand-text">${esc(d.text)}</div>
      <div class="demand-meta">
        <span class="badge ${STATUS_CLASS[d.status] || 'b-gray'}">${STATUS_LABEL[d.status] || d.status}</span>
        ${d.status === 'admitted' && d.kind ? ` · ${KIND_LABEL[d.kind] || d.kind}` : ''}
        · ${fmtDateTime(d.createdAt)}${d.note ? ` · ${esc(d.note)}` : ''}
      </div>
      <div class="row-gap">
        ${d.status === 'open' ? `<button class="btn sm primary" data-admit="${esc(d.id)}">入列…</button>` : ''}
        ${d.status === 'admitted' && d.targetId ? `<button class="btn sm" data-open-target="${esc(d.id)}">打开</button>` : ''}
        ${d.status === 'dropped'
          ? `<button class="btn sm" data-restore="${esc(d.id)}">恢复</button>`
          : `<button class="btn sm" data-drop="${esc(d.id)}">搁置</button>`}
        <button class="btn sm danger" data-del-demand="${esc(d.id)}">删除</button>
      </div>
    </div>`;
}

function detailHTML(cur, list) {
  const sorted = list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return `
    <div class="card-head">
      <h3>${esc(cur.name || '未命名')}</h3>
      <span class="muted">${esc(cur.role || '未填关系')}</span>
    </div>
    ${cur.note ? `<p class="muted" style="font-size:12px;margin:0 0 6px">${esc(cur.note)}</p>` : ''}
    <div class="row-gap" style="margin-bottom:10px">
      <button class="btn sm" data-edit-user="${esc(cur.id)}">编辑档案</button>
      <button class="btn sm danger" data-del-user="${esc(cur.id)}">删除档案</button>
    </div>
    <div class="field">
      <label>他要什么（原话即可，暂不设时间与层级）</label>
      <textarea id="dm-text" rows="2" placeholder="例：下周帮我把实验数据整理成图"></textarea>
    </div>
    <div class="field"><input id="dm-note" placeholder="备注 / 我的判断（可空）"></div>
    <button class="btn primary sm" data-add-demand>记下这条需求</button>
    <div style="margin-top:12px">
      ${sorted.map(demandRow).join('') || '<div class="muted" style="font-size:12px">还没有记录。像点菜一样先手写下来。</div>'}
    </div>`;
}

export function render(AppRef, el) {
  App = AppRef;
  const db = pools(App.db);
  if (selId && !db.requesters.some((r) => r.id === selId)) selId = null;
  if (!selId && db.requesters.length) selId = db.requesters[0].id;

  const users = db.requesters.slice().sort((a, b) => (a.created || 0) - (b.created || 0));
  const cur = users.find((u) => u.id === selId) || null;
  const of = (uid) => db.demands.filter((d) => d.requesterId === uid);

  el.innerHTML = `
    <div class="demand-grid">
      <div class="card">
        <div class="card-head"><h3>需求档案</h3><span class="muted">来源用户 ${users.length} 位</span></div>
        <div class="row-gap" style="margin-bottom:8px">
          <button class="btn sm primary" data-new-user>＋ 新增来源</button>
        </div>
        <div class="demand-user-list">
          ${users.map((u) => {
            const list = of(u.id);
            const open = list.filter((d) => d.status === 'open').length;
            return `<button class="demand-user ${u.id === selId ? 'on' : ''}" data-user="${esc(u.id)}">
              <b>${esc(u.name || '未命名')}</b>
              <span>${esc(u.role || '未填关系')} · 待处理 ${open}${list.length ? ` / 共 ${list.length}` : ''}</span>
            </button>`;
          }).join('') || '<div class="muted" style="font-size:12px">还没有来源用户。上面新增：把「谁提的要求」立成一份档案。</div>'}
        </div>
      </div>

      <div class="card">
        ${cur ? detailHTML(cur, of(cur.id)) : '<div class="muted">先在左边选一位来源用户。</div>'}
      </div>
    </div>`;

  bind(el, cur);
}

function bind(el, cur) {
  const db = App.db;

  el.querySelector('[data-new-user]').onclick = () => userModal(null);

  el.querySelectorAll('[data-user]').forEach((b) => {
    b.onclick = () => { selId = b.dataset.user; App.refresh(); };
  });

  if (!cur) return;

  el.querySelector('[data-edit-user]').onclick = () => userModal(cur);

  el.querySelector('[data-del-user]').onclick = async () => {
    const n = db.demands.filter((d) => d.requesterId === cur.id).length;
    const ok = await App.system.confirm({
      title: '删除来源档案',
      message: `删除「${cur.name || '未命名'}」${n ? `会一并删掉他的 ${n} 条需求记录` : ''}。确定？`,
    });
    if (!ok) return;
    db.demands = db.demands.filter((d) => d.requesterId !== cur.id);
    db.requesters = db.requesters.filter((r) => r.id !== cur.id);
    selId = null;
    App.refresh();
    toast('档案已删除');
  };

  el.querySelector('[data-add-demand]').onclick = () => {
    const text = el.querySelector('#dm-text').value.trim();
    if (!text) return toast('先写下他要什么', 'warn');
    const note = el.querySelector('#dm-note').value.trim();
    db.demands.push({
      id: nextId(db, 'dm', 'dm'),
      requesterId: cur.id,
      text,
      note,
      status: 'open',
      kind: '',
      targetId: '',
      createdAt: Date.now(),
    });
    App.refresh();
    toast('已记下', 'ok');
  };

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

function userModal(u) {
  const m = openModal({
    title: u ? '编辑来源档案' : '新增来源',
    bodyHTML: `
      <div class="field"><label>名称 *</label><input id="rq-name" value="${esc(u ? u.name : '')}" placeholder="例：导师 / 妈妈 / 自己"></div>
      <div class="field"><label>关系 / 角色</label><input id="rq-role" value="${esc(u ? u.role : '')}" placeholder="例：导师 / 家人 / 客户 / 我"></div>
      <div class="field"><label>备注</label><input id="rq-note" value="${esc(u ? u.note : '')}" placeholder="他通常怎么提要求、看重什么"></div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>保存</button>`,
  });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const db = pools(App.db);
    const name = m.q('#rq-name').value.trim();
    if (!name) return toast('名称必填', 'warn');
    const role = m.q('#rq-role').value.trim();
    const note = m.q('#rq-note').value.trim();
    if (u) {
      Object.assign(u, { name, role, note });
    } else {
      const r = { id: nextId(db, 'rq', 'rq'), name, role, note, created: Date.now() };
      db.requesters.push(r);
      selId = r.id;
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
      <p class="muted" style="font-size:12px">原文：${esc(d.text)}</p>
      <p class="muted" style="font-size:12px">只把标题和备注带过去；时间和层级在各自表单里再定。</p>`,
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

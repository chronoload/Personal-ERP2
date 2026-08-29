// ============================================================
// views/batchCreate.js
// 批量排程：把 dayGuide「排满一整天」的自动顺延模式泛化为随时可用的功能。
// 从起始时间起逐个加入活动，时间自动顺延；改起始时间整体重排，删行后回补。
// 提交沿用 finishActs 的既有语义：首条失败即中止剩余（已建条目保留）。
// 与 dayGuide 的表面重复是刻意保留的 legacy 纪律，勿据此改动 dayGuide。
// ============================================================
import { esc, openModal, toast } from '../ui/helpers.js';
import { defaultStartPrefill } from '../domain/schedule.js';

// Date → 'YYYY-MM-DDTHH:MM'（本地分量补零；日期取自行自身时刻，跨零点自然换日）
function dtLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function hm(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
// datetime-local 值 → 本地毫秒（无效返回 null）
function parseLocalMs(v) {
  const t = new Date(String(v || '')).getTime();
  return Number.isNaN(t) ? null : t;
}

export function openBatchCreate() {
  const App = window.App;
  const db = App.db;
  // 队列：{ title, start:Date, minutes, plan_id }；cursor 为下一个空档毫秒
  let acts = [];
  const startInit = defaultStartPrefill(Date.now());
  let cursor = parseLocalMs(startInit);

  const planOpts = ['<option value="">不关联计划</option>']
    .concat(db.plans.map((p) => `<option value="${esc(p.id)}">${esc(p.title)}</option>`))
    .join('');

  const m = openModal({
    title: '⚡ 批量排程',
    bodyHTML: `
      <div class="field"><label>起始时间（后续自动顺延）</label><input id="f-bc-start" type="datetime-local" value="${esc(startInit)}"></div>
      <div class="grid2">
        <div class="field"><label>活动名称</label><input id="f-bc-title" placeholder="例：写第二章初稿"></div>
        <div class="field"><label>分钟</label><input id="f-bc-min" type="number" min="5" step="5" value="60"></div>
      </div>
      <div class="row-gap">
        <select id="f-bc-plan" style="flex:1">${planOpts}</select>
        <button class="btn primary sm" data-add>＋ 加入日程</button>
      </div>
      <div id="bc-list" class="dg-act-list"></div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save disabled>创建 0 项</button>`,
  });

  // 重排：以 base 为首行起点，后续按各自时长顺延（行_i.start = base + Σ此前时长）
  const reflowFrom = (base) => {
    let s = base;
    for (const x of acts) { x.start = new Date(s); s += x.minutes * 60000; }
    cursor = s;
  };

  // 删行后重排：保留现首行原定时间，仅后续顺延回补（dayGuide 同款语义）；清空则回到当前起始时间
  const delRow = (i) => {
    acts.splice(i, 1);
    const si = m.q('#f-bc-start');
    reflowFrom(acts.length ? acts[0].start.getTime() : (si && parseLocalMs(si.value)) || cursor);
    renderList();
  };

  const renderList = () => {
    const list = m.q('#bc-list');
    if (!list) return;
    const rows = acts.map((x, i) => `
      <div class="dg-act-row">
        <span class="dg-act-time">${hm(x.start)}</span>
        <span class="grow">${esc(x.title)}<span class="muted"> · ${x.minutes}m${x.plan_id ? ' · ' + esc(((db.plans.find((p) => p.id === x.plan_id) || {}).title) || '') : ''}</span></span>
        <button class="btn sm danger" data-del="${i}">✕</button>
      </div>`).join('');
    list.innerHTML = rows || '<div class="empty">还没添加，从上方开始吧</div>';
    list.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => delRow(Number(b.dataset.del));
    });
    // 底部提交按钮：实时反映队列长度，空队列禁用
    const save = m.q('[data-save]');
    if (save) { save.textContent = `创建 ${acts.length} 项`; save.disabled = !acts.length; }
  };

  const addRow = () => {
    const ti = m.q('#f-bc-title');
    const mi = m.q('#f-bc-min');
    const pi = m.q('#f-bc-plan');
    if (!ti || !mi) return;
    const title = ti.value.trim();
    if (!title) { ti.focus(); return; }
    if (!cursor) return toast('请先选择有效的起始时间', 'err');
    const minutes = Math.max(5, Number(mi.value) || 60);
    acts.push({ title, start: new Date(cursor), minutes, plan_id: pi && pi.value ? pi.value : '' });
    ti.value = '';
    reflowFrom(acts[0].start.getTime()); // 统一走重推，保持 cursor 与各行一致
    renderList();
    ti.focus();
  };

  const si = m.q('#f-bc-start');
  if (si) {
    // 改起始时间：全部已排队行整体重排，保持行间相对偏移
    si.addEventListener('input', () => {
      const t = parseLocalMs(si.value);
      if (t === null) return;
      reflowFrom(t);
      renderList();
    });
  }
  const addBtn = m.q('[data-add]');
  if (addBtn) addBtn.onclick = addRow;
  // 排队区回车语义是「加入日程」，覆盖弹窗默认「回车=提交」绑定
  [m.q('#f-bc-title'), m.q('#f-bc-min')].forEach((inp) => {
    if (!inp) return;
    inp.onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      addRow();
    };
  });
  const cancelBtn = m.q('[data-cancel]');
  if (cancelBtn) cancelBtn.onclick = () => m.close();

  // 提交：逐行建活动；planned_start 由各行自己的时刻推导（支持跨零点/跨天）
  const saveBtn = m.q('[data-save]');
  if (saveBtn) {
    saveBtn.onclick = () => {
      let n = 0;
      for (const x of acts) {
        const r = App.engine.createActivity(App.db, {
          title: x.title,
          note: '',
          plan_ids: x.plan_id ? [x.plan_id] : [],
          planned_start: dtLocal(x.start),
          planned_minutes: x.minutes,
        });
        if (!r.ok) { App.refresh(); toast(r.error, 'err'); return; } // 首条失败即中止剩余；先渲染已建条目再报错，避免界面陈旧
        n++;
      }
      m.close();
      App.refresh();
      toast(`已创建 ${n} 项活动`, 'ok');
    };
  }

  renderList();
  setTimeout(() => { const t = m.q('#f-bc-title'); if (t) t.focus(); }, 60);
}

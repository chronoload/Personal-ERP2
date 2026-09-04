// ============================================================
// views/finance.js
// 「资源」Tab —— 活动 Tab 之后的资金/资产主战场：
//   资源状态 / 兑换规则 / 商店(快速消费) / 价值流 / 系统反馈
// 从 overview.js 拆出：所有写操作仍经 App.engine（不变量强制），成功后才 refresh。
// 卡片内联事件统一走 App.finance.*（与 overview 解耦，便于独立装卸）。
// ============================================================
import { esc, fmtNum, fmtDate, badge, openModal, toast, empty, resColor } from '../ui/helpers.js';

// 内联事件参数转义（同 overview.js）
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

// ---------------- 资源 ----------------
const RESOURCE_COLORS = ['#4a7fbf', '#3da06a', '#d97706', '#7c3aed', '#dc2626', '#0e7490', '#be185d', '#4d7c0f'];

export function openResModal(editId) {
  const editing = editId ? App.db.resources.find((x) => x.id === editId) : null;
  let chosenColor = editing ? (editing.color || null) : null; // null = 自动分配
  const colorChips = RESOURCE_COLORS.map((c) =>
    `<button type="button" class="tag-chip color-dot ${chosenColor === c ? 'on' : ''}" data-color="${c}" style="--dot:${c}" title="${c}"><i></i></button>`).join('');
  const m = openModal({
    title: editing ? '编辑资源（名称 / 单位 / 颜色）' : '新增资源（决策 B：多资源账户，可自定义）',
    bodyHTML: `
      <div class="field"><label>资源名称</label><input id="f-rname" value="${esc(editing?.name || '')}" placeholder="例：灵感"></div>
      <div class="field"><label>单位</label><input id="f-runit" value="${esc(editing?.unit || '')}" placeholder="点 / 小时 / 元"></div>
      ${editing ? '' : '<div class="field"><label>初始余额</label><input id="f-rinit" type="number" value="0" step="0.01"></div>'}
      <div class="field"><label>标签颜色</label>
        <div class="tag-suggest" id="res-colors">
          ${colorChips}
          <button type="button" class="tag-chip color-auto ${chosenColor ? '' : 'on'}">自动</button>
        </div>
      </div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>${editing ? '保存' : '创建'}</button>`,
  });
  m.qa('#res-colors .color-dot').forEach((b) => {
    b.onclick = () => {
      chosenColor = b.dataset.color;
      m.qa('#res-colors .tag-chip').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    };
  });
  const autoBtn = m.q('.color-auto');
  autoBtn.onclick = () => {
    chosenColor = null;
    m.qa('#res-colors .tag-chip').forEach((x) => x.classList.remove('on'));
    autoBtn.classList.add('on');
  };
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const payload = {
      name: m.q('#f-rname').value,
      unit: m.q('#f-runit').value,
      color: chosenColor,
    };
    const r = editing
      ? App.engine.updateResource(App.db, editing.id, payload)
      : App.engine.createResource(App.db, {
          ...payload,
          initial: m.q('#f-rinit') ? m.q('#f-rinit').value : 0,
        });
    if (!r.ok) return toast(r.error, 'err');
    m.close(); App.refresh(); toast(editing ? '资源已更新' : '资源已创建');
  };
}

function resourceCard(App, r) {
  const b = App.engine.balanceOf(App.db, r.id);
  const init = r.initial || 1;
  const pct = Math.max(0, Math.min(100, (b / init) * 100));
  const danger = b < 0;
  // 智能配色：正常态用资源自选色（无则按 id 哈希），偏低黄、透支红
  const resC = safeColor(r.color) || resColor(r.id);
  return `
    <div class="res-card ${r.status === 'Inactive' ? 'off' : ''}" onclick="App.finance.openAdjustModal('${jsStr(r.id)}')" title="点击补充/调整余额">
      <div class="res-head">
        <span class="res-name">${esc(r.name)}</span>
        <span class="res-status">${r.status === 'Active' ? badge('Active_', '启用') : badge('Inactive', '停用')}</span>
      </div>
      <div class="res-balance ${danger ? 'neg' : ''}">${fmtNum(b)}<span class="res-unit"> ${esc(r.unit)}</span></div>
      <div class="progress"><i class="bar ${danger ? 'danger' : pct >= 90 ? 'warn' : ''}" style="width:${pct}%;${!danger && pct < 90 ? `background:${resC}` : ''}"></i></div>
      <div class="res-meta muted">初始 ${fmtNum(r.initial)} · 余额=Σ流水 · 点击补充</div>
      <div class="row-gap" onclick="event.stopPropagation()">
        <button class="btn sm primary" onclick="App.finance.openAdjustModal('${jsStr(r.id)}')">＋ 补充</button>
        <button class="btn sm" onclick="App.finance.openResModal('${jsStr(r.id)}')">编辑</button>
        <button class="btn sm" onclick="App.engine.setResourceStatus(App.db,'${jsStr(r.id)}','${r.status === 'Active' ? 'Inactive' : 'Active'}');App.refresh()">
          ${r.status === 'Active' ? '停用' : '启用'}
        </button>
        <button class="btn sm danger" onclick="App.finance.delResource('${jsStr(r.id)}')">删除</button>
      </div>
    </div>`;
}

// 点击资源卡：简洁补充/调整余额
export function openAdjustModal(resourceId) {
  const r = App.db.resources.find((x) => x.id === resourceId);
  if (!r) return;
  const m = openModal({
    title: `补充「${r.name}」`,
    accent: 'ok',
    bodyHTML: `
      <p class="muted">当前余额：<b class="amount ${App.engine.balanceOf(App.db, r.id) < 0 ? 'neg' : 'pos'}">${fmtNum(App.engine.balanceOf(App.db, r.id))} ${esc(r.unit)}</b></p>
      <div class="grid2">
        <div class="field"><label>操作</label><select id="f-adir"><option value="debit">补充（+余额）</option><option value="credit">扣减（−余额）</option></select></div>
        <div class="field"><label>金额 &gt; 0</label><input id="f-aamt" type="number" min="0" step="0.01"></div>
      </div>
      <div class="field"><label>备注</label><input id="f-anote" placeholder="例：发工资 / 充值 / 修正"></div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>入账</button>`,
  });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const res = App.engine.adjustResource(App.db, resourceId, {
      direction: m.q('#f-adir').value, amount: m.q('#f-aamt').value, note: m.q('#f-anote').value,
    });
    if (!res.ok) return toast(res.error, 'err');
    m.close(); App.refresh(); toast('已入账', 'ok');
  };
}

export async function delResource(id) {
  const r = App.db.resources.find((x) => x.id === id);
  if (!r) return;
  const nTx = App.db.txs.filter((t) => t.resource_id === id).length;
  const nRule = App.db.rules.filter((x) => x.from === id || x.to === id).length;
  const parts = [];
  if (nTx) parts.push(`${nTx} 条流水`);
  if (nRule) parts.push(`${nRule} 条兑换规则`);
  const msg = parts.length
    ? `删除资源「${r.name}」将连带删除：${parts.join('、')}。确定？`
    : `删除资源「${r.name}」？`;
  if (!(await App.system.confirm({ title: '删除资源', message: msg }))) return;
  const res = App.engine.deleteResource(App.db, id);
  if (!res.ok) return toast(res.error, 'err');
  App.refresh(); toast('资源已删除', 'ok');
}

// ---------------- 兑换规则 ----------------
export function openRuleModal() {
  const opts = App.db.resources.filter((r) => r.status === 'Active')
    .map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
  const m = openModal({
    title: '新增兑换规则（决策：单向换算 · 完全自定义）',
    bodyHTML: `
      <div class="field"><label>规则标签</label><input id="f-rlabel" placeholder="例：深度工作换算"></div>
      <div class="field"><label>从（消耗）</label><select id="f-rfrom">${opts}</select></div>
      <div class="field"><label>到（获得）</label><select id="f-rto">${opts}</select></div>
      <div class="field"><label>1 从 = ? 到</label><input id="f-rrate" type="number" min="0.01" step="0.01" value="1"></div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>创建</button>`,
  });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const r = App.engine.createRule(App.db, {
      label: m.q('#f-rlabel').value, from: m.q('#f-rfrom').value,
      to: m.q('#f-rto').value, rate: m.q('#f-rrate').value,
    });
    if (!r.ok) return toast(r.error, 'err');
    m.close(); App.refresh(); toast('兑换规则已创建');
  };
}

export function openConvertModal(ruleId) {
  const rule = App.db.rules.find((r) => r.id === ruleId);
  if (!rule) return;
  const from = App.db.resources.find((r) => r.id === rule.from);
  const to = App.db.resources.find((r) => r.id === rule.to);
  const m = openModal({
    title: `执行兑换：${rule.label}`,
    bodyHTML: `
      <p class="muted">1 ${esc(from.name)} → ${esc(rule.rate)} ${esc(to.name)}（单向）</p>
      <div class="field"><label>消耗 ${esc(from.name)} 数量</label><input id="f-camt" type="number" min="0" step="0.01" placeholder="当前余额 ${fmtNum(App.engine.balanceOf(App.db, rule.from))}"></div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>兑换</button>`,
  });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const r = App.engine.convert(App.db, rule.id, m.q('#f-camt').value);
    if (!r.ok) return toast(r.error, 'err');
    m.close(); App.refresh(); toast('兑换完成，已生成双向流水', 'ok');
  };
}

function ruleRow(App, r) {
  const from = App.db.resources.find((x) => x.id === r.from);
  const to = App.db.resources.find((x) => x.id === r.to);
  return `
    <div class="rule-row">
      <div class="grow">
        <b>${esc(r.label)}</b> ${r.status === 'Active' ? badge('Active_', '启用') : badge('Inactive', '停用')}
        <div class="muted">1 ${esc(from?.name || '?')} → ${esc(r.rate)} ${esc(to?.name || '?')}</div>
      </div>
      <div class="row-gap">
        ${r.status === 'Active' ? `<button class="btn sm primary" onclick="App.finance.openConvertModal('${jsStr(r.id)}')">兑换</button>` : ''}
        <button class="btn sm" onclick="App.engine.setRuleStatus(App.db,'${jsStr(r.id)}','${r.status === 'Active' ? 'Inactive' : 'Active'}');App.refresh()">${r.status === 'Active' ? '停用' : '启用'}</button>
      </div>
    </div>`;
}

// ---------------- 商品 · 快速消费（LifeUp 式） ----------------
function costLabel(App, g) {
  const costs = App.engine.goodCosts(g);
  return costs.map((c) => {
    const r = App.db.resources.find((x) => x.id === c.resource_id);
    return `${fmtNum(c.amount)}${r?.unit ? esc(r.unit) : ''} ${esc(r?.name || '?')}`;
  }).join(' ＋ ');
}

function goodCard(App, g) {
  const costs = App.engine.goodCosts(g);
  const poor = costs.some((c) => App.engine.balanceOf(App.db, c.resource_id) < c.amount * 1);
  const balLine = costs.map((c) => {
    const r = App.db.resources.find((x) => x.id === c.resource_id);
    return `${esc(r?.name || '?')} 余 ${fmtNum(App.engine.balanceOf(App.db, c.resource_id))}`;
  }).join(' · ');
  return `
    <div class="good-card ${g.status === 'Inactive' ? 'off' : ''} ${poor ? 'poor' : ''}" onclick="App.finance.openConsumeModal('${jsStr(g.id)}')" title="点击消费（余额不足将借贷）">
      <div class="good-emoji">${esc(g.emoji)}</div>
      <div class="good-name">${esc(g.name)}</div>
      <div class="good-price">${costLabel(App, g)}</div>
      ${g.note ? `<div class="good-note">${esc(g.note)}</div>` : ''}
      <div class="good-bal muted">${balLine}</div>
      <div class="row-gap" style="margin-top:8px" onclick="event.stopPropagation()">
        <button class="btn sm" onclick="App.finance.openGoodModal('${jsStr(g.id)}')">编辑</button>
        <button class="btn sm" onclick="App.engine.setGoodStatus(App.db,'${jsStr(g.id)}','${g.status === 'Active' ? 'Inactive' : 'Active'}');App.refresh()">${g.status === 'Active' ? '停用' : '启用'}</button>
        <button class="btn sm danger" onclick="App.finance.delGood('${jsStr(g.id)}')">删除</button>
      </div>
    </div>`;
}

// 新增 / 编辑商品：多资源成本编辑器
export function openGoodModal(editId) {
  const g = editId ? App.db.goods.find((x) => x.id === editId) : null;
  const active = App.db.resources.filter((r) => r.status === 'Active');
  const resOpts = (sel) => active
    .map((r) => `<option value="${esc(r.id)}" ${sel === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
  const initCosts = g ? App.engine.goodCosts(g) : [{ resource_id: active[0]?.id || '', amount: '' }];
  const m = openModal({
    title: g ? '编辑商品' : '新增商品（快速消费）',
    width: 560,
    bodyHTML: `
      <div class="field"><label>商品名称 *</label><input id="f-gname" value="${esc(g?.name || '')}" placeholder="例：一杯咖啡"></div>
      <div class="field"><label>图标（emoji）</label><input id="f-gemoji" value="${esc(g?.emoji || '')}" placeholder="☕"></div>
      <div class="field"><label>消耗资源（可多种，如 金钱+精力）</label>
        <div id="f-gcosts">
          ${initCosts.map((c) => `
            <div class="row-gap dg-cost-row" style="margin-bottom:6px">
              <select class="gc-res" style="flex:1">${resOpts(c.resource_id)}</select>
              <input type="number" class="gc-amt" min="0.01" step="0.01" value="${esc(c.amount ?? '')}" placeholder="数量" style="width:110px">
              <button class="btn sm danger" data-delcost>✕</button>
            </div>`).join('')}
        </div>
        <button class="btn sm" data-addcost>＋ 加一种资源</button>
      </div>
      <div class="field"><label>备注</label><input id="f-gnote" value="${esc(g?.note || '')}" placeholder="可选"></div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>${g ? '保存' : '创建'}</button>`,
  });

  const bindDel = () => m.qa('[data-delcost]').forEach((b) => {
    b.onclick = () => b.closest('.dg-cost-row').remove();
  });
  m.q('[data-addcost]').onclick = () => {
    const div = document.createElement('div');
    div.className = 'row-gap dg-cost-row';
    div.style.marginBottom = '6px';
    div.innerHTML = `<select class="gc-res" style="flex:1">${resOpts()}</select>
      <input type="number" class="gc-amt" min="0.01" step="0.01" placeholder="数量" style="width:110px">
      <button class="btn sm danger" data-delcost>✕</button>`;
    m.q('#f-gcosts').appendChild(div);
    div.querySelector('[data-delcost]').onclick = () => div.remove();
  };
  bindDel();

  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const costs = [...m.qa('#f-gcosts .dg-cost-row')].map((row) => ({
      resource_id: row.querySelector('.gc-res').value,
      amount: row.querySelector('.gc-amt').value,
    })).filter((c) => c.resource_id && Number(c.amount) > 0);
    const payload = {
      name: m.q('#f-gname').value, emoji: m.q('#f-gemoji').value,
      costs, note: m.q('#f-gnote').value,
    };
    const r = g ? App.engine.updateGood(App.db, g.id, payload) : App.engine.createGood(App.db, payload);
    if (!r.ok) return toast(r.error, 'err');
    m.close(); App.refresh(); toast(g ? '已保存' : '商品已创建', 'ok');
  };
  setTimeout(() => { const e2 = m.q('#f-gname'); if (e2) e2.focus(); }, 60);
}

// 点击商品：确认数量后一键消费（逐资源生成 credit 流水，允许借贷）
export function openConsumeModal(goodId) {
  const g = App.db.goods.find((x) => x.id === goodId);
  if (!g) return;
  const costs = App.engine.goodCosts(g);
  const costLines = costs.map((c) => {
    const r = App.db.resources.find((x) => x.id === c.resource_id);
    const bal = App.engine.balanceOf(App.db, c.resource_id);
    return `<li>${fmtNum(c.amount)} ${esc(r?.unit || '')} · ${esc(r?.name || '?')}（余 <b class="${bal < c.amount ? 'neg' : 'pos'}">${fmtNum(bal)}</b>）</li>`;
  }).join('');
  const anyLack = costs.some((c) => App.engine.balanceOf(App.db, c.resource_id) < c.amount);
  const m = openModal({
    title: `消费「${g.name}」`,
    accent: 'warn',
    bodyHTML: `
      <div class="callout warn">${esc(g.emoji)} ${esc(g.name)} 消耗：</div>
      <ul style="margin:8px 0 12px;padding-left:20px;font-size:13px;line-height:1.9">${costLines}</ul>
      ${anyLack ? '<div class="callout">💡 部分资源不足，允许借贷扣为负数，后续充值自动回补。</div>' : ''}
      <div class="grid2">
        <div class="field"><label>数量</label><input id="f-gqty" type="number" min="1" step="1" value="1"></div>
        <div class="field"><label>备注</label><input id="f-gnote" placeholder="可选"></div>
      </div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>${anyLack ? '确认消费（借贷）' : '确认消费'}</button>`,
  });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const res = App.engine.consumeGood(App.db, g.id, { qty: m.q('#f-gqty').value, note: m.q('#f-gnote').value });
    if (!res.ok) return toast(res.error, 'err');
    m.close(); App.refresh(); toast('已消费，流水已入账', 'ok');
  };
}

export async function delGood(id) {
  const g = App.db.goods.find((x) => x.id === id);
  if (!g) return;
  if (!(await App.system.confirm({ title: '删除商品', message: `删除商品「${g.name}」？历史消费流水保留。` }))) return;
  const r = App.engine.deleteGood(App.db, id);
  if (!r.ok) return toast(r.error, 'err');
  App.refresh(); toast('商品已删除');
}

// ---------------- 价值流 ----------------
export function openFeedbackModal(vfId) {
  const v = App.db.valueflows.find((x) => x.id === vfId);
  if (!v) return;
  const out = App.db.outputs.find((o) => o.id === v.output_id);
  const st = App.engine.vfStatus(App.db, v);
  const m = openModal({
    title: '录入价值流反馈（16BC 闭环）',
    accent: 'ok',
    bodyHTML: `
      <div class="callout">产出「${esc(out?.title || v.output_id)}」· 当前 ${badge(st)}${st === 'Overdue' ? '（已逾期，可补录）' : ''}</div>
      <div class="grid2">
        <div class="field"><label>给予方</label><input id="f-vg" value="${esc(v.giver || '')}" placeholder="例：我"></div>
        <div class="field"><label>接收方</label><input id="f-vr" value="${esc(v.receiver || '')}" placeholder="例：读者"></div>
      </div>
      <div class="field"><label>反馈内容</label><textarea id="f-vfb" rows="3" placeholder="外部反响 / 自我复盘"></textarea></div>
      <label class="chk"><input type="checkbox" id="f-vrec" checked> 回充资源 +10 价值元（决策 15C）</label>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>闭环</button>`,
  });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const r = App.engine.closeValueflow(App.db, v.id, {
      feedback: m.q('#f-vfb').value, recharge: m.q('#f-vrec').checked,
    });
    if (!r.ok) return toast(r.error, 'err');
    if (m.q('#f-vg').value.trim()) v.giver = m.q('#f-vg').value.trim();
    if (m.q('#f-vr').value.trim()) v.receiver = m.q('#f-vr').value.trim();
    m.close(); App.refresh(); toast('价值流已闭环', 'ok');
  };
}

function vfRow(App, v) {
  const out = App.db.outputs.find((o) => o.id === v.output_id);
  const st = App.engine.vfStatus(App.db, v);
  const who = [v.giver, v.receiver].filter(Boolean).join(' → ');
  return `
    <div class="vf-row">
      <div class="grow">
        <div>📤 ${esc(out?.title || v.output_id)} ${badge(st)}</div>
        <div class="muted">${who ? esc(who) + ' · ' : ''}期望反馈 ${fmtDate(v.expected)}</div>
        ${v.feedback ? `<div class="muted">💬 ${esc(v.feedback)}</div>` : ''}
      </div>
      ${st !== 'Closed' ? `<button class="btn sm primary" onclick="App.finance.openFeedbackModal('${jsStr(v.id)}')">录入反馈</button>` : ''}
    </div>`;
}

// ---------------- 主渲染：资源状态 / 兑换规则 / 商店 / 价值流 / 系统反馈 ----------------
export function render(App, el) {
  const { db, engine } = App;
  const blocked = db.plans.filter((p) => engine.isPlanBlocked(db, p.id));
  const overdue = db.valueflows.filter((v) => engine.vfStatus(db, v) === 'Overdue');

  el.innerHTML = `
    <section class="row-layout">
      <div class="card grow">
        <div class="card-head">
          <h3>资源状态</h3>
          <div class="row-gap">
            <span class="muted">余额 = 初始 + Σ(debit−credit) · 不变量1</span>
            <button class="btn sm" onclick="App.finance.openResModal()">＋ 资源</button>
          </div>
        </div>
        <div class="res-grid">${db.resources.map((r) => resourceCard(App, r)).join('')}</div>
      </div>
      <div class="card narrow">
        <div class="card-head">
          <h3>兑换规则</h3>
          <button class="btn sm" onclick="App.finance.openRuleModal()">＋ 新增</button>
        </div>
        ${db.rules.map((r) => ruleRow(App, r)).join('') || empty('暂无规则')}
      </div>
    </section>

    <section class="row-layout">
      <div class="card grow">
        <div class="card-head">
          <h3>🛍️ 商店 · 快速消费</h3>
          <div class="row-gap">
            <span class="muted">LifeUp 式一键消费 · 点击商品直接扣减余额</span>
            <button class="btn sm" onclick="App.finance.openGoodModal()">＋ 商品</button>
          </div>
        </div>
        <div class="goods-grid">${db.goods.map((g) => goodCard(App, g)).join('') || empty('暂无商品', '添加商品后即可一键快速消费')}</div>
      </div>
    </section>

    <section class="row-layout">
      <div class="card grow">
        <div class="card-head"><h3>价值流</h3><span class="muted">产出归档自动生成 · Pending → Closed / Overdue</span></div>
        ${db.valueflows.map((v) => vfRow(App, v)).join('') || empty('暂无价值流', '产出「归档」后自动生成')}
      </div>
      <div class="card narrow">
        <div class="card-head"><h3>系统反馈</h3></div>
        ${blocked.length ? blocked.map((p) => `
          <div class="fb warn"><b>⛔ 预算硬约束（不变量4）</b><p>「${esc(p.title)}」已耗 ${fmtNum(engine.planCost(db, p.id))}/${fmtNum(p.budget)}，新活动禁止开始/完成。</p></div>`).join('') : ''}
        ${overdue.length ? `<div class="fb warn"><b>⏰ 价值流逾期（16C）</b><p>${overdue.length} 条待补录反馈，可手动闭环。</p></div>` : ''}
        ${!blocked.length && !overdue.length ? '<div class="fb ok"><b>✓ 全部不变量满足</b><p>同惠链路正常，账目自洽。</p></div>' : ''}
      </div>
    </section>
  `;
}
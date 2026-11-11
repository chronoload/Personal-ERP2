// ============================================================
// views/finance.js
// 「资源」Tab —— 活动 Tab 之后的资金/资产主战场：
//   资源状态 / 记账器(命令+键盘+文本账单) / 兑换规则 / 商店 / 价值流
// 从 overview.js 拆出：所有写操作仍经 App.engine（不变量强制），成功后才 refresh。
// 卡片内联事件统一走 App.finance.*（与 overview 解耦，便于独立装卸）。
// ============================================================
import { esc, fmtNum, fmtDate, fmtDateTime, badge, openModal, toast, empty, resColor } from '../ui/helpers.js';
import { Prefs } from '../store/prefs.js';
import { parseLedgerCommand, applyOps, defaultResourceId } from '../domain/ledger.js';
import { analyze } from '../domain/capital.js';
import {
  BUILTIN_TEMPLATES, TEMPLATE_CATEGORIES, templateStats, appliedStage,
  buildTemplatePayload, extractGoalTemplate, extractPlanTemplate,
  parseTemplateMD, parseTemplatesMD, parseTemplateFile, mergeEditedTemplate,
  serializeTemplateMD, serializeTemplatesMD,
  TEMPLATE_PROMPT, TEMPLATE_MD_SCHEMA,
} from '../domain/templates.js';

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

// ---------------- 记账器：命令 / 键盘 / 文本账单 ----------------

// 记账命令输入：多行文本 → 逐笔入账（经 engine.adjustResource，失败 toast）
export function runLedgerCommand() {
  const inp = document.getElementById('ledger-cmd');
  const text = inp ? inp.value : '';
  if (!text.trim()) return toast('请输入记账命令，如 -8 早餐 或 +100 工资', 'warn');
  const { ops, errors } = parseLedgerCommand(App.db, text);
  if (errors.length) return toast(errors[0].error, 'err');
  if (!ops.length) return toast('没有可入账的命令', 'warn');
  const r = applyOps(App.db, App.engine, ops);
  if (r.errors.length) return toast(r.errors[0].error, 'err');
  if (inp) inp.value = '';
  App.refresh(); toast(`已入账 ${r.done} 笔`, 'ok');
}

export function clearLedgerCommand() {
  const inp = document.getElementById('ledger-cmd');
  if (inp) inp.value = '';
  if (inp) inp.focus();
}

// 记账器键盘：独立于系统键盘的弹窗，拼接命令 + 指定资源
export function openKeypad() {
  const db = App.db;
  const active = db.resources.filter((r) => r.status === 'Active');
  if (!active.length) return toast('请先创建资源', 'warn');
  const defId = defaultResourceId(db);
  const chips = active.map((r) =>
    `<button type="button" class="tag-chip kp-res" data-rid="${jsStr(r.id)}">${esc(r.name)}</button>`).join('');
  const kp = openModal({
    title: '🧮 记账器 · 命令行输入助手',
    accent: 'info',
    width: 360,
    bodyHTML: `
      <div class="kp-goods">${keypadGoodsHTML(db)}</div>
      <div class="kp-total" data-kp-total>命令区暂无流水</div>
      <div class="kp-display">
        <div class="kp-preview">0 <span class="kp-dir">支出</span></div>
        <div class="kp-bal"></div>
      </div>
      <div class="kp-res" data-kp-res>${chips}</div>
      <div class="field"><input id="kp-note" placeholder="备注（可选）" autocomplete="off"></div>
      <div class="kp-pad">
        <button class="kp-key" data-kp-num="7">7</button><button class="kp-key" data-kp-num="8">8</button><button class="kp-key" data-kp-num="9">9</button><button class="kp-key" data-kp-del>⌫</button>
        <button class="kp-key" data-kp-num="4">4</button><button class="kp-key" data-kp-num="5">5</button><button class="kp-key" data-kp-num="6">6</button><button class="kp-key kp-dir-btn" data-kp-dir>− 支出</button>
        <button class="kp-key" data-kp-num="1">1</button><button class="kp-key" data-kp-num="2">2</button><button class="kp-key" data-kp-num="3">3</button><button class="kp-key kp-submit" data-kp-submit title="加入命令区">＋ 加入</button>
        <button class="kp-key" data-kp-num="0">0</button><button class="kp-key" data-kp-num=".">.</button><button class="kp-key" data-kp-clear>C</button><button class="kp-key" data-kp-empty></button>
      </div>
      <div class="kp-hint muted">点「＋ 加入」/选商品 = 追加一行 DSL 到命令区；关闭后统一批量入账。</div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-enter data-save>完成 · 回到命令区</button>`,
  });
  // DSL 命令区 = 主页 #ledger-cmd（键盘只是它的输入助手，无独立命令窗）
  const cmdEl = document.getElementById('ledger-cmd');
  const st = { rid: defId, dir: 'credit', amount: '', note: '' };
  const balEl = kp.q('.kp-bal');
  const dirBtn = kp.q('[data-kp-dir]');
  const preview = kp.q('.kp-preview');
  const appendCmd = (line) => {
    if (!cmdEl) return;
    const txt = cmdEl.value.replace(/\n+$/, '');
    cmdEl.value = txt ? txt + '\n' + line : line;
    cmdEl.focus(); cmdEl.scrollTop = cmdEl.scrollHeight;
    updateTotal();
  };
  // 同步累加：解析命令区全部行 → 按资源累计支出/收入，让数字键盘有汇总意义
  const totalEl = kp.q('[data-kp-total]');
  const updateTotal = () => {
    if (!totalEl || !cmdEl) return;
    const { ops: all, errors } = parseLedgerCommand(db, cmdEl.value);
    const byRes = new Map();
    for (const op of all) {
      const key = op.resource_id;
      const cur = byRes.get(key) || { exp: 0, inc: 0 };
      if (op.direction === 'credit') cur.exp += op.amount; else cur.inc += op.amount;
      byRes.set(key, cur);
    }
    if (!all.length) { totalEl.textContent = errors.length ? `⚠ ${errors[0].error}` : '命令区暂无流水'; return; }
    const chips = [...byRes.entries()].map(([rid, v]) => {
      const r = db.resources.find((x) => x.id === rid);
      const name = esc(r?.name || '?');
      const parts = [];
      if (v.exp) parts.push(`支出 <b>-${fmtNum(v.exp)}</b>`);
      if (v.inc) parts.push(`收入 <b>+${fmtNum(v.inc)}</b>`);
      return `<span>${name}：${parts.join(' / ')}</span>`;
    }).join('');
    totalEl.innerHTML = `共 <b>${all.length}</b> 笔 · ${chips}` + (errors.length ? ` · ⚠${errors.length}` : '');
  };
  const refresh = () => {
    const r = db.resources.find((x) => x.id === st.rid);
    const amt = parseFloat(st.amount) || 0;
    const sign = st.dir === 'credit' ? '-' : '+';
    preview.innerHTML = `<b>${sign}${(st.amount || '0')}</b> <span class="kp-dir">${st.dir === 'credit' ? '支出' : '收入'}</span>`;
    dirBtn.textContent = st.dir === 'credit' ? '− 支出' : '+ 收入';
    dirBtn.className = 'kp-key kp-dir-btn ' + (st.dir === 'credit' ? 'kp-credit' : 'kp-debit');
    if (r) {
      const bal = App.engine.balanceOf(db, r.id);
      balEl.textContent = `${r.name} 余 ${fmtNum(bal)}${r.unit ? ' ' + r.unit : ''}${amt ? ` → ${fmtNum(st.dir === 'credit' ? bal - amt : bal + amt)}` : ''}`;
    } else balEl.textContent = '';
  };
  // 商品选中 → 每成本资源生成一行 DSL 追加（多类支出：一个商品可扣多种资源）
  const goodSel = kp.q('#ledger-good');
  if (goodSel) goodSel.addEventListener('change', () => {
    if (!goodSel.value) return;
    const g = App.db.goods.find((x) => x.id === goodSel.value);
    if (!g) return;
    const costs = App.engine.goodCosts(g);
    if (!costs.length) return toast('该商品无成本', 'warn');
    costs.forEach((c) => {
      const r = db.resources.find((x) => x.id === c.resource_id);
      appendCmd(`-${Number(c.amount)} ${(g.note || g.name).trim()}${r ? ' @' + r.name : ''}`);
    });
    goodSel.value = '';
  });
  kp.qa('[data-kp-res] .tag-chip').forEach((b) => {
    b.onclick = () => { st.rid = b.dataset.rid; kp.qa('[data-kp-res] .tag-chip').forEach((x) => x.classList.remove('on')); b.classList.add('on'); refresh(); };
  });
  kp.qa('.kp-key[data-kp-num]').forEach((b) => {
    b.onclick = () => { const v = b.dataset.kpNum; if (v === '.' && st.amount.includes('.')) return; st.amount = (st.amount + v).slice(0, 9); refresh(); };
  });
  kp.q('[data-kp-dir]').onclick = () => { st.dir = st.dir === 'credit' ? 'debit' : 'credit'; refresh(); };
  kp.q('[data-kp-del]').onclick = () => { st.amount = st.amount.slice(0, -1); refresh(); };
  kp.q('[data-kp-clear]').onclick = () => { st.amount = ''; refresh(); };
  kp.q('#kp-note').addEventListener('input', (e) => { st.note = e.target.value; });
  kp.q('[data-kp-submit]').onclick = () => {
    if (!(parseFloat(st.amount) || 0) > 0) return toast('请输入金额', 'warn');
    const r = db.resources.find((x) => x.id === st.rid);
    const line = `${st.dir === 'credit' ? '-' : '+'}${(st.amount || '0')}${(st.note || '').trim() ? ' ' + (st.note || '').trim() : ''}${r ? ' @' + r.name : ''}`;
    appendCmd(line);
    st.amount = ''; st.note = ''; const nEl = kp.q('#kp-note'); if (nEl) nEl.value = '';
    refresh();
  };
  kp.q('[data-cancel]').onclick = () => kp.close();
  kp.q('[data-save]').onclick = () => { kp.close(); if (cmdEl) cmdEl.focus(); };
  refresh();
}

// 商品清单（记账器键盘内）：下拉菜单，选中预填成本入账（菜单避免商品多时横向撑开弹窗）
function keypadGoodsHTML(db) {
  const goods = (db.goods || []).filter((g) => g.status !== 'Inactive');
  if (!goods.length) return '';
  const options = goods.map((g) => {
    const costs = App.engine.goodCosts(g);
    const price = costs.map((c) => {
      const r = db.resources.find((x) => x.id === c.resource_id);
      return `${fmtNum(c.amount)}${r?.unit ? ' ' + esc(r.unit) : ''}`;
    }).join('＋');
    return `<option value="${jsStr(g.id)}">${esc(g.emoji || '🛍')} ${esc(g.name)} · ${price}</option>`;
  }).join('');
  return `<div class="kp-goods-title">🛍 商品</div>
    <select id="ledger-good" class="kp-good-select"><option value="">选择商品（自动填成本）…</option>${options}</select>`;
}

// 文本版账单（Vditor 懒加载，仿 workspace）
let ledgerMounted = false;
export function openLedger() {
  const host = document.getElementById('ledger-host');
  if (!host) return;
  if (!ledgerMounted) {
    ledgerMounted = true;
    host.innerHTML = '<div class="muted" style="padding:12px">加载文本账单…</div>';
    import('./ledger.js').then((m) => {
      m.render(App, host);
    }).catch((e) => {
      host.innerHTML = `<div class="fb warn">文本账单加载失败：${esc(e && e.message || e)}</div>`;
    });
  } else if (window.__lgReloadFromDb) {
    try { window.__lgReloadFromDb(); } catch (e) {}
  }
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

// ---------------- 流水（日 / 周 / 月） ----------------
// 流水是账本的只读投影：不改 tx、不做余额计算，只按时间窗切片并汇总。
let flowMode = 'day';       // day | week | month
let flowAnchor = Date.now(); // 当前窗口锚点（切换视图时重置到「现在」）
let flowResId = '';          // '' = 全部资源

const FLOW_MODES = [['day', '日'], ['week', '周'], ['month', '月']];

function startOfDay(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function startOfWeek(ts) {
  const s = startOfDay(ts);
  const d = new Date(s);
  const back = (d.getDay() + 6) % 7; // 周一为一周之始
  return s - back * 86400000;
}

function startOfMonth(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function flowRange(mode, anchor) {
  if (mode === 'week') {
    const start = startOfWeek(anchor);
    return { start, end: start + 7 * 86400000 };
  }
  if (mode === 'month') {
    const start = startOfMonth(anchor);
    const d = new Date(start);
    d.setMonth(d.getMonth() + 1);
    return { start, end: d.getTime() };
  }
  const start = startOfDay(anchor);
  return { start, end: start + 86400000 };
}

function flowLabel(mode, range) {
  if (mode === 'month') {
    const d = new Date(range.start);
    return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
  }
  if (mode === 'week') return `${fmtDate(range.start)} ~ ${fmtDate(range.end - 1)}`;
  return fmtDate(range.start);
}

export function setFlowMode(mode) {
  if (!FLOW_MODES.some(([m]) => m === mode)) return;
  flowMode = mode;
  flowAnchor = Date.now();
  App.refresh();
}

export function shiftFlow(dir) {
  const d = new Date(flowAnchor);
  if (flowMode === 'week') d.setDate(d.getDate() + dir * 7);
  else if (flowMode === 'month') d.setMonth(d.getMonth() + dir);
  else d.setDate(d.getDate() + dir);
  flowAnchor = d.getTime();
  App.refresh();
}

export function setFlowResource(id) {
  flowResId = id || '';
  App.refresh();
}

function flowTxRow(App, t) {
  const r = App.db.resources.find((x) => x.id === t.resource_id);
  const isRev = !!t.reversal_of;
  const amount = t.debit ? `+${fmtNum(t.debit)}` : `−${fmtNum(t.credit)}`;
  return `<div class="flow-row${isRev ? ' rev' : ''}">
    <span class="res-dot" style="background:${safeColor(r && r.color) || resColor(t.resource_id)}"></span>
    <div class="flow-main">
      <div>
        <b>${esc(r ? r.name : '?')}</b>
        <span class="amount ${t.debit ? 'pos' : 'neg'}">${amount}</span>
        ${badge(t.source_type)}
        ${isRev ? '<span class="badge b-red">冲正</span>' : ''}
      </div>
      <div class="muted">${esc(t.note || '')} · ${fmtDateTime(t.created)}</div>
    </div>
  </div>`;
}

function flowSection(App) {
  const { db } = App;
  const range = flowRange(flowMode, flowAnchor);
  const inRange = (db.txs || []).filter((t) => t.created >= range.start && t.created < range.end);
  const scoped = flowResId ? inRange.filter((t) => t.resource_id === flowResId) : inRange;

  const income = scoped.reduce((s, t) => s + (t.debit || 0), 0);
  const expense = scoped.reduce((s, t) => s + (t.credit || 0), 0);
  const net = income - expense;

  // 周/月按天分组；日视图只有一组
  const days = new Map();
  for (const t of scoped) {
    const k = startOfDay(t.created);
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(t);
  }
  const groups = [...days.keys()].sort((a, b) => b - a).map((k) => {
    const list = days.get(k).sort((a, b) => b.created - a.created);
    const dayIn = list.reduce((s, t) => s + (t.debit || 0), 0);
    const dayOut = list.reduce((s, t) => s + (t.credit || 0), 0);
    return `<div class="flow-day">
      <div class="flow-day-head">
        <b>${fmtDate(k)}</b>
        <span class="muted">+${fmtNum(dayIn)} / −${fmtNum(dayOut)} · ${list.length} 笔</span>
      </div>
      ${list.map((t) => flowTxRow(App, t)).join('')}
    </div>`;
  }).join('') || empty('该时段暂无流水');

  const resOpts = '<option value="">全部资源</option>' + (db.resources || []).map((r) =>
    `<option value="${esc(r.id)}" ${flowResId === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('');

  const modes = FLOW_MODES.map(([m, label]) =>
    `<button class="btn sm${flowMode === m ? ' primary' : ''}" onclick="App.finance.setFlowMode('${m}')">${label}</button>`).join('');

  return `<section class="card flow-card" data-card-id="flow">
    <div class="card-head">
      <h3>流水</h3>
      <div class="row-gap">${modes}</div>
    </div>
    <div class="card-body">
      <div class="flow-toolbar">
        <button class="btn sm" onclick="App.finance.shiftFlow(-1)" title="上一段">‹</button>
        <b class="flow-period">${flowLabel(flowMode, range)}</b>
        <button class="btn sm" onclick="App.finance.shiftFlow(1)" title="下一段">›</button>
        <select class="flow-res" onchange="App.finance.setFlowResource(this.value)">${resOpts}</select>
      </div>
      <div class="flow-sum">
        <span>收入 <b class="amount pos">+${fmtNum(income)}</b></span>
        <span>支出 <b class="amount neg">−${fmtNum(expense)}</b></span>
        <span>净额 <b class="amount ${net < 0 ? 'neg' : 'pos'}">${net >= 0 ? '+' : '−'}${fmtNum(Math.abs(net))}</b></span>
        <span class="muted">${scoped.length} 笔</span>
      </div>
      <div class="flow-list">${groups}</div>
    </div>
  </section>`;
}

// ---------------- 卡片顺序（长按拖动，单卡粒度） ----------------
const CARD_ORDER_DEFAULT = ['templates', 'ledger', 'resources', 'rules', 'shop', 'valueflows', 'feedback', 'flow'];

function loadCardOrder() {
  const saved = (Prefs.load().cardOrder || {}).finance;
  const arr = Array.isArray(saved) ? saved.filter((id) => CARD_ORDER_DEFAULT.includes(id)) : [];
  for (const id of CARD_ORDER_DEFAULT) if (!arr.includes(id)) arr.push(id); // 新卡片追加到末尾
  return arr;
}

function saveCardOrder(ids) {
  const clean = ids.filter((id) => CARD_ORDER_DEFAULT.includes(id));
  for (const id of CARD_ORDER_DEFAULT) if (!clean.includes(id)) clean.push(id);
  Prefs.set({ cardOrder: { ...(Prefs.load().cardOrder || {}), finance: clean } });
}

// 长按 350ms 进入拖动态；按住后移动 >8px 视为滚动，不劫持页面滚动。
// 拖动态：卡片浮起（fixed，挂到 body）+ 占位块留在流内；占位块换位时用 FLIP
// 让兄弟卡片平滑让位，松手时浮动卡片动画落回占位块，避免瞬移。
let cardDrag = null;
let dragDocBound = false;
const DRAG_HOLD_MS = 350;

function bindDragDocGuards() {
  if (dragDocBound) return;
  dragDocBound = true;
  // 拖动态阻断页面滚动/长按菜单（触点在浮动卡片上会脱离容器，所以绑到 document）
  document.addEventListener('touchmove', (e) => {
    if (cardDrag && cardDrag.active) e.preventDefault();
  }, { passive: false });
  document.addEventListener('contextmenu', (e) => {
    if (cardDrag && cardDrag.active) e.preventDefault();
  });
}

function setupCardDrag(container) {
  if (!container) return;
  bindDragDocGuards();
  container.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // 按钮/输入等交互元素不触发拖动，避免「点 ＋ 资源」被长按劫持
    if (e.target.closest('button, a, input, select, textarea, label')) return;
    const head = e.target.closest('.card-head');
    if (!head) return;
    const card = head.closest('[data-card-id]');
    if (!card) return;
    cardDrag = { el: card, x: e.clientX, y: e.clientY, active: false, timer: null, ph: null };
    cardDrag.timer = setTimeout(activateCardDrag, DRAG_HOLD_MS);
    window.addEventListener('pointermove', onCardDragMove, { passive: false });
    window.addEventListener('pointerup', onCardDragEnd, { once: true });
    window.addEventListener('pointercancel', onCardDragEnd, { once: true });
  });
}

function activateCardDrag() {
  if (!cardDrag) return;
  const el = cardDrag.el;
  const rect = el.getBoundingClientRect();
  const ph = document.createElement('div');
  ph.className = 'card-placeholder';
  ph.style.height = `${rect.height}px`;

  const parent = el.parentElement;
  parent.insertBefore(ph, el);

  // 浮动卡片挂到 body：避免 fixed 受祖先 transform 影响，也让容器只保留占位块
  document.body.appendChild(el);
  el.style.position = 'fixed';
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
  el.style.margin = '0';
  el.style.zIndex = '60';
  el.style.pointerEvents = 'none';
  el.classList.add('card-dragging');

  cardDrag.ph = ph;
  cardDrag.offsetY = cardDrag.y - rect.top;
  cardDrag.active = true;
  document.body.classList.add('card-dragging-active');
  try { App.system.vibrate(12); } catch (err) { /* 忽略 */ }
}

// 占位块换位 + FLIP：兄弟卡片从旧位置平滑过渡到新位置
function movePlaceholder(ph, target) {
  const parent = ph.parentElement;
  const cards = [...parent.children].filter((c) => c.dataset && c.dataset.cardId);
  const beforeTop = new Map();
  for (const c of cards) beforeTop.set(c, c.getBoundingClientRect().top);

  if (target) parent.insertBefore(ph, target);
  else parent.appendChild(ph);

  for (const c of cards) {
    if (!c.isConnected) continue;
    const dy = beforeTop.get(c) - c.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) continue;
    c.style.transition = 'none';
    c.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => {
      c.style.transition = 'transform .18s cubic-bezier(.2,.7,.3,1)';
      c.style.transform = '';
    });
    setTimeout(() => { c.style.transition = ''; c.style.transform = ''; }, 240);
  }
}

function onCardDragMove(e) {
  if (!cardDrag) return;
  if (!cardDrag.active) {
    if (Math.hypot(e.clientX - cardDrag.x, e.clientY - cardDrag.y) > 8) {
      clearTimeout(cardDrag.timer);
      cardDrag = null;
    }
    return;
  }
  e.preventDefault();
  const el = cardDrag.el;
  el.style.top = `${e.clientY - cardDrag.offsetY}px`;

  const ph = cardDrag.ph;
  const parent = ph && ph.parentElement;
  if (!parent) return;
  const cards = [...parent.children].filter((c) => c.dataset && c.dataset.cardId);
  const target = cards.find((c) => {
    const r = c.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2;
  }) || null;
  // 目标没变就不重排，避免每帧触发布局
  if ((ph.nextElementSibling || null) !== target) movePlaceholder(ph, target);
}

function resetFloating(el) {
  el.classList.remove('card-dragging');
  ['position', 'left', 'top', 'width', 'height', 'margin', 'zIndex', 'pointerEvents', 'transition']
    .forEach((k) => { el.style[k] = ''; });
}

function onCardDragEnd() {
  window.removeEventListener('pointermove', onCardDragMove);
  if (!cardDrag) return;
  const { el, ph, active, timer } = cardDrag;
  clearTimeout(timer);
  cardDrag = null;
  if (!active) return;

  // 异常（视图被重建）时直接复位
  if (!ph || !ph.parentElement || !el.isConnected) {
    resetFloating(el);
    document.body.classList.remove('card-dragging-active');
    return;
  }

  // 松手：浮动卡片动画落回占位块，再写回顺序
  const target = ph.getBoundingClientRect();
  el.style.transition = 'top .18s cubic-bezier(.2,.7,.3,1), left .18s ease, height .18s ease';
  el.style.top = `${target.top}px`;
  el.style.left = `${target.left}px`;
  el.style.height = `${target.height}px`;

  setTimeout(() => {
    resetFloating(el);
    if (!ph.parentElement || !el.isConnected) {
      if (!cardDrag) document.body.classList.remove('card-dragging-active');
      return;
    }
    ph.parentElement.insertBefore(el, ph);
    ph.remove();
    if (!cardDrag) document.body.classList.remove('card-dragging-active');
    if (!el.parentElement) return;
    const ids = [...el.parentElement.querySelectorAll('[data-card-id]')].map((x) => x.dataset.cardId);
    saveCardOrder(ids);
    // 阻挡松手后的一次 click 穿透（避免误触卡片内按钮）
    const block = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    document.addEventListener('click', block, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', block, true), 400);
  }, 190);
}

// ---------------- 规划模板库（内置 + 自定义，先给第一版可见效果） ----------------
let tplFilter = '全部';

function templateBudget(tpl, recommended) {
  const staged = Array.isArray(tpl.stages) && tpl.stages.length > 0;
  if (staged) {
    return Math.round(tpl.stages.reduce((s, st) => s + recommended * (Number(st.share) || 0), 0));
  }
  if (tpl.kind === 'plan') return Number(tpl.plan && tpl.plan.budget) || 0;
  const plans = (tpl.goals || []).flatMap((g) => g.plans || []);
  return plans.reduce((s, p) => s + (Number(p.budget) || 0), 0);
}

function templateCard(tpl, recommended, unit) {
  const st = templateStats(tpl);
  const budget = templateBudget(tpl, recommended);
  const cat = tpl.category || (tpl.builtin ? '通用' : '自定义');
  const staged = st.stages > 0;
  const kindLabel = staged ? (tpl.builtin ? cat : 'MD 模板') : (tpl.kind === 'plan' ? '计划模板' : '目标模板');
  const done = staged ? Math.min(st.stages, appliedStage(App.db, tpl.id)) : 0;
  const full = staged && done >= st.stages;
  const stageText = staged ? ` · 阶段 ${done}/${st.stages}` : '';
  const action = full
    ? '<button class="btn sm" disabled>已完成全部阶段</button>'
    : `<button class="btn sm primary" onclick="App.finance.applyTemplate('${jsStr(tpl.id)}')">${staged ? (done ? `推进到阶段 ${done + 1}` : '应用阶段 1') : '应用'}</button>`;
  return `
    <div class="tpl-card" data-cat="${esc(cat)}" ${tplFilter !== '全部' && tplFilter !== cat ? 'hidden' : ''} onclick="App.finance.openTemplateView('${jsStr(tpl.id)}')" title="点击预览 / 编辑 MD">
      <div class="tpl-head">
        <strong>${esc(tpl.name)}</strong>
        <span class="tpl-cat">${esc(kindLabel)}</span>
      </div>
      <div class="tpl-desc muted">${esc(tpl.desc || '自定义结构模板')}</div>
      <div class="tpl-stat muted">${st.goals} 目标 · ${st.plans} 计划 · ${st.activities} 活动${stageText} · 全链预算 ${fmtNum(budget)}${unit ? ` ${esc(unit)}` : ''}</div>
      <div class="tpl-actions" onclick="event.stopPropagation()">
        ${action}
        <button class="btn sm" onclick="App.finance.exportTemplate('${jsStr(tpl.id)}')">⇩ MD</button>
        ${tpl.builtin ? '' : `<button class="btn sm danger" onclick="App.finance.deleteTemplate('${jsStr(tpl.id)}')">删除</button>`}
      </div>
    </div>`;
}

function templatesCard(App) {
  const a = analyze(App.db);
  const unit = (a.primary && a.primary.unit) || '';
  // 自定义模板三种形态都要显示：阶段链（MD 导入）/ 目标级 / 计划级
  const custom = (App.db.templates || []).filter((t) => t && t.id
    && (Array.isArray(t.stages) || Array.isArray(t.goals) || t.plan));
  const all = [...BUILTIN_TEMPLATES, ...custom];
  const cats = ['全部', ...TEMPLATE_CATEGORIES.filter((c) => c !== '自定义' || custom.length)];
  const chips = cats.map((c) => `<button type="button" class="tag-chip ${tplFilter === c ? 'on' : ''}" data-cat="${esc(c)}" onclick="App.finance.filterTemplates('${jsStr(c)}')">${esc(c)}</button>`).join('');
  return `
    <section class="card" data-card-id="templates">
      <div class="card-head">
        <h3>🧩 规划模板</h3>
        <div class="row-gap">
          <span class="muted">建议预算 ${fmtNum(a.recommended)}${unit ? ` ${esc(unit)}` : ''}</span>
          <button class="btn sm" onclick="App.finance.openTemplateImport()">⇩ 导入</button>
          <button class="btn sm" onclick="App.finance.exportAllTemplates()">⇧ 导出全部</button>
          <button class="btn sm" onclick="App.finance.openTemplatePrompt()" title="复制提示词，和模型多轮对话产出模板">?</button>
          <button class="btn sm" onclick="App.finance.openTemplateSave()">＋ 存为模板</button>
        </div>
      </div>
      <div class="card-body">
        <div class="tag-suggest" id="tpl-cats">${chips}</div>
        <div class="tpl-list">${all.map((t) => templateCard(t, a.recommended, unit)).join('')}</div>
        <div class="muted" style="font-size:11px;margin-top:8px">内置/MD 模板按建议预算的比例分配；目标级与计划级模板保留保存时的绝对预算。导入支持多文件、一个文件多模板；「⇩ MD」可导出单个模板。</div>
      </div>
    </section>`;
}

export function filterTemplates(cat) {
  tplFilter = cat || '全部';
  document.querySelectorAll('#tpl-cats .tag-chip').forEach((b) => b.classList.toggle('on', b.dataset.cat === tplFilter));
  document.querySelectorAll('#finance-flow .tpl-card').forEach((c) => {
    c.hidden = tplFilter !== '全部' && c.dataset.cat !== tplFilter;
  });
}

export async function applyTemplate(tplId) {
  const tpl = [...BUILTIN_TEMPLATES, ...(App.db.templates || [])].find((t) => t.id === tplId);
  if (!tpl) return toast('模板不存在', 'err');
  const a = analyze(App.db);
  if (a.addLocked) return toast('资本锁定中：先清理死账或完成/归档部分计划', 'warn');
  if (a.recommended <= 0) return toast('当前没有可用资本预算：先补充资源或记录收入', 'warn');

  // 有 stages 的模板（内置 / MD 导入）只展开「下一阶段」；目标级/计划级一次应用。
  const staged = Array.isArray(tpl.stages) && tpl.stages.length > 0;
  let stage = 0;
  let spec;
  if (staged) {
    stage = appliedStage(App.db, tpl.id) + 1;
    if (stage > tpl.stages.length) return toast('该模板已走完全部阶段', 'info');
    spec = buildTemplatePayload(tpl, { recommended: a.recommended, stage });
  } else {
    spec = buildTemplatePayload(tpl, { recommended: a.recommended });
  }
  if (!spec.planCount) return toast('模板里没有计划', 'warn');

  const stageInfo = staged
    ? `阶段 ${stage}/${tpl.stages.length} · ${tpl.stages[stage - 1].name}：`
    : '';
  const ok = await App.system.confirm({
    title: staged ? `推进模板：${tpl.name}` : `应用模板：${tpl.name}`,
    message: `${stageInfo}将创建 ${spec.goals.length} 个目标、${spec.planCount} 个计划、${spec.activityCount} 个活动，本阶段预算 ${fmtNum(spec.budgetTotal)}（建议 ${fmtNum(a.recommended)}）。继续？`,
  });
  if (!ok) return;

  let created = 0;
  const tag = (obj) => {
    if (!staged) return;
    obj.tpl_id = tpl.id;
    obj.tpl_stage = stage;
  };

  // 计划级自定义模板：挂到现有目标下
  if (spec.kind === 'plan' && spec.plan) {
    const target = (App.db.goals || []).find((g) => g.status !== 'Archived' && g.status !== 'Completed');
    if (!target) return toast('先建一个目标，再应用计划模板', 'warn');
    const pr = App.engine.createPlan(App.db, {
      goal_id: target.id, title: spec.plan.title, budget: spec.plan.budget,
      priority: spec.plan.priority, horizonMonths: spec.plan.horizonMonths,
    });
    if (!pr.ok) return toast(pr.error, 'err');
    const plan = App.db.plans[App.db.plans.length - 1];
    tag(plan);
    for (const act of spec.plan.activities) {
      const ar = App.engine.createActivity(App.db, {
        title: act.title, plan_ids: [plan.id], planned_date: act.planned_date,
        planned_minutes: act.planned_minutes, repeat: act.repeat, depth: act.depth,
      });
      if (ar.ok) created += 1; else toast(ar.error, 'err');
    }
    App.refresh();
    return toast(`计划模板已应用，新增 ${created} 个活动`);
  }

  for (const g of spec.goals) {
    const gr = App.engine.createGoal(App.db, { title: g.title });
    if (!gr.ok) { toast(gr.error, 'err'); continue; }
    const goal = App.db.goals[App.db.goals.length - 1];
    tag(goal);
    for (const p of g.plans) {
      const pr = App.engine.createPlan(App.db, {
        goal_id: goal.id, title: p.title, budget: p.budget,
        priority: p.priority, horizonMonths: p.horizonMonths,
      });
      if (!pr.ok) { toast(pr.error, 'err'); continue; }
      const plan = App.db.plans[App.db.plans.length - 1];
      tag(plan);
      for (const act of p.activities) {
        const ar = App.engine.createActivity(App.db, {
          title: act.title, plan_ids: [plan.id], planned_date: act.planned_date,
          planned_minutes: act.planned_minutes, repeat: act.repeat, depth: act.depth,
        });
        if (ar.ok) created += 1;
        else toast(ar.error, 'err');
      }
    }
  }
  App.refresh();
  toast(staged ? `阶段 ${stage} 已落地，新增 ${created} 个活动` : `模板已应用，新增 ${created} 个活动`);
}

export function openTemplateSave() {
  const goals = (App.db.goals || []).filter((g) => g.status !== 'Archived' && g.status !== 'Completed');
  const plans = (App.db.plans || []).filter((p) => p.status !== 'Archived' && p.status !== 'Completed');
  if (!goals.length && !plans.length) return toast('当前没有可保存的目标 / 计划', 'warn');
  const goalName = (gid) => (App.db.goals.find((g) => g.id === gid) || {}).title || '';
  const m = openModal({
    title: '保存为模板（目标级 / 计划级）',
    bodyHTML: `
      <div class="grid2">
        <div class="field"><label>保存范围</label><select id="f-tplscope">
          <option value="goal">目标级（含计划与活动）</option>
          <option value="plan">计划级（含活动）</option>
        </select></div>
        <div class="field"><label>选择对象</label><select id="f-tpltarget"></select></div>
      </div>
      <div class="field"><label>模板名称</label><input id="f-tplname" placeholder="不填则用对象名称" maxlength="40"></div>
      <p class="muted" style="font-size:12px">只保存所选对象及其下级，不会打包整个结构；预算按现值保存。</p>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>保存</button>`,
  });
  const fill = () => {
    const scope = m.q('#f-tplscope').value;
    const list = scope === 'goal' ? goals : plans;
    m.q('#f-tpltarget').innerHTML = list.length
      ? list.map((x) => `<option value="${esc(x.id)}">${esc(scope === 'plan' ? `${goalName(x.goal_id)} / ${x.title}` : x.title)}</option>`).join('')
      : '<option value="">（无可选对象）</option>';
    m.q('#f-tplname').value = list[0] ? list[0].title : '';
  };
  m.q('#f-tplscope').onchange = fill;
  fill();
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const scope = m.q('#f-tplscope').value;
    const targetId = m.q('#f-tpltarget').value;
    const name = (m.q('#f-tplname').value || '').trim();
    if (!targetId) return toast('没有可保存的对象', 'warn');
    const t = scope === 'goal'
      ? extractGoalTemplate(App.db, targetId, name)
      : extractPlanTemplate(App.db, targetId, name);
    if (!t) return toast(scope === 'goal' ? '该目标下没有计划，无法保存为目标模板' : '计划不存在', 'warn');
    t.id = `tpl_${Date.now().toString(36)}`;
    App.db.templates.push(t);
    m.close();
    tplFilter = '全部';
    App.refresh(); toast(`已保存${t.kind === 'plan' ? '计划' : '目标'}模板「${t.name}」`);
  };
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) { /* 回退到 execCommand */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

// ? 提示窗：展示模板提示词并自动复制，用户拿去和模型多轮对话
export async function openTemplatePrompt() {
  const m = openModal({
    title: '模板提示词（打开即自动复制）',
    width: 720,
    bodyHTML: `
      <p class="muted" style="font-size:12px;margin-bottom:8px">把它发给模型，多轮问答后让它输出 Markdown 模板；再回到「⇩ 导入 MD」粘贴。</p>
      <textarea id="tpl-prompt" class="ledger-cmd" rows="16" readonly>${esc(TEMPLATE_PROMPT)}</textarea>`,
    footerHTML: `<button class="btn" data-copy>再复制</button><button class="btn primary" data-close>知道了</button>`,
  });
  const ta = m.q('#tpl-prompt');
  const copy = async () => {
    ta.focus();
    ta.select();
    const ok = await copyText(TEMPLATE_PROMPT);
    toast(ok ? '提示词已复制，去和模型对话吧' : '复制失败，请手动全选复制', ok ? 'ok' : 'warn');
  };
  m.q('[data-copy]').onclick = copy;
  m.q('[data-close]').onclick = () => m.close();
  await copy();
}

// 导入手写 / 模型产出的 MD 模板（支持多文件、一个文件多模板）
export function openTemplateImport() {
  const m = openModal({
    title: '导入 MD 模板（多文件 / 多模板）',
    width: 720,
    bodyHTML: `
      <p class="muted" style="font-size:12px;margin-bottom:8px">每个模板以一级标题 <code># 模板名</code> 开始；每个文件独立解析，一个文件可含多个模板。可多选文件，也可粘贴。点「?」复制提示词。</p>
      <div class="row-gap" style="margin-bottom:6px">
        <label class="btn sm">📄 选择 .md 文件（可多选）
          <input id="tpl-md-file" type="file" accept=".md,.markdown,text/markdown" multiple hidden>
        </label>
        <span id="tpl-md-fileinfo" class="muted" style="font-size:11px"></span>
      </div>
      <div id="tpl-filelist" class="tpl-filelist"></div>
      <textarea id="tpl-md" class="ledger-cmd" rows="12" placeholder="${esc(TEMPLATE_MD_SCHEMA)}" spellcheck="false"></textarea>
      <div id="tpl-md-preview" class="muted" style="font-size:12px;margin-top:6px"></div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn" data-save>仅保存</button><button class="btn primary" data-apply>保存并应用阶段 1</button>`,
  });
  const ta = m.q('#tpl-md');
  const fileInput = m.q('#tpl-md-file');
  const fileInfo = m.q('#tpl-md-fileinfo');
  const picked = []; // 每个文件独立解析，不把多个文件拼成一段

  const parseAll = () => {
    const items = [];
    for (const f of picked) {
      for (const r of parseTemplateFile(f.name, f.text)) items.push({ ...r, source: f.name });
    }
    if (ta.value.trim()) {
      for (const r of parseTemplateFile('粘贴内容.md', ta.value)) items.push({ ...r, source: '粘贴内容' });
    }
    return items;
  };

  const preview = () => {
    const box = m.q('#tpl-md-preview');
    const items = parseAll();
    if (!items.length) { box.textContent = ''; return; }
    const bad = items.findIndex((r) => r.errors.length);
    if (bad >= 0) {
      const r = items[bad];
      box.innerHTML = `<span style="color:var(--red)">${esc(r.source)} · 模板 ${bad + 1}：${esc(r.errors[0])}</span>`;
      return;
    }
    const sum = items.reduce((acc, r) => ({
      stages: acc.stages + r.stats.stages,
      goals: acc.goals + r.stats.goals,
      plans: acc.plans + r.stats.plans,
      activities: acc.activities + r.stats.activities,
    }), { stages: 0, goals: 0, plans: 0, activities: 0 });
    box.textContent = `${items.length} 个模板 · ${sum.stages} 阶段 · ${sum.goals} 目标 · ${sum.plans} 计划 · ${sum.activities} 活动`;
  };

  const renderFiles = () => {
    const box = m.q('#tpl-filelist');
    box.innerHTML = picked.map((f, i) => {
      const rs = parseTemplateFile(f.name, f.text);
      const bad = rs.find((r) => r.errors.length);
      const acts = rs.reduce((s, r) => s + r.stats.activities, 0);
      const label = bad ? `错误：${bad.errors[0]}` : `${rs.length} 模板 · ${acts} 活动`;
      return `<div class="tpl-file"><span>${esc(f.name)} · ${esc(label)}</span><button class="btn sm" data-rm="${i}">移除</button></div>`;
    }).join('');
    fileInfo.textContent = picked.length ? `已选 ${picked.length} 个文件` : '';
    box.querySelectorAll('[data-rm]').forEach((b) => {
      b.onclick = () => {
        picked.splice(Number(b.dataset.rm), 1);
        renderFiles();
        preview();
      };
    });
  };

  ta.addEventListener('input', preview);
  const readFile = (f) => new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => resolve('');
    r.readAsText(f);
  });
  fileInput.onchange = async () => {
    const files = [...(fileInput.files || [])];
    if (!files.length) return;
    for (const f of files) {
      if (f.size > 1000000) { toast(`${f.name} 超过 1MB，已跳过`, 'warn'); continue; }
      if (picked.some((x) => x.name === f.name)) continue;
      const text = await readFile(f);
      if (text.trim()) picked.push({ name: f.name, text });
    }
    fileInput.value = ''; // 允许再次选择同名文件
    renderFiles();
    preview();
  };
  renderFiles();

  const save = (apply) => {
    const items = parseAll();
    if (!items.length) return toast('至少导入一个模板（选择文件或粘贴 MD）', 'err');
    const valid = items.filter((r) => !r.errors.length && r.stats.plans);
    if (!valid.length) return toast(items[0].errors[0] || '没有可导入的模板', 'err');
    const stamp = Date.now().toString(36);
    valid.forEach((r, i) => {
      const t = r.template;
      let name = t.name;
      let n = 2;
      while (App.db.templates.some((x) => x.name === name)) name = `${t.name} (${n++})`;
      t.name = name;
      t.id = `tpl_${stamp}_${i}`;
      App.db.templates.push(t);
    });
    const skipped = items.length - valid.length;
    m.close();
    tplFilter = '全部';
    App.refresh();
    toast(`已导入 ${valid.length} 个模板${skipped ? `，跳过 ${skipped} 个` : ''}`);
    if (apply) {
      if (valid.length === 1) applyTemplate(valid[0].template.id);
      else toast('批量导入请逐个应用阶段', 'info');
    }
  };
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => save(false);
  m.q('[data-apply]').onclick = () => save(true);
}

function downloadMD(filename, text) {
  try {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  } catch (e) {
    return false;
  }
}

function openTemplateExport(title, md, filename) {
  const m = openModal({
    title,
    width: 720,
    bodyHTML: `
      <p class="muted" style="font-size:12px;margin-bottom:8px">可直接复制，或下载为 .md 文件（Android WebView 若无法下载，用复制）。</p>
      <textarea id="tpl-export" class="ledger-cmd" rows="16" readonly>${esc(md)}</textarea>`,
    footerHTML: `<button class="btn" data-copy>复制</button><button class="btn primary" data-download>下载 .md</button>`,
  });
  const ta = m.q('#tpl-export');
  ta.focus();
  ta.select();
  m.q('[data-copy]').onclick = async () => {
    const ok = await copyText(md);
    toast(ok ? 'MD 已复制' : '复制失败，请手动全选复制', ok ? 'ok' : 'warn');
  };
  m.q('[data-download]').onclick = () => {
    const ok = downloadMD(filename, md);
    toast(ok ? '已生成 .md 文件' : '下载失败，请用复制', ok ? 'ok' : 'warn');
  };
}

const safeFileName = (s) => String(s || 'template').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);

export function exportTemplate(tplId) {
  const tpl = [...BUILTIN_TEMPLATES, ...(App.db.templates || [])].find((t) => t.id === tplId);
  if (!tpl) return toast('模板不存在', 'err');
  openTemplateExport(`导出模板：${tpl.name}`, serializeTemplateMD(tpl), `${safeFileName(tpl.name)}.md`);
}

export function exportAllTemplates() {
  const all = [...BUILTIN_TEMPLATES, ...(App.db.templates || [])];
  if (!all.length) return toast('没有可导出的模板', 'warn');
  openTemplateExport('导出全部模板', serializeTemplatesMD(all), 'templates.md');
}

export async function deleteTemplate(tplId) {
  const t = (App.db.templates || []).find((x) => x.id === tplId);
  if (!t) return;
  if (!(await App.system.confirm({ title: '删除模板', message: `删除「${t.name}」？` }))) return;
  App.db.templates = App.db.templates.filter((x) => x.id !== tplId);
  App.refresh(); toast('模板已删除');
}

// 模板结构预览（与 MD 编辑双向联动）
function structureHTML(tpl) {
  const staged = Array.isArray(tpl.stages) && tpl.stages.length > 0;
  const stages = staged
    ? tpl.stages
    : [{ name: '默认', share: 1, goals: tpl.kind === 'plan' && tpl.plan ? [{ title: tpl.plan.title, plans: [tpl.plan] }] : (tpl.goals || []) }];
  return stages.map((st, si) => {
    const goals = Array.isArray(st.goals) ? st.goals : (st.goal ? [st.goal] : []);
    return `
      <div class="tpl-view-stage">
        <div class="tpl-view-head">
          <b>阶段 ${si + 1} · ${esc(st.name || '阶段')}</b>
          <span class="tpl-cat">${Math.round((Number(st.share) || 0) * 100)}%</span>
        </div>
        ${goals.map((g) => `
          <div class="tpl-view-goal">
            <b>${esc(g.title)}</b>
            ${(g.plans || []).map((p) => `
              <div class="tpl-view-plan">
                <div class="tpl-view-plan-head">
                  <span>${esc(p.title)}</span>
                  <span class="tpl-stat muted">优先级 ${p.priority || 3} · 周期 ${p.horizonMonths || 3} 月 · ${p.budget !== null && p.budget !== undefined ? `预算 ${fmtNum(p.budget)}` : `权重 ${p.weight ?? 1}`}</span>
                </div>
                <ul>${(p.activities || []).map((a) => `<li>${esc(a.title)} <span class="muted">${a.minutes || 0} 分钟${a.repeat ? ` · ${esc(a.repeat)}` : ''}${a.depth === true ? ' · 深度' : ''}</span></li>`).join('')}</ul>
              </div>`).join('')}
          </div>`).join('')}
      </div>`;
  }).join('');
}

export function openTemplateView(tplId) {
  const tpl = [...BUILTIN_TEMPLATES, ...(App.db.templates || [])].find((t) => t.id === tplId);
  if (!tpl) return toast('模板不存在', 'err');
  const isBuiltin = !!tpl.builtin;
  const staged = Array.isArray(tpl.stages) && tpl.stages.length > 0;
  const nextStage = staged ? appliedStage(App.db, tpl.id) + 1 : 0;
  const full = staged && nextStage > tpl.stages.length;
  const applyLabel = full ? '已完成全部阶段' : (nextStage ? `应用阶段 ${nextStage}` : '应用');

  const m = openModal({
    title: `模板：${tpl.name}`,
    width: 760,
    bodyHTML: `
      <div class="muted" style="font-size:11px;margin-bottom:6px">点击卡片进入这里；改 MD 会实时重算上方结构。${isBuiltin ? '内置模板保存时会另存为自定义副本。' : ''}</div>
      <div id="tpl-view-structure" class="tpl-view-structure"></div>
      <div class="field" style="margin-top:10px"><label>MD 编辑（遵循同一 schema）</label>
        <textarea id="tpl-view-md" class="ledger-cmd" rows="14" spellcheck="false">${esc(serializeTemplateMD(tpl))}</textarea>
      </div>
      <div id="tpl-view-hint" class="muted" style="font-size:12px"></div>`,
    footerHTML: `<button class="btn" data-copy>复制 MD</button>
      ${isBuiltin ? '<button class="btn" data-fork>另存为副本</button>' : '<button class="btn primary" data-save>保存修改</button>'}
      <button class="btn primary" data-apply ${full ? 'disabled' : ''}>${applyLabel}</button>
      <button class="btn" data-close>关闭</button>`,
  });
  const ta = m.q('#tpl-view-md');
  const struct = m.q('#tpl-view-structure');
  const hint = m.q('#tpl-view-hint');
  struct.innerHTML = structureHTML(tpl);

  ta.addEventListener('input', () => {
    const { template, errors } = parseTemplateMD(ta.value);
    if (errors.length) {
      hint.innerHTML = `<span style="color:var(--red)">${esc(errors[0])}</span>`;
      return;
    }
    hint.textContent = '结构已同步';
    struct.innerHTML = structureHTML(template);
  });

  m.q('[data-copy]').onclick = async () => {
    const ok = await copyText(ta.value);
    toast(ok ? 'MD 已复制' : '复制失败，请手动全选复制', ok ? 'ok' : 'warn');
  };
  m.q('[data-close]').onclick = () => m.close();

  if (isBuiltin) {
    m.q('[data-fork]').onclick = () => {
      const { template, errors } = parseTemplateMD(ta.value);
      if (errors.length) return toast(errors[0], 'err');
      template.id = `tpl_${Date.now().toString(36)}`;
      template.builtin = false;
      template.imported = true;
      if (!template.name) template.name = `${tpl.name} 副本`;
      App.db.templates.push(template);
      m.close();
      tplFilter = '全部';
      App.refresh(); toast('已另存为自定义模板');
    };
  } else {
    m.q('[data-save]').onclick = async () => {
      const { template, errors } = parseTemplateMD(ta.value);
      if (errors.length) return toast(errors[0], 'err');
      if (appliedStage(App.db, tpl.id) > 0) {
        const ok = await App.system.confirm({ title: '保存模板修改', message: '已应用的阶段不会回滚；修改只影响之后的应用。继续？' });
        if (!ok) return;
      }
      const merged = mergeEditedTemplate(tpl, template);
      if (!merged) return toast('结构不完整，无法保存', 'err');
      Object.assign(tpl, merged);
      m.close(); App.refresh(); toast('模板已更新');
    };
  }

  if (!full) m.q('[data-apply]').onclick = () => { m.close(); applyTemplate(tpl.id); };
}

function renderCards(App) {
  const { db, engine } = App;
  const blocked = db.plans.filter((p) => engine.isPlanBlocked(db, p.id));
  const overdue = db.valueflows.filter((v) => engine.vfStatus(db, v) === 'Overdue');

  const cards = {
    templates: templatesCard(App),

    ledger: `
      <section class="card" data-card-id="ledger">
        <div class="card-head">
          <h3>🧮 记账器</h3>
          <div class="row-gap">
            <button class="btn sm" onclick="App.finance.openKeypad()" title="独立于系统键盘的记账键盘">🧮 键盘</button>
          </div>
        </div>
        <div class="card-body">
          <div class="row-gap" style="margin-bottom:8px;align-items:stretch">
            <textarea id="ledger-cmd" class="ledger-cmd" rows="1" placeholder="记账命令，每行一笔：-8 早餐 / +100 工资 / -5.5 咖啡 @灵感（Enter 入账，Shift+Enter 换行）" spellcheck="false"></textarea>
            <button class="btn primary" onclick="App.finance.runLedgerCommand()">入账</button>
          </div>
          <div class="muted" style="font-size:11px;margin-bottom:8px">语法：- 金额 备注 @资源名；- 支出、+ 收入；缺省资源 = 价值元/首个启用。</div>
          <div id="ledger-host">
            <button class="btn sm" onclick="App.finance.openLedger()">📒 打开文本账单（Vditor 镜像）</button>
          </div>
        </div>
      </section>`,

    resources: `
      <section class="card" data-card-id="resources">
        <div class="card-head">
          <h3>资源状态</h3>
          <div class="row-gap">
            <span class="muted">余额 = 初始 + Σ(debit−credit) · 不变量1</span>
            <button class="btn sm" onclick="App.finance.openResModal()">＋ 资源</button>
          </div>
        </div>
        <div class="card-body"><div class="res-grid">${db.resources.map((r) => resourceCard(App, r)).join('')}</div></div>
      </section>`,

    rules: `
      <section class="card" data-card-id="rules">
        <div class="card-head">
          <h3>兑换规则</h3>
          <button class="btn sm" onclick="App.finance.openRuleModal()">＋ 新增</button>
        </div>
        <div class="card-body">${db.rules.map((r) => ruleRow(App, r)).join('') || empty('暂无规则')}</div>
      </section>`,

    shop: `
      <section class="card" data-card-id="shop">
        <div class="card-head">
          <h3>🛍️ 商店 · 快速消费</h3>
          <div class="row-gap">
            <span class="muted">LifeUp 式一键消费 · 点击商品直接扣减余额</span>
            <button class="btn sm" onclick="App.finance.openGoodModal()">＋ 商品</button>
          </div>
        </div>
        <div class="card-body"><div class="goods-grid">${db.goods.map((g) => goodCard(App, g)).join('') || empty('暂无商品', '添加商品后即可一键快速消费')}</div></div>
      </section>`,

    valueflows: `
      <section class="card" data-card-id="valueflows">
        <div class="card-head"><h3>价值流</h3><span class="muted">产出归档自动生成 · Pending → Closed / Overdue</span></div>
        <div class="card-body">${db.valueflows.map((v) => vfRow(App, v)).join('') || empty('暂无价值流', '产出「归档」后自动生成')}</div>
      </section>`,

    feedback: `
      <section class="card" data-card-id="feedback">
        <div class="card-head"><h3>系统反馈</h3></div>
        <div class="card-body">
          ${blocked.length ? blocked.map((p) => `
            <div class="fb warn"><b>⛔ 预算硬约束（不变量4）</b><p>「${esc(p.title)}」已耗 ${fmtNum(engine.planCost(db, p.id))}/${fmtNum(p.budget)}，新活动禁止开始/完成。</p></div>`).join('') : ''}
          ${overdue.length ? `<div class="fb warn"><b>⏰ 价值流逾期（16C）</b><p>${overdue.length} 条待补录反馈，可手动闭环。</p></div>` : ''}
          ${!blocked.length && !overdue.length ? '<div class="fb ok"><b>✓ 全部不变量满足</b><p>同惠链路正常，账目自洽。</p></div>' : ''}
        </div>
      </section>`,

    flow: flowSection(App),
  };

  return loadCardOrder().map((id) => cards[id] || '').join('');
}

// ---------------- 主渲染：记账器 / 资源状态 / 兑换规则 / 商店 / 价值流 / 系统反馈 ----------------
export function render(App, el) {
  // 本次 render 会重建 #ledger-host（el.innerHTML 覆盖），文本账单实例随之销毁；
  // 必须重置 mounted 标志，否则入账 refresh 后 openLedger 误走 reload 分支（Vditor 已不在）而打不开。
  ledgerMounted = false;

  el.innerHTML = `<div class="card-flow" id="finance-flow">
    <div class="card-flow-hint muted">长按卡片标题拖动排序</div>
    ${renderCards(App)}
  </div>`;
  setupCardDrag(el.querySelector('#finance-flow'));

  // 命令区交互：Enter = 入账，Shift+Enter = 换行（单行命令框 + 多行批量）
  const cmdEl = el.querySelector('#ledger-cmd');
  if (cmdEl) cmdEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runLedgerCommand(); }
  });
}

// ============================================================
// views/diary.js
// 「日记」Tab —— 资源与目标之间的第四视图。
// 设计依据 SPEC_diary.md v2：
//   · 一次只渲染一天（Vditor 单例常驻，切日只 setValue，不重建）
//   · 命令段位于 Markdown 代码块；叙述段永不参与解析
//   · 两阶段：编辑只落 journals[].md（不碰 db）；注入由显式按钮触发
//   · 幂等靠外部快照 parses[]（位置匹配），文本零标记
//   · 一次性单向门：已解析块不再注入，删除不回滚
// ============================================================
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import { Prefs } from '../store/prefs.js';
import { saveDB } from '../store/db.js';
import { esc, toast, openModal, fmtNum, badge } from '../ui/helpers.js';
import { icon } from '../ui/icons.js';
import {
  extractBlocks, diffBlocks, splitCommands, injectJournal, makeParseRecord,
  todayJournalKey, shiftJournalKey, parseJournalKey, dayKeyOf, fingerprint,
} from '../domain/journal.js';

let vd = null;        // Vditor 单例（页面存活期间不重建）
let curKey = null;    // 当前日期（YYYY-M-D）
let saveTimer = null; // 编辑防抖保存
let composing = false;
let CURRENT_APP = null;
let lastEl = null;        // 最近一次渲染的容器（桌面小组件点进来时要能直接切日）
let pendingFocus = false; // 从小组件进来：等编辑器就绪后聚焦
let docHideBound = false; // 切后台落库+推给小组件的监听只绑一次
const BAR_SPAN = 3;   // 日期条以当前日为中心，前后各展开的天数

// 键规范化：统一为 YYYY-M-D（不补零），与 mdviews.dkey 同格式
function normKey(k) {
  const s = String(k || '').split('T')[0];
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return `${y}-${m}-${d}`;
}
const WD = ['日', '一', '二', '三', '四', '五', '六'];
function weekdayOf(k) { return WD[parseJournalKey(k).getDay()]; }

// 取（或建）某日日记
function ensureJournal(db, key) {
  let j = db.journals.find((x) => normKey(x.date) === key);
  if (!j) {
    j = { id: 'j' + (++db.seq.j), date: key, md: '', parses: [] };
    db.journals.push(j);
  }
  if (!Array.isArray(j.parses)) j.parses = [];
  return j;
}
function getJournal(db, key) { return db.journals.find((x) => normKey(x.date) === key) || null; }
function lastParseOf(j) { return j && j.parses && j.parses.length ? j.parses[j.parses.length - 1] : null; }

// ---------------- 页面渲染 ----------------

export function render(App, el) {
  CURRENT_APP = App;
  lastEl = el;
  const db = App.db;
  if (!db.journals) db.journals = [];
  if (curKey === null) curKey = todayJournalKey();

  if (vd) { try { vd.destroy(); } catch (e) { /* 旧实例销毁异常忽略 */ } vd = null; }
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  composing = false;

  el.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>${icon('book')} 日记</h3>
        <div class="row-gap">
          <button class="btn sm" data-diary-prompt title="复制提示词：先和模型聊清规划，再把输出的命令块粘回来直接加活动">?</button>
          <button class="btn sm" data-diary-full title="全屏编辑（Esc 退出）">${icon('expand')} 全屏</button>
          <button class="btn sm" data-diary-today title="回到今天">今天</button>
          <button class="btn sm" data-diary-cal title="选择日期">${icon('calendar')} 月历</button>
        </div>
      </div>
      <div class="diary-bar" data-diary-bar></div>
      <div class="diary-dayline">
        <b data-diary-title></b>
      </div>
      <div class="diary-editor"><div id="diary-vditor"></div></div>
      <div class="diary-actions">
        <button class="btn primary" data-diary-parse>${icon('search')} 解析并注入</button>
        <button class="btn" data-diary-block title="在末尾插入一个空命令块">${icon('plus')} 命令块</button>
        <span class="muted" data-diary-status></span>
      </div>
      <div class="diary-ledger" data-diary-ledger></div>
    </div>`;

  buildDateBar(App, el);
  buildVditor(App, el);
  if (pendingFocus) { pendingFocus = false; setTimeout(() => focusEditor(), 200); }
  refreshStatus(App, el);
  renderLedger(App, el);

  el.querySelector('[data-diary-today]').onclick = () => switchDay(App, el, todayJournalKey());
  el.querySelector('[data-diary-cal]').onclick = () => openMonthPicker(App, el);
  el.querySelector('[data-diary-parse]').onclick = () => openParseModal(App, el);
  el.querySelector('[data-diary-prompt]').onclick = () => openPlanPromptModal(App, el);
  // 一键插入命令块：移动端手打 ``` 很麻烦，这里直接补好一对围栏
  el.querySelector('[data-diary-block]').onclick = () => {
    if (!vd) return toast('编辑器还没就绪', 'warn');
    let cur = '';
    try { cur = vd.getValue() || ''; } catch (e) { return toast('插入失败', 'err'); }
    const sep = !cur ? '' : (cur.endsWith('\n') ? '\n' : '\n\n');
    try { vd.setValue(cur + sep + '```\n\n```\n'); } catch (e) { return toast('插入失败', 'err'); }
    saveCurrent(App, el);
    // 把光标送进块内空行：否则用户在围栏那行打字会被 Vditor 当成语言标记
    setTimeout(() => {
      try {
        const area = document.getElementById('diary-vditor');
        const codes = area ? area.querySelectorAll('pre.vditor-wysiwyg__pre code') : [];
        const last = codes[codes.length - 1];
        if (last) {
          const range = document.createRange();
          range.selectNodeContents(last);
          range.collapse(true);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } catch (e) { /* 定位失败不影响插入 */ }
    }, 80);
    refreshStatus(App, el);
    toast('已插入命令块 — 请在上下的 \`\`\` 之间写命令', 'ok');
  };

  // —— 全屏编辑（复用 workspace 的 .card.ws-full：卡片铺满视口）——
  let full = false;
  const card = el.querySelector('.card');
  const fitFull = () => {
    const wrap = document.getElementById('diary-vditor');
    if (!full || !card || !wrap) return;
    const chrome = (card.querySelector('.card-head')?.offsetHeight || 0)
      + (card.querySelector('.diary-bar')?.offsetHeight || 0)
      + (card.querySelector('.diary-dayline')?.offsetHeight || 0)
      + (card.querySelector('.diary-actions')?.offsetHeight || 0) + 44; // 卡片内边距 + 余量
    wrap.style.height = Math.max(220, window.innerHeight - chrome) + 'px';
  };
  const setFull = (on) => {
    full = on;
    if (!card) return;
    // 必须 reparent 到 body：祖先 .dash-track 的 transform 会劫持 fixed 包含块
    if (on && card.parentElement !== document.body) document.body.appendChild(card);
    if (!on && card.parentElement !== el) el.appendChild(card);
    card.classList.toggle('ws-full', on);
    document.body.classList.toggle('ws-lock', on);
    const btn = el.querySelector('[data-diary-full]');
    if (btn) btn.innerHTML = on ? `${icon('expand')} 退出全屏` : `${icon('expand')} 全屏`;
    const wrap = document.getElementById('diary-vditor');
    if (on) {
      setTimeout(fitFull, 60);
      window.addEventListener('resize', fitFull);
    } else {
      window.removeEventListener('resize', fitFull);
      if (wrap) wrap.style.height = '360px';
    }
  };
  el.querySelector('[data-diary-full]').onclick = () => setFull(!full);
  if (typeof window !== 'undefined') window.__diaryExitFull = () => setFull(false);

  // 切后台：先落库，再把 db 推给原生——日记只写 localStorage，
  // 不推的话桌面日记组件会一直停在旧内容（直到下次 App 渲染/回前台）。
  if (!docHideBound && typeof document !== 'undefined') {
    docHideBound = true;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden || !CURRENT_APP) return;
      try { saveCurrent(CURRENT_APP, lastEl); } catch (e) { /* 忽略 */ }
      try { CURRENT_APP.widget && CURRENT_APP.widget.refreshNative(); } catch (e) { /* 忽略 */ }
    });
  }
}

// 日期条：以当前日为中心展开 BAR_SPAN 天；有内容打点；今天高亮
function buildDateBar(App, el) {
  const host = el.querySelector('[data-diary-bar]');
  if (!host) return;
  const db = App.db;
  const keys = [];
  for (let i = -BAR_SPAN; i <= BAR_SPAN; i++) keys.push(shiftJournalKey(curKey, i));
  const today = todayJournalKey();
  host.innerHTML = `
    <button class="btn sm diary-nav" data-nav="prev" title="前一天">${icon('arrow-left')}</button>
    <div class="diary-days">
      ${keys.map((k) => {
        const j = getJournal(db, k);
        const has = !!(j && String(j.md || '').trim());
        const cls = [
          'diary-day',
          k === curKey ? 'on' : '',
          k === today ? 'today' : '',
          has ? 'has' : '',
        ].filter(Boolean).join(' ');
        const [, m, d] = k.split('-');
        return `<button class="${cls}" data-k="${k}" title="${k} 周${weekdayOf(k)}${has ? ' · 有记录' : ''}">
          <span class="dw">周${weekdayOf(k)}</span>
          <span class="dd">${m}/${d}</span>
          ${has ? '<i class="dot"></i>' : ''}
        </button>`;
      }).join('')}
    </div>
    <button class="btn sm diary-nav" data-nav="next" title="后一天">${icon('arrow-right')}</button>`;
  host.querySelectorAll('[data-k]').forEach((b) => {
    b.onclick = () => switchDay(App, el, b.dataset.k);
  });
  host.querySelector('[data-nav="prev"]').onclick = () => switchDay(App, el, shiftJournalKey(curKey, -1));
  host.querySelector('[data-nav="next"]').onclick = () => switchDay(App, el, shiftJournalKey(curKey, 1));
}

// Vditor：单例。首次创建；已存在则只换内容
function buildVditor(App, el) {
  const prefs = Prefs.load();
  const darkNow = prefs.nightTheme === 'dark'
    || (prefs.nightTheme !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const initialMd = (getJournal(App.db, curKey) || {}).md || '';
  vd = new Vditor('diary-vditor', {
    mode: 'wysiwyg',
    height: 360,
    cache: { enable: false },
    sanitize: false,
    theme: darkNow ? 'dark' : 'classic',
    value: initialMd,
    placeholder: '记点什么…（要记账或建活动，就写在代码块里）',
    toolbar: ['headings', 'bold', 'italic', 'strike', '|', 'list', 'ordered-list', 'check', 'quote', 'inline-code', 'code', '|', 'undo', 'redo'],
    input: () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { if (!composing) saveCurrent(App, el); }, 800);
    },
    blur: () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } saveCurrent(App, el); },
    after: () => setTimeout(() => saveCurrent(App, el), 80),
  });
  // IME 组合输入期间不保存（防止半成品落库）
  const box = document.getElementById('diary-vditor');
  if (box) {
    box.addEventListener('compositionstart', () => { composing = true; });
    box.addEventListener('compositionend', () => { composing = false; });
  }
  // 夜间模式即时跟随：切主题时无需重建编辑器（与 workspace 同一判据：dark 强制 / auto 跟随系统）
  // ★ 必须挂全局钩子而非只在创建时判一次——否则切主题后编辑器保持旧配色，与页面黑白色调割裂。
  if (typeof window !== 'undefined') {
    window.__diaryVd = vd; // 调试钩子
    window.__diaryApplyTheme = (dark) => {
      try { if (vd && vd.setTheme) vd.setTheme(dark ? 'dark' : 'classic'); } catch (e) { /* 忽略 */ }
    };
  }
}

// 保存当前编辑器内容到 journals[].md（纯文本，不碰任何实体）
function saveCurrent(App, el) {
  if (!vd) return;
  let text = '';
  try { text = vd.getValue() || ''; } catch (e) { return; }
  const j = ensureJournal(App.db, curKey);
  if (j.md === text) return;
  j.md = text;
  saveDB(App.db);
  refreshStatus(App, el);
  // 有内容打点要靠日期条重绘
  const host = el && el.querySelector('[data-diary-bar]');
  if (host) buildDateBar(App, el);
}

// 切日期：只换内容，不重建 Vditor
function switchDay(App, el, key) {
  const k = normKey(key);
  if (!k || k === curKey) return;
  saveCurrent(App, el); // 先落库当前日
  curKey = k;
  const md = (getJournal(App.db, k) || {}).md || '';
  try { if (vd) vd.setValue(md); } catch (e) { /* 忽略 */ }
  buildDateBar(App, el);
  refreshStatus(App, el);
  renderLedger(App, el);
  const t = el.querySelector('[data-diary-title]');
  if (t) t.textContent = `${curKey} 周${weekdayOf(curKey)}`;
}

// ---------------- 规划提示词（? 按钮）：先和模型聊清，再落地 ----------------

const FENCE = '```';

// 语法与 journal.splitCommands 严格对齐：`- [ ] 标题 @ 09:00 60分钟 (计划名) #标签 ；备注`
function diaryPrompt(dateKey) {
  return [
    '你是我的「一天执行规划」助手。先不要给方案，用多轮对话把下面几件事问清楚（每轮只问 1-3 个问题）：',
    '1) 今天 / 这周真正要推进的一件事是什么？',
    '2) 每天能拿出多少分钟、集中在哪些时段？',
    '3) 有哪些硬约束（上课 / 上班 / 会议 / 通勤 / 睡眠）？',
    '4) 这次的安排属于已有目标 / 计划里的哪一个？',
    '5) 截止时间是什么时候、做到什么程度算完成？',
    '',
    `当前日记日期：${dateKey}（时区 Asia/Shanghai）。`,
    '信息够了以后，只输出一个 Markdown 代码块（用 ' + FENCE + ' 包住），每行一条：',
    '- [ ] 活动标题 @ 09:00 60分钟 (计划名) #标签 ；备注',
    '',
    '规则：',
    '- 每行一条活动，以 `- [ ]` 开头；已完成的写 `- [x]`。',
    '- `@` 后写开始钟点（24 小时制），紧跟时长，如 `@ 09:00 60分钟`；时长也接受 `1.5小时`。',
    '- 没有确定时间就省略 `@`（这条归到当天）；只有时长可写成行尾 `40分钟`。',
    '- `(计划名)`、`#标签`、`；备注` 都可以省略；不要编造不存在的计划名。',
    '- 一次给 3-6 条，总时长不超过可投入时间的 80%，留出缓冲。',
    '- 不要解释、不要多个代码块、不要用 # / ## 标题。',
    '',
    '例：',
    FENCE,
    '- [ ] 写周报 @ 09:00 45分钟 (运营) ；只写结论和下一步',
    '- [ ] 处理邮件 @ 10:00 30分钟',
    '- [ ] 复盘昨天的实验数据 40分钟',
    FENCE,
  ].join('\n');
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* 回退 execCommand */ }
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
  } catch (e) { return false; }
}

// 模型输出可能整段包在 ``` 里：取围栏内的正文；没有围栏就原样用
function takeCommandBody(text) {
  const src = String(text || '');
  const re = /^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```[^\n]*$/gm;
  const bodies = [];
  let m;
  while ((m = re.exec(src))) bodies.push(m[1]);
  return (bodies.length ? bodies.join('\n') : src).trim();
}

function openPlanPromptModal(App, el) {
  const prompt = diaryPrompt(curKey);
  const m = openModal({
    title: '🧠 规划提示词：先聊清楚，再排活动',
    width: 720,
    bodyHTML: `
      <p class="muted" style="font-size:12px">打开时已自动复制提示词。先和模型多轮把规划定下来，它最后只给一段 ${FENCE} 代码块；粘到下面就直接加进「${esc(curKey)}」这一天。</p>
      <div class="field"><label>提示词</label><textarea id="dp-prompt" class="ledger-cmd" rows="10" readonly spellcheck="false"></textarea></div>
      <div class="field" style="margin-top:8px"><label>模型输出的命令块</label><textarea id="dp-paste" class="ledger-cmd" rows="6" spellcheck="false" placeholder="- [ ] 写周报 @ 09:00 45分钟 (运营)"></textarea></div>
      <p class="muted" style="font-size:11px">语法与「🔍 解析并注入」完全一致：<code>- [ ] 活动</code>、<code>@ 09:00 60分钟</code> 排时间、<code>(计划名)</code> 归属、<code>+100 工资</code> 记流水。</p>`,
    footerHTML: `<button class="btn" data-copy>复制提示词</button><button class="btn" data-cancel>取消</button><button class="btn primary" data-ok>解析并注入</button>`,
  });
  m.q('#dp-prompt').value = prompt;
  copyText(prompt).then((ok) => toast(ok ? '提示词已复制，发给模型即可' : '自动复制失败，请手动复制', ok ? 'ok' : 'warn'));
  m.q('[data-copy]').onclick = async () => {
    const ok = await copyText(prompt);
    toast(ok ? '提示词已复制' : '复制失败，请手动全选复制', ok ? 'ok' : 'warn');
  };
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-ok]').onclick = () => {
    const body = takeCommandBody(m.q('#dp-paste').value);
    if (!body) return toast('先把模型给的命令块粘进来', 'warn');
    const parsed = splitCommands(App.db, body, { dateKey: curKey });
    if (!parsed.activities.length && !parsed.txs.length) {
      return toast(parsed.warnings[0] || '没解析出可加的活动：每行要以 `- [ ] 标题` 开头', 'err');
    }
    // 先写进当天日记（留痕可回看），再走既有的「解析并注入」确认流程（幂等快照不破坏）
    const cur = ((vd ? vd.getValue() : (getJournal(App.db, curKey) || {}).md) || '');
    const block = `${FENCE}\n${body}\n${FENCE}`;
    const next = cur.trim() ? `${cur.replace(/\n+$/, '')}\n\n${block}\n` : `${block}\n`;
    try { if (vd) vd.setValue(next); } catch (e) { return toast('写入日记失败', 'err'); }
    saveCurrent(App, el);
    m.close();
    toast(`解析出 ${parsed.activities.length} 条活动 · ${parsed.txs.length} 笔流水，确认后注入`, 'info');
    openParseModal(App, el);
  };
}

// ---------------- 解析并注入（阶段 B） ----------------

// 收集本次待注入内容 + 快照裁决
function collect(App) {
  const db = App.db;
  const j = ensureJournal(db, curKey);
  const blocks = extractBlocks(j.md || '');
  const last = lastParseOf(j);
  const d = diffBlocks(blocks, last);
  const activities = [], txs = [], warnings = [];
  for (const b of d.fresh) {
    const r = splitCommands(db, b.body, { dateKey: curKey });
    activities.push(...r.activities);
    txs.push(...r.txs);
    warnings.push(...r.warnings);
  }
  return { j, blocks, last, diff: d, activities, txs, warnings };
}

function openParseModal(App, el) {
  saveCurrent(App, el);
  const { j, blocks, diff, activities, txs, warnings } = collect(App);

  if (!blocks.length) {
    const head = String(j.md || '').replace(/\n/g, '⏎').slice(0, 120);
    return toast(`没识别到代码块。当前文本开头：${head || '（空）'}`, 'warn');
  }
  if (!diff.fresh.length) {
    const extra = diff.rewritten.length ? `（${diff.rewritten.length} 个已解析块内容已变，按一次性注入规则不生效）` : '';
    return toast(`没有新块可注入${extra}`, 'info');
  }
  if (!activities.length && !txs.length) {
    return toast(`新块里没有可识别的命令${warnings.length ? `（${warnings.length} 条提示）` : ''}`, 'warn');
  }

  const actLines = activities.map((a) => {
    const st = a.status && a.status !== 'Planned' ? ` · ${a.status}` : '';
    const tm = a.planned_start ? ` · ${String(a.planned_start).split('T')[1] || ''}` : '';
    const mi = a.planned_minutes ? ` · ${a.planned_minutes}分钟` : '';
    return `<div class="diary-prev-row"><span class="tag">活动</span><b>${esc(a.title)}</b><span class="muted">${esc(tm + mi + st)}</span></div>`;
  }).join('');
  const txLines = txs.map((t) => {
    const r = App.db.resources.find((x) => x.id === t.resource_id);
    const sign = t.direction === 'credit' ? '−' : '+';
    return `<div class="diary-prev-row"><span class="tag">${t.direction === 'credit' ? '支出' : '收入'}</span><b>${sign}${fmtNum(t.amount)}</b><span class="muted">${esc(r ? r.name : '?')}${t.note ? ' · ' + esc(t.note) : ''}</span></div>`;
  }).join('');

  const m = openModal({
    title: '解析并注入',
    accent: 'info',
    width: 480,
    bodyHTML: `
      <div class="muted" style="margin-bottom:8px">本次将注入 <b>${diff.fresh.length}</b> 个新块的内容；已解析过的块不会再注入。</div>
      ${actLines}${txLines}
      ${warnings.length ? `<div class="fb warn" style="margin-top:8px"><b>${icon('warning')} ${warnings.length} 条提示</b>${warnings.slice(0, 5).map((w) => `<p>${esc(w)}</p>`).join('')}</div>` : ''}
      <div class="callout" style="margin-top:8px">注入是一次性的：之后修改这些块不会再影响账本。</div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-ok>确认注入</button>`,
  });

  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-ok]').onclick = () => {
    const r = injectJournal(App.db, App.engine, { activities, txs });
    if (!r.created.activities.length && !r.created.txs.length) {
      m.close();
      return toast(r.warnings[0] || '没有可注入的内容', 'warn');
    }
    // 追加解析记录：幂等的唯一依据
    j.parses.push(makeParseRecord(blocks, r.created));
    saveDB(App.db);
    m.close();
    const parts = [];
    if (r.created.activities.length) parts.push(`活动 ${r.created.activities.length}`);
    if (r.created.txs.length) parts.push(`流水 ${r.created.txs.length}`);
    toast(`已注入：${parts.join(' · ')}${r.warnings.length ? `（⚠ ${r.warnings.length}）` : ''}`, 'ok');
    refreshStatus(App, el);
    renderLedger(App, el);
    buildDateBar(App, el);
  };
}

// ---------------- 状态行 / 账本投影 ----------------

function refreshStatus(App, el) {
  const host = el && el.querySelector('[data-diary-status]');
  if (!host) return;
  const j = getJournal(App.db, curKey);
  const last = lastParseOf(j);
  const blocks = extractBlocks((j && j.md) || '');
  const d = diffBlocks(blocks, last);
  const raw = (j && j.md) || '';
  const parts = [];
  parts.push(`文本 ${raw.length} 字`);
  parts.push(`代码块 ${blocks.length} 个`);
  if (!blocks.length && raw.trim()) {
    // 诊断：没有块时给出形态线索，便于定位是「没写围栏」还是「Vditor 换了形态」
    if (/\`\`\`/.test(raw)) parts.push('⚠ 有围栏符号但未识别（可能未闭合）');
    else if (/<pre/i.test(raw)) parts.push('⚠ 只有 HTML pre，无围栏');
    else parts.push('⚠ 文本里没有代码块');
  }
  parts.push(`已解析 ${d.parsedCount}`);
  if (d.fresh.length) parts.push(`新块 ${d.fresh.length} 待注入`);
  if (d.rewritten.length) parts.push(`⚠ ${d.rewritten.length} 个已解析块被改写（不生效）`);
  if (last) parts.push(`上次注入 ${new Date(last.at).toLocaleString()}`);
  host.textContent = parts.join(' · ');
}

// 当天账本投影：只读；点击跳对应 Tab
function renderLedger(App, el) {
  const host = el && el.querySelector('[data-diary-ledger]');
  if (!host) return;
  const db = App.db;
  const acts = (db.activities || []).filter((a) => normKey(a.planned_date || String(a.planned_start || '').split('T')[0]) === curKey);
  const txs = (db.txs || []).filter((t) => normKey(dayKeyOf(new Date(t.created))) === curKey);

  const actRows = acts.map((a) => {
    const tm = a.planned_start ? String(a.planned_start).split('T')[1] || '' : '';
    const mark = a.status === 'Completed' || a.status === 'Reviewed' ? icon('check')
      : a.status === 'Failed' ? icon('close')
        : a.status === 'Started' ? icon('play') : icon('circle');
    return `<div class="diary-lrow" data-jump="overview"><span class="mk">${mark}</span><span class="tt">${esc(a.title)}</span><span class="tm">${esc(tm)}</span><span class="st">${esc(a.status)}</span></div>`;
  }).join('');

  const txRows = txs.map((t) => {
    const r = db.resources.find((x) => x.id === t.resource_id);
    const amt = t.debit > 0 ? t.debit : t.credit;
    const sign = t.debit > 0 ? '+' : '−';
    return `<div class="diary-lrow" data-jump="finance"><span class="mk">${sign}${fmtNum(amt)}</span><span class="tt">${esc(t.note || '')}</span><span class="st">${esc(r ? r.name : '?')}</span></div>`;
  }).join('');

  host.innerHTML = `
    <div class="diary-ledger-head">当天账本 <span class="muted">· 只读投影，点击前往对应页</span></div>
    ${actRows || txRows ? `${actRows}${txRows}` : '<div class="muted" style="padding:8px 0">当天还没有活动或流水</div>'}`;

  host.querySelectorAll('[data-jump]').forEach((r) => {
    r.onclick = () => App.setTab(r.dataset.jump);
  });
}

// ---------------- 月历浮层（远距跳转） ----------------

function openMonthPicker(App, el) {
  const base = parseJournalKey(curKey);
  let y = base.getFullYear(), mo = base.getMonth();
  const db = App.db;
  const m = openModal({
    title: '选择日期',
    accent: 'info',
    width: 340,
    bodyHTML: '<div data-cal-host></div>',
    footerHTML: '<button class="btn" data-cancel>关闭</button>',
  });
  const draw = () => {
    const host = m.q('[data-cal-host]');
    const first = new Date(y, mo, 1);
    const startDow = (first.getDay() + 6) % 7;
    const dim = new Date(y, mo + 1, 0).getDate();
    const today = todayJournalKey();
    let cells = '';
    for (let i = 0; i < startDow; i++) cells += '<div class="diary-cal-cell empty"></div>';
    for (let d = 1; d <= dim; d++) {
      const k = `${y}-${mo + 1}-${d}`;
      const j = getJournal(db, k);
      const has = !!(j && String(j.md || '').trim());
      const cls = ['diary-cal-cell', k === curKey ? 'on' : '', k === today ? 'today' : ''].filter(Boolean).join(' ');
      cells += `<button class="${cls}" data-k="${k}">${d}${has ? '<i class="dot"></i>' : ''}</button>`;
    }
    host.innerHTML = `
      <div class="diary-cal-nav">
        <button class="btn sm" data-mv="-1">${icon('arrow-left')}</button>
        <b>${y} 年 ${mo + 1} 月</b>
        <button class="btn sm" data-mv="1">${icon('arrow-right')}</button>
      </div>
      <div class="diary-cal-dow">${['一', '二', '三', '四', '五', '六', '日'].map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="diary-cal-grid">${cells}</div>`;
    host.querySelectorAll('[data-mv]').forEach((b) => {
      b.onclick = () => {
        mo += Number(b.dataset.mv);
        if (mo < 0) { mo = 11; y--; }
        if (mo > 11) { mo = 0; y++; }
        draw();
      };
    });
    host.querySelectorAll('[data-k]').forEach((b) => {
      b.onclick = () => { m.close(); switchDay(App, el, b.dataset.k); };
    });
  };
  draw();
  m.q('[data-cancel]').onclick = () => m.close();
}

// 供 App.render 在外部改库后调用（tab 缓存场景）
export function refresh() {
  if (typeof window === 'undefined') return;
  const host = document.querySelector('[data-diary-bar]');
  if (!host) return;
  const el = host.closest('.card') && host.closest('.card').parentElement;
  if (el && CURRENT_APP) {
    buildDateBar(CURRENT_APP, el);
    refreshStatus(CURRENT_APP, el);
    renderLedger(CURRENT_APP, el);
  }
}

// 桌面日记小组件点进来：定位到指定日期，并可要求直接进入编辑（聚焦编辑器）。
// 日记页是懒加载 + tab 缓存的，所以两种状态都要接住：
//   已挂载 → switchDay 立刻换内容；未挂载 → 记下 curKey，等 render 时用。
export function openAt(key, focus = false) {
  const k = normKey(key);
  if (k) {
    if (vd && CURRENT_APP && lastEl && lastEl.isConnected) switchDay(CURRENT_APP, lastEl, k);
    else curKey = k;
  }
  if (focus) {
    pendingFocus = true;
    // 已挂载时不会重建编辑器，补一次聚焦；首渲染由 render 里的 pendingFocus 处理
    setTimeout(() => { if (pendingFocus && vd) { pendingFocus = false; focusEditor(); } }, 400);
  }
}

export function focusEditor() {
  try { if (vd && vd.focus) vd.focus(); } catch (e) { /* 忽略 */ }
}
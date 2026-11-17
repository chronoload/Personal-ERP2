// ============================================================
// ui/agentModal.js
// Agent 的全部界面：对话模态 / 审批模态 / 历史管理 / 配置引导。
// 独立挂载在 #agent-root，不复用 openModal（那个是单模态，会互相顶掉）。
// ============================================================
import { esc, toast, renderMarkdown } from './helpers.js';
import {
  listSessions, messagesOf, getSession, updateSession, deleteSession,
  listProfiles, activeProfile, saveProfile, deleteProfile, setActiveProfile,
} from '../services/agent/store.js';
import { maskKey, decryptText } from '../services/agent/secret.js';
import { testConnection, isOpencode, isDeepSeek, PROVIDER_PRESETS, DEEPSEEK_MODELS, presetOf } from '../services/agent/llm.js';
import { readFiles, MAX_FILES, ACCEPT } from '../services/agent/attach.js';
import * as Agent from '../services/agent/runtime.js';

let root = null;
let panelOpen = false;
let approvalEl = null;
let bound = false;
let pendingAtts = [];   // 输入区里还没发出的附件
// 长对话渲染窗口：首屏只画最近 MSG_PAGE 条，往上点「加载更早」再补
const MSG_PAGE = 40;
let viewState = { sid: null, visible: MSG_PAGE };

function ensureRoot() {
  if (root && document.body.contains(root)) return root;
  root = document.getElementById('agent-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'agent-root';
    document.body.appendChild(root);
  }
  return root;
}

function bindOnce() {
  if (bound) return;
  bound = true;
  Agent.subscribe((type, payload) => {
    if (type === 'approval') {
      if (!panelOpen) openAgent();
      showApproval(payload);
      return;
    }
    if (type === 'approval-resolved') {
      hideApproval();
      return;
    }
    if (type === 'notice') {
      toast(payload.text, payload.level === 'warn' ? 'warn' : 'info');
      return;
    }
    if (type === 'need-config') {
      openConfig();
      return;
    }
    if (panelOpen && (type === 'message' || type === 'state' || type === 'session' || type === 'tool')) {
      renderChat();
    }
  });
}

export function openAgent() {
  ensureRoot();
  bindOnce();
  panelOpen = true;
  viewState = { sid: null, visible: MSG_PAGE };
  root.innerHTML = `
    <div class="agent-mask" data-agent-close-mask>
      <div class="agent-panel" role="dialog" aria-label="Agent">
        <div class="agent-head">
          <span class="agent-title">✦ Agent</span>
          <span class="agent-status" data-agent-status></span>
          <span class="agent-head-actions">
            <button class="btn sm" data-agent-history>历史</button>
            <button class="btn sm" data-agent-new>新对话</button>
            <button class="btn sm" data-agent-close>✕</button>
          </span>
        </div>
        <div class="agent-body" data-agent-body></div>
        <div class="agent-input">
          <div class="agent-atts" data-agent-atts></div>
          <div class="agent-input-row">
            <button class="btn sm agent-clip" data-agent-attach title="添加图片或文件（也可直接粘贴 / 拖进来）">＋</button>
            <textarea data-agent-text rows="2" placeholder="说点什么…（Enter 发送，Shift+Enter 换行）"></textarea>
            <button class="btn primary" data-agent-send>发送</button>
          </div>
          <input type="file" multiple hidden data-agent-file accept="${ACCEPT}">
        </div>
      </div>
    </div>`;
  panelOpen = true;
  pendingAtts = [];
  const mask = root.querySelector('[data-agent-close-mask]');
  root.querySelector('[data-agent-close]').onclick = () => closeAgent();
  mask.addEventListener('mousedown', (e) => { if (e.target === mask) closeAgent(); });
  root.querySelector('[data-agent-history]').onclick = () => openHistory();
  root.querySelector('[data-agent-new]').onclick = () => {
    pendingAtts = [];
    renderPending();
    Agent.startNewSession();
    renderChat();
  };
  const ta = root.querySelector('[data-agent-text]');
  const fileInput = root.querySelector('[data-agent-file]');
  const send = () => {
    const text = ta.value.trim();
    const atts = pendingAtts.slice();
    if (!text && !atts.length) return;
    if (Agent.isRunning()) { toast('上一轮还在跑，先等它结束或点停止', 'warn'); return; }
    ta.value = '';
    pendingAtts = [];
    renderPending();
    Agent.send(text, atts).then((r) => {
      if (r && r.ok) setTimeout(() => renderChat(true), 30);
    });
  };
  root.querySelector('[data-agent-attach]').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = '';
    await addFiles(files);
  };
  ta.addEventListener('paste', (e) => {
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  });
  // 拖拽：整个面板都能接，松手后直接进待发附件
  const panel = root.querySelector('.agent-panel');
  panel.addEventListener('dragover', (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    panel.classList.add('agent-drop');
  });
  panel.addEventListener('dragleave', (e) => {
    if (e.target === panel) panel.classList.remove('agent-drop');
  });
  panel.addEventListener('drop', (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();
    panel.classList.remove('agent-drop');
    addFiles(Array.from(e.dataTransfer.files));
  });
  root.querySelector('[data-agent-send]').onclick = send;
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  root.querySelector('[data-agent-body]').addEventListener('click', onBodyClick);
  renderPending();
  renderChat();
  if (!Agent.isConfigured()) openConfig();
  setTimeout(() => ta.focus(), 60);
  return { close: closeAgent };
}

/** 读取一批文件进待发区；超限与读取失败逐个提示，不阻塞其余文件 */
async function addFiles(files) {
  if (!files || !files.length) return;
  const room = MAX_FILES - pendingAtts.length;
  if (room <= 0) { toast(`一条消息最多 ${MAX_FILES} 个附件`, 'warn'); return; }
  const { attachments, problems } = await readFiles(files.slice(0, room));
  pendingAtts = pendingAtts.concat(attachments);
  problems.forEach((p) => toast(p, 'warn'));
  renderPending();
}

/** 待发附件条：图片显示缩略图，文件显示名字与大小 */
function renderPending() {
  if (!root) return;
  const wrap = root.querySelector('[data-agent-atts]');
  if (!wrap) return;
  wrap.classList.toggle('show', pendingAtts.length > 0);
  wrap.innerHTML = pendingAtts.map((a) => (a.kind === 'image' && a.dataUrl
    ? `<span class="agent-att" title="${esc(a.name)}"><img src="${a.dataUrl}" alt=""><button data-att-x="${esc(a.id)}" title="移除">✕</button></span>`
    : `<span class="agent-att file" title="${esc(a.name)}"><b>${esc(a.name)}</b><i>${esc(a.note || '')}</i><button data-att-x="${esc(a.id)}" title="移除">✕</button></span>`)).join('');
  wrap.querySelectorAll('[data-att-x]').forEach((b) => {
    b.onclick = () => {
      pendingAtts = pendingAtts.filter((x) => x.id !== b.dataset.attX);
      renderPending();
    };
  });
}

/** 点大图看一眼；再点关闭 */
function showImage(src) {
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'agent-imgmask';
  el.innerHTML = `<img src="${src}" alt="">`;
  el.onclick = () => el.remove();
  root.appendChild(el);
}

export function closeAgent() {
  panelOpen = false;
  if (root) root.innerHTML = '';
  hideApproval();
}

export function isOpen() { return panelOpen; }

function statusText(status) {
  return {
    idle: '', thinking: '思考中…', calling_tool: '调用工具…',
    awaiting_approval: '等待你确认', done: '本轮结束', failed: '出错', cancelled: '已停止',
  }[status] || '';
}

/** 用户消息：图片缩略图 + 文件条 + 正文（纯附件消息没有正文） */
function userBubbleHTML(m) {
  const list = (m.meta && Array.isArray(m.meta.attachments)) ? m.meta.attachments : [];
  const shots = list.filter((a) => a.kind === 'image' && a.dataUrl);
  const files = list.filter((a) => !(a.kind === 'image' && a.dataUrl));
  const shotsHTML = shots.length
    ? `<div class="agent-shots">${shots.map((a) => `<img class="agent-shot" src="${a.dataUrl}" alt="${esc(a.name)}" title="${esc(a.name)}">`).join('')}</div>` : '';
  const filesHTML = files.length
    ? `<div class="agent-fchips">${files.map((a) => `<span class="agent-fchip" title="${esc(a.name)}">${esc(a.name)}${a.note ? `<i>${esc(a.note)}</i>` : ''}</span>`).join('')}</div>` : '';
  return `<div class="agent-msg user"><div class="bubble">${shotsHTML}${filesHTML}${m.content ? `<div>${esc(m.content)}</div>` : ''}</div></div>`;
}

function renderChat(scrollBottom = false) {
  if (!panelOpen || !root) return;
  const body = root.querySelector('[data-agent-body]');
  const status = root.querySelector('[data-agent-status]');
  if (!body) return;
  const sid = Agent.currentSessionId();
  const session = sid ? getSession(window.App.db, sid) : null;
  if (status) status.textContent = session ? statusText(session.status) : '';
  if (!sid) {
    viewState = { sid: null, visible: MSG_PAGE };
    delete body.dataset.renderKey;
    body.innerHTML = `
      <div class="agent-empty">
        <p>问点什么，或者让它帮你排今天。</p>
        <div class="row-gap">
          <button class="btn sm" data-agent-quick="今天该做什么？先看我今天与昨天的日记，再给 3 件事。">今天该做什么</button>
          <button class="btn sm" data-agent-quick="帮我复盘这周：对照目标与计划，指出偏差。">这周复盘</button>
          <button class="btn sm" data-agent-quick="我刚刚花了一笔钱，帮我记一笔。">记一笔</button>
        </div>
      </div>`;
    return;
  }
  if (viewState.sid !== sid) viewState = { sid, visible: MSG_PAGE };
  const msgs = messagesOf(window.App.db, sid);
  const start = Math.max(0, msgs.length - viewState.visible);
  const visible = msgs.slice(start);
  // 只画最近一屏；消息没变（状态/工具事件）就不重建 DOM
  const key = `${sid}:${visible.map((m) => m.id).join(',')}`;
  if (body.dataset.renderKey === key) {
    if (scrollBottom) body.scrollTop = body.scrollHeight;
    return;
  }
  const fromBottom = body.scrollHeight - body.scrollTop;
  const rows = visible.map((m) => {
    if (m.role === 'user') return userBubbleHTML(m);
    if (m.role === 'tool') {
      const ok = m.meta && m.meta.ok;
      const undo = m.meta && m.meta.undoId && m.toolCallId
        ? `<button class="agent-undo" data-agent-undo="${esc(m.toolCallId)}">撤销</button>` : '';
      return `<div class="agent-tool ${ok ? '' : 'err'}">${esc(m.content)}${undo}</div>`;
    }
    return `<div class="agent-msg assistant"><div class="bubble md">${renderMarkdown(m.content)}</div></div>`;
  }).join('');
  const more = start > 0
    ? `<div class="agent-more"><button class="btn sm" data-agent-more>加载更早（还有 ${start} 条）</button></div>` : '';
  body.innerHTML = more + (rows || '<div class="agent-empty"><p>开始说吧。</p></div>');
  body.dataset.renderKey = key;
  if (scrollBottom || fromBottom < 40) body.scrollTop = body.scrollHeight;
  else body.scrollTop = Math.max(0, body.scrollHeight - fromBottom);
}

function onBodyClick(e) {
  const shot = e.target.closest('.agent-shot');
  if (shot) { showImage(shot.getAttribute('src')); return; }
  const more = e.target.closest('[data-agent-more]');
  if (more) { viewState.visible += MSG_PAGE; renderChat(); return; }
  const q = e.target.closest('[data-agent-quick]');
  if (q) { Agent.send(q.dataset.agentQuick).then(() => setTimeout(() => renderChat(true), 30)); return; }
  const u = e.target.closest('[data-agent-undo]');
  if (u) {
    const r = Agent.undo(u.dataset.agentUndo);
    if (r && r.ok) { toast('已撤销', 'ok'); renderChat(); }
    else toast((r && r.error) || '撤销失败', 'err');
  }
}

// ---------------- 审批 ----------------

function showApproval({ name, preview, expiresAt }) {
  ensureRoot();
  hideApproval();
  approvalEl = document.createElement('div');
  approvalEl.className = 'agent-approval-mask';
  approvalEl.innerHTML = `
    <div class="agent-approval">
      <div class="agent-approval-head">将要执行 · ${esc(name)}</div>
      <div class="agent-approval-body">${esc(preview).replace(/\n/g, '<br>')}</div>
      <div class="agent-approval-timer" data-approval-timer></div>
      <div class="row-gap" style="justify-content:flex-end">
        <button class="btn" data-ap-deny>拒绝并停止</button>
        <button class="btn" data-ap-always>本会话不再询问</button>
        <button class="btn primary" data-ap-allow>允许</button>
      </div>
    </div>`;
  root.appendChild(approvalEl);
  approvalEl.querySelector('[data-ap-allow]').onclick = () => Agent.resolveApproval('allow');
  approvalEl.querySelector('[data-ap-always]').onclick = () => Agent.resolveApproval('always');
  approvalEl.querySelector('[data-ap-deny]').onclick = () => Agent.resolveApproval('deny');
  const label = approvalEl.querySelector('[data-approval-timer]');
  const tick = () => {
    if (!label || !approvalEl) return;
    const left = Math.max(0, Math.ceil(((expiresAt || Date.now()) - Date.now()) / 1000));
    label.textContent = left > 0 ? `${left}s 后自动允许` : '正在执行…';
    if (left <= 0) return;
    setTimeout(tick, 500);
  };
  tick();
}

function hideApproval() {
  if (approvalEl && approvalEl.parentElement) approvalEl.parentElement.removeChild(approvalEl);
  approvalEl = null;
}

// ---------------- 历史管理 ----------------

export function openHistory() {
  ensureRoot();
  const db = window.App.db;
  const list = listSessions(db);
  const rows = list.map((s) => `
    <div class="agent-session-row">
      <div class="agent-session-main">
        <b>${esc(s.title || '未命名')}</b>
        <span class="muted">${new Date(s.updatedAt || s.createdAt).toLocaleString()} · ${esc(statusText(s.status) || '空闲')}</span>
      </div>
      <div class="row-gap">
        <button class="btn sm" data-hs-open="${esc(s.id)}">打开</button>
        <button class="btn sm" data-hs-rename="${esc(s.id)}">重命名</button>
        <button class="btn sm" data-hs-del="${esc(s.id)}">删除</button>
      </div>
    </div>`).join('') || '<div class="muted" style="padding:12px 0">还没有会话。</div>';
  const el = document.createElement('div');
  el.className = 'agent-mask';
  el.innerHTML = `
    <div class="agent-panel agent-panel-sm">
      <div class="agent-head">
        <span class="agent-title">Agent 历史</span>
        <button class="btn sm" data-hs-close>✕</button>
      </div>
      <div class="agent-body agent-history">${rows}</div>
    </div>`;
  root.appendChild(el);
  el.querySelector('[data-hs-close]').onclick = () => el.remove();
  el.querySelectorAll('[data-hs-open]').forEach((b) => {
    b.onclick = () => { Agent.resumeSession(b.dataset.hsOpen); el.remove(); openAgent(); };
  });
  el.querySelectorAll('[data-hs-rename]').forEach((b) => {
    b.onclick = () => {
      const sid = b.dataset.hsRename;
      const row = b.closest('.agent-session-row');
      const main = row && row.querySelector('.agent-session-main');
      const s = getSession(db, sid);
      if (!main) return;
      main.innerHTML = `
        <input class="agent-rename" data-rename-input value="${esc(s ? s.title : '')}" style="max-width:220px">
        <div class="row-gap" style="margin-top:4px">
          <button class="btn sm" data-rename-ok>保存</button>
          <button class="btn sm" data-rename-cancel>取消</button>
        </div>`;
      const input = main.querySelector('[data-rename-input]');
      input.focus();
      main.querySelector('[data-rename-ok]').onclick = () => {
        updateSession(db, sid, { title: String(input.value).slice(0, 40) || '未命名' });
        el.remove();
        openHistory();
      };
      main.querySelector('[data-rename-cancel]').onclick = () => { el.remove(); openHistory(); };
    };
  });
  el.querySelectorAll('[data-hs-del]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.armed !== '1') {
        b.dataset.armed = '1';
        b.textContent = '确认删除';
        return;
      }
      deleteSession(db, b.dataset.hsDel);
      el.remove();
      openHistory();
    };
  });
}

// ---------------- 模型配置（多套 + Key 加密存储） ----------------

let configEl = null;

export function openConfig() {
  ensureRoot();
  if (configEl && configEl.parentElement) configEl.remove();
  const list = listProfiles();
  const cur = activeProfile();
  const el = document.createElement('div');
  el.className = 'agent-mask';
  el.innerHTML = `
    <div class="agent-panel agent-panel-sm">
      <div class="agent-head">
        <span class="agent-title">Agent 模型配置</span>
        <button class="btn sm" data-ac-close>✕</button>
      </div>
      <div class="agent-body">
        <div class="row-gap" style="align-items:center;margin-bottom:6px">
          <select data-ac-select style="max-width:200px">
            ${list.map((p) => `<option value="${esc(p.id)}"${p.id === cur.id ? ' selected' : ''}>${esc(p.name)}${p.id === cur.id ? '（当前）' : ''}</option>`).join('')}
          </select>
          <button class="btn sm" data-ac-new>新建</button>
          <button class="btn sm" data-ac-del>删除当前</button>
        </div>
        <div class="field"><label>服务商预设</label>
          <select data-ac-provider>
            <option value="">自定义（任意 OpenAI 兼容）</option>
            ${PROVIDER_PRESETS.map((p) => `<option value="${esc(p.baseUrl)}">${esc(p.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>名称</label><input data-ac-name value="${esc(cur.name)}" placeholder="例如 DeepSeek / 豆包"></div>
        <div class="field"><label>baseUrl（OpenAI 兼容）</label><input data-ac-base value="${esc(cur.baseUrl)}" placeholder="https://api.deepseek.com/v1"></div>
        <div class="muted" data-ac-hint style="font-size: calc(11px * var(--fs));margin:-2px 0 6px"></div>
        <div class="field"><label>API Key</label><input data-ac-key type="password" value="" placeholder="${cur.apiKeyEnc ? `已保存 ${esc(maskKey(decryptText(cur.apiKeyEnc)))}，留空保持不变` : 'sk-…'}"></div>
        <div class="field"><label>模型名</label>
          <input data-ac-model value="${esc(cur.model)}" placeholder="deepseek-flash">
          <div class="row-gap" data-ac-models style="margin-top:6px">
            ${DEEPSEEK_MODELS.map((m) => `<button class="btn sm" data-ac-pick="${esc(m.id)}">${esc(m.label)}</button>`).join('')}
          </div>
        </div>
        <div class="row-gap" data-ac-think style="align-items:center">
          <label class="muted">思考模式
            <select data-ac-thinking>
              <option value="auto"${cur.thinking === 'auto' ? ' selected' : ''}>跟随默认</option>
              <option value="on"${cur.thinking === 'on' ? ' selected' : ''}>开启</option>
              <option value="off"${cur.thinking === 'off' ? ' selected' : ''}>关闭</option>
            </select>
          </label>
          <label class="muted">强度
            <select data-ac-effort>
              <option value="low"${cur.effort === 'low' ? ' selected' : ''}>low</option>
              <option value="high"${cur.effort === 'high' ? ' selected' : ''}>high</option>
              <option value="max"${cur.effort === 'max' ? ' selected' : ''}>max</option>
            </select>
          </label>
        </div>
        <div class="row-gap" style="align-items:center">
          <label class="muted">温度 <input data-ac-temp type="number" step="0.1" min="0" max="2" value="${cur.temperature}" style="width:70px"></label>
          <label class="muted">最大轮数 <input data-ac-turns type="number" min="1" max="20" value="${cur.maxTurns}" style="width:70px"></label>
        </div>
        <div class="muted" style="font-size: calc(11px * var(--fs));margin-top:6px">Key 以本机随机密钥混淆后存储（不落明文）；切换配置立即作用于下一轮对话。</div>
        <div class="muted" data-ac-result style="font-size: calc(11px * var(--fs));margin-top:4px"></div>
      </div>
      <div class="agent-foot" style="gap:8px">
        <button class="btn" data-ac-test>测试连接</button>
        <button class="btn primary" data-ac-save>保存并设为当前</button>
      </div>
    </div>`;
  root.appendChild(el);
  configEl = el;
  const q = (s) => el.querySelector(s);
  const result = q('[data-ac-result]');

  // 服务商预设：选中后直接填 baseUrl，网关类会显示兼容说明
  const providerSel = q('[data-ac-provider]');
  const hint = q('[data-ac-hint]');
  const modelsRow = q('[data-ac-models]');
  const thinkRow = q('[data-ac-think]');
  const syncHint = () => {
    const b = q('[data-ac-base]').value;
    const ds = isDeepSeek(b);
    // DeepSeek 专属的模型快捷与思考模式，只在官方接口下显示
    if (modelsRow) modelsRow.style.display = ds ? '' : 'none';
    if (thinkRow) thinkRow.style.display = ds ? '' : 'none';
    if (isOpencode(b)) {
      hint.textContent = 'OpenCode 网关：自动走 /openai/v1/chat/completions，并带 x-opencode-session 做会话路由与缓存；模型名示例 glm-5.3 / kimi-k3 / minimax-m3。';
    } else if (ds) {
      hint.textContent = 'DeepSeek 官方：deepseek-flash 支持看图，deepseek-v4-pro 纯文本；思考模式默认开启、强度 high，开启时 temperature 不生效。带工具时思维链会自动回传。';
    } else {
      hint.textContent = '';
    }
    const effort = q('[data-ac-effort]');
    if (effort) effort.disabled = q('[data-ac-thinking]').value === 'off';
  };
  providerSel.value = presetOf(cur.baseUrl);
  providerSel.onchange = () => {
    if (providerSel.value) q('[data-ac-base]').value = providerSel.value;
    syncHint();
  };
  q('[data-ac-base]').addEventListener('input', syncHint);
  q('[data-ac-thinking]').onchange = syncHint;
  el.querySelectorAll('[data-ac-pick]').forEach((b) => {
    b.onclick = () => { q('[data-ac-model]').value = b.dataset.acPick; };
  });
  syncHint();

  const rebuild = () => { el.remove(); openConfig(); };
  q('[data-ac-close]').onclick = () => { el.remove(); configEl = null; };

  q('[data-ac-select]').onchange = (e) => {
    setActiveProfile(e.target.value);
    rebuild();
  };
  q('[data-ac-new]').onclick = () => {
    const n = listProfiles().length + 1;
    const p = saveProfile({ name: `配置 ${n}`, baseUrl: '', apiKey: '', model: '', temperature: 0.3, maxTurns: 8, thinking: 'auto', effort: 'high' });
    setActiveProfile(p.id);
    rebuild();
  };
  q('[data-ac-del]').onclick = () => {
    const r = deleteProfile(cur.id);
    if (!r.ok) { toast(r.error, 'warn'); return; }
    rebuild();
  };

  const formValues = () => ({
    id: cur.id,
    name: q('[data-ac-name]').value.trim() || '未命名',
    baseUrl: q('[data-ac-base]').value.trim(),
    apiKey: q('[data-ac-key]').value.trim(),
    model: q('[data-ac-model]').value.trim(),
    temperature: Number(q('[data-ac-temp]').value),
    maxTurns: Number(q('[data-ac-turns]').value),
    thinking: q('[data-ac-thinking]').value,
    effort: q('[data-ac-effort]').value,
  });

  q('[data-ac-test]').onclick = async () => {
    const f = formValues();
    const key = f.apiKey || decryptText(cur.apiKeyEnc);
    const btn = q('[data-ac-test]');
    btn.disabled = true;
    btn.textContent = '测试中…';
    if (result) result.textContent = '';
    try {
      const r = await testConnection({ baseUrl: f.baseUrl, apiKey: key, model: f.model, temperature: 0 });
      if (result) result.textContent = `连接正常 · ${r.reply}`;
      toast('连接正常', 'ok');
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (result) result.textContent = msg.split('\n')[0];
      toast(msg.slice(0, 160), 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = '测试连接';
    }
  };

  q('[data-ac-save]').onclick = () => {
    saveProfile(formValues());
    el.remove();
    configEl = null;
    toast(Agent.isConfigured() ? '已保存并设为当前配置' : '还差 baseUrl / Key / 模型名', Agent.isConfigured() ? 'ok' : 'warn');
    renderChat();
    try { if (window.App && window.App.refresh) window.App.refresh(); } catch (e) { /* 摘要刷新失败不影响保存 */ }
  };
}

export function isConfigured() { return Agent.isConfigured(); }

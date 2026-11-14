// ============================================================
// ui/agentModal.js
// Agent 的全部界面：对话模态 / 审批模态 / 历史管理 / 配置引导。
// 独立挂载在 #agent-root，不复用 openModal（那个是单模态，会互相顶掉）。
// ============================================================
import { esc, toast } from './helpers.js';
import { Prefs } from '../store/prefs.js';
import {
  agentCfg, saveCfg, listSessions, messagesOf, getSession, updateSession, deleteSession,
} from '../services/agent/store.js';
import * as Agent from '../services/agent/runtime.js';

let root = null;
let panelOpen = false;
let approvalEl = null;
let bound = false;

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
          <textarea data-agent-text rows="2" placeholder="说点什么…（Enter 发送，Shift+Enter 换行）"></textarea>
          <button class="btn primary" data-agent-send>发送</button>
        </div>
      </div>
    </div>`;
  panelOpen = true;
  const mask = root.querySelector('[data-agent-close-mask]');
  root.querySelector('[data-agent-close]').onclick = () => closeAgent();
  mask.addEventListener('mousedown', (e) => { if (e.target === mask) closeAgent(); });
  root.querySelector('[data-agent-history]').onclick = () => openHistory();
  root.querySelector('[data-agent-new]').onclick = () => { Agent.startNewSession(); renderChat(); };
  const ta = root.querySelector('[data-agent-text]');
  const send = () => {
    const text = ta.value.trim();
    if (!text) return;
    if (Agent.isRunning()) { toast('上一轮还在跑，先等它结束或点停止', 'warn'); return; }
    ta.value = '';
    Agent.send(text).then((r) => {
      if (r && r.ok) setTimeout(() => renderChat(true), 30);
    });
  };
  root.querySelector('[data-agent-send]').onclick = send;
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  root.querySelector('[data-agent-body]').addEventListener('click', onBodyClick);
  renderChat();
  if (!Agent.isConfigured()) openConfig();
  setTimeout(() => ta.focus(), 60);
  return { close: closeAgent };
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

function renderChat(scrollBottom = false) {
  if (!panelOpen || !root) return;
  const body = root.querySelector('[data-agent-body]');
  const status = root.querySelector('[data-agent-status]');
  if (!body) return;
  const sid = Agent.currentSessionId();
  const session = sid ? getSession(window.App.db, sid) : null;
  if (status) status.textContent = session ? statusText(session.status) : '';
  if (!sid) {
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
  const msgs = messagesOf(window.App.db, sid);
  const rows = msgs.map((m) => {
    if (m.role === 'user') return `<div class="agent-msg user"><div class="bubble">${esc(m.content)}</div></div>`;
    if (m.role === 'tool') {
      const ok = m.meta && m.meta.ok;
      const undo = m.meta && m.meta.undoId && m.toolCallId
        ? `<button class="agent-undo" data-agent-undo="${esc(m.toolCallId)}">撤销</button>` : '';
      return `<div class="agent-tool ${ok ? '' : 'err'}">${esc(m.content)}${undo}</div>`;
    }
    return `<div class="agent-msg assistant"><div class="bubble">${esc(m.content)}</div></div>`;
  }).join('');
  body.innerHTML = rows || '<div class="agent-empty"><p>开始说吧。</p></div>';
  if (scrollBottom) body.scrollTop = body.scrollHeight;
}

function onBodyClick(e) {
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

// ---------------- 配置引导 ----------------

export function openConfig() {
  ensureRoot();
  const cfg = agentCfg();
  const el = document.createElement('div');
  el.className = 'agent-mask';
  el.innerHTML = `
    <div class="agent-panel agent-panel-sm">
      <div class="agent-head">
        <span class="agent-title">接入模型</span>
        <button class="btn sm" data-ac-close>✕</button>
      </div>
      <div class="agent-body">
        <p class="muted" style="font-size:12px">填 OpenAI 兼容接口。baseUrl 例：https://api.deepseek.com/v1</p>
        <div class="field"><label>baseUrl</label><input data-ac-base value="${esc(cfg.baseUrl)}" placeholder="https://api.deepseek.com/v1"></div>
        <div class="field"><label>API Key</label><input data-ac-key type="password" value="${esc(cfg.apiKey)}" placeholder="sk-…"></div>
        <div class="field"><label>模型名</label><input data-ac-model value="${esc(cfg.model)}" placeholder="deepseek-chat"></div>
        <div class="muted" style="font-size:11px;margin-top:6px">Key 存在本机偏好里（明文），仅本设备使用。</div>
      </div>
      <div class="agent-foot">
        <button class="btn primary" data-ac-save>保存</button>
      </div>
    </div>`;
  root.appendChild(el);
  el.querySelector('[data-ac-close]').onclick = () => el.remove();
  el.querySelector('[data-ac-save]').onclick = () => {
    saveCfg({
      baseUrl: el.querySelector('[data-ac-base]').value.trim(),
      apiKey: el.querySelector('[data-ac-key]').value.trim(),
      model: el.querySelector('[data-ac-model]').value.trim(),
    });
    el.remove();
    toast(Agent.isConfigured() ? '已保存，可以开始了' : '还差 baseUrl / Key / 模型名', Agent.isConfigured() ? 'ok' : 'warn');
    renderChat();
  };
}

export function isConfigured() { return Agent.isConfigured(); }

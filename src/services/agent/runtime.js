// ============================================================
// services/agent/runtime.js
// Agent 循环：组装上下文 → 请求模型 → 执行工具（含审批）→ 回到模型。
// 关掉模态不影响这里；UI 只订阅事件并渲染。
// ============================================================
import { agentCfg, ensureAgent, newSession, getSession, updateSession, addMessage, messagesOf,
  newToolCall, finishToolCall, addApproval, decideApproval, takeUndoSnapshot, commitUndo,
  undoRecord, prune } from './store.js';
import { buildSystem, historyToMessages } from './prompt.js';
import { toolDefs, runTool, isWrite, previewOf, applyUndo, internalNameOf } from './tools.js';
import { chat } from './llm.js';
import { Notifications } from '../notifications.js';
import { saveDB } from '../../store/db.js';

let AppRef = null;
let sessionId = null;
let running = false;
let abortFlag = false;
let pendingApproval = null;   // { toolCallId, resolve, timer }
let sessionTrust = false;     // 本会话信任全部写操作
const listeners = new Set();
let notifySeq = 1;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(type, payload) {
  for (const fn of listeners) {
    try { fn(type, payload); } catch (e) { /* 单个订阅者出错不影响主流程 */ }
  }
}

export function init(App) {
  AppRef = App;
  ensureAgent(App.db);
}

export const isRunning = () => running;
export const currentSessionId = () => sessionId;
export const isConfigured = () => {
  const c = agentCfg();
  return !!(c.baseUrl && c.apiKey && c.model);
};
export function hasPendingApproval() { return !!pendingApproval; }

export function startNewSession(title = '新对话') {
  const s = newSession(AppRef.db, title);
  sessionId = s.id;
  sessionTrust = false;
  prune(AppRef.db);
  saveDB(AppRef.db);
  emit('session', { sessionId });
  return s;
}

export function resumeSession(id) {
  sessionId = id;
  sessionTrust = false;
  emit('session', { sessionId });
}

export function currentSession() {
  return sessionId ? getSession(AppRef.db, sessionId) : null;
}

/** 发一条用户消息并跑一轮 */
export async function send(text) {
  const content = String(text || '').trim();
  if (!content || running) return { ok: false };
  if (!isConfigured()) {
    emit('need-config', {});
    return { ok: false, error: '未配置模型' };
  }
  if (!sessionId || !getSession(AppRef.db, sessionId)) startNewSession(content.slice(0, 18));
  const s = currentSession();
  if (s && (!s.title || s.title === '新对话')) updateSession(AppRef.db, sessionId, { title: content.slice(0, 18) });
  addMessage(AppRef.db, sessionId, { role: 'user', content });
  saveDB(AppRef.db);
  emit('message', { sessionId });
  runLoop();
  return { ok: true };
}

export function cancel() {
  abortFlag = true;
  if (pendingApproval) {
    pendingApproval.resolve('deny');
    pendingApproval = null;
  }
  if (sessionId) {
    updateSession(AppRef.db, sessionId, { status: 'cancelled' });
    saveDB(AppRef.db);
  }
  emit('state', { status: 'cancelled' });
}

/** UI 审批决策：allow | deny | always | auto */
export function resolveApproval(decision) {
  if (!pendingApproval) return;
  const { resolve } = pendingApproval;
  if (decision === 'always') sessionTrust = true;
  pendingApproval = null;
  resolve(decision);
}

async function runLoop() {
  if (running) return;
  running = true;
  abortFlag = false;
  const db = AppRef.db;
  const sid = sessionId;
  const cfg = agentCfg();
  const convo = [{ role: 'system', content: buildSystem(AppRef) }]
    .concat(historyToMessages(messagesOf(db, sid)));
  let turns = 0;
  updateSession(db, sid, { status: 'thinking', lastError: '' });
  emit('state', { status: 'thinking' });

  try {
    while (!abortFlag && turns < cfg.maxTurns) {
      turns += 1;
      const res = await chat(cfg, convo, toolDefs());
      if (abortFlag) break;

      if (res.content) {
        addMessage(db, sid, { role: 'assistant', content: res.content });
        emit('message', { sessionId: sid });
        if (/已(经)?(删除|修改|改动)/.test(res.content)) {
          emit('notice', { level: 'warn', text: '模型声称已删除/修改，但本应用只支持追加，请勿相信该描述。' });
        }
      }
      if (!res.toolCalls.length) {
        updateSession(db, sid, { status: 'done', turns });
        saveDB(db);
        emit('state', { status: 'done' });
        await notify('Agent 已完成', res.content ? res.content.slice(0, 40) : '这一轮结束了');
        running = false;
        return;
      }

      convo.push({
        role: 'assistant',
        content: res.content || null,
        tool_calls: res.toolCalls.map((c) => ({
          id: c.id, type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args || {}) },
        })),
      });

      for (const call of res.toolCalls) {
        if (abortFlag) break;
        // 模型返回的是 API 安全名（erp__add_activity），这里换回内部点号名
        const name = internalNameOf(call.name);
        updateSession(db, sid, { status: 'calling_tool' });
        emit('state', { status: 'calling_tool', tool: name });

        if (isWrite(name)) {
          const allowed = sessionTrust ? 'auto' : await askApproval(name, call);
          if (allowed === 'deny') {
            updateSession(db, sid, { status: 'cancelled', lastError: '用户拒绝' });
            saveDB(db);
            addMessage(db, sid, { role: 'tool', content: '用户拒绝，已停止。', meta: { rejected: true } });
            emit('state', { status: 'cancelled' });
            emit('notice', { level: 'warn', text: '已按你的拒绝停止' });
            running = false;
            return;
          }
        }

        const snap = isWrite(name) ? takeUndoSnapshot(db) : null;
        const tc = newToolCall(db, sid, { name, args: call.args });
        emit('message', { sessionId: sid });
        const env = runTool(AppRef, name, call.args);

        let undoId = null;
        if (isWrite(name) && env && env.ok) {
          undoId = commitUndo(db, sid, tc.id, snap);
          saveDB(db);
        }
        finishToolCall(db, tc.id, { status: env && env.ok ? 'ok' : 'error', result: env, undoId });
        addMessage(db, sid, { role: 'tool', content: toolSummary(name, env), toolCallId: tc.id, meta: { name, ok: !!(env && env.ok), undoId } });
        saveDB(db);
        emit('message', { sessionId: sid });
        emit('tool', { toolCallId: tc.id, name, env, undoId });

        convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(env).slice(0, 4000) });
      }
    }

    if (abortFlag) {
      updateSession(db, sid, { status: 'cancelled' });
      saveDB(db);
      emit('state', { status: 'cancelled' });
    } else {
      updateSession(db, sid, { status: 'done', turns });
      saveDB(db);
      emit('state', { status: 'done' });
      emit('notice', { level: 'info', text: `已到本轮上限（${cfg.maxTurns} 轮），可以继续说。` });
    }
  } catch (e) {
    const msg = String((e && e.message) || e);
    updateSession(db, sid, { status: 'failed', lastError: msg });
    addMessage(db, sid, { role: 'assistant', content: `⚠ ${msg}` });
    saveDB(db);
    emit('message', { sessionId: sid });
    emit('state', { status: 'failed', error: msg });
  } finally {
    running = false;
  }
}

function toolSummary(name, env) {
  if (!env) return `${name}：无返回`;
  if (!env.ok) return `${name} 失败：${(env.error && env.error.message) || '未知错误'}`;
  const d = env.data || {};
  const bits = [];
  if (d.title) bits.push(d.title);
  if (d.id) bits.push(d.id);
  if (d.count !== undefined) bits.push(`${d.count} 条`);
  if (Array.isArray(d.items)) bits.push(`${d.items.length} 条`);
  if (d.date) bits.push(d.date);
  if (d.planned_start) bits.push(d.planned_start);
  const warn = env.warnings && env.warnings.length ? `（${env.warnings[0]}）` : '';
  return `${name} 完成${bits.length ? `：${bits.join(' · ')}` : ''}${warn}`;
}

function askApproval(name, call) {
  return new Promise((resolve) => {
    const db = AppRef.db;
    const preview = previewOf(name, call.args, db);
    const rec = addApproval(db, sessionId, { toolCallId: call.id, preview });
    saveDB(db);
    updateSession(db, sessionId, { status: 'awaiting_approval' });
    emit('state', { status: 'awaiting_approval' });
    emit('approval', { approvalId: rec.id, name, preview, expiresAt: rec.expiresAt });
    notify('Agent 需要你确认', preview.split('\n')[0]);

    const timer = setTimeout(() => {
      if (!pendingApproval) return;
      const done = pendingApproval;
      pendingApproval = null;
      decideApproval(db, rec.id, 'auto');
      emit('approval-resolved', { approvalId: rec.id, decision: 'auto' });
      done.resolve('auto');
    }, 30000);

    pendingApproval = {
      approvalId: rec.id,
      resolve: (decision) => {
        clearTimeout(timer);
        decideApproval(db, rec.id, decision === 'always' ? 'allowed' : (decision === 'allow' ? 'allowed' : decision));
        saveDB(db);
        emit('approval-resolved', { approvalId: rec.id, decision });
        resolve(decision);
      },
    };
  });
}

async function notify(title, body) {
  try {
    await Notifications.schedule({ id: 70000 + (notifySeq++ % 1000), title, body: String(body || '').slice(0, 60) });
  } catch (e) { /* 通知失败静默 */ }
}

/** 撤销一条写操作 */
export function undo(toolCallId) {
  const db = AppRef.db;
  const tc = ensureAgent(db).toolCalls.find((t) => t.id === toolCallId);
  if (!tc || !tc.undoId) return { ok: false, error: '没有可撤销的记录' };
  const r = undoRecord(tc.undoId);
  if (!r.ok) return r;
  applyUndo(AppRef, r.rec);
  tc.undoId = null;
  const s = getSession(db, tc.sessionId);
  if (s) updateSession(db, s.id, {});
  saveDB(db);
  emit('message', { sessionId: tc.sessionId });
  return { ok: true };
}

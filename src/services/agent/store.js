// ============================================================
// services/agent/store.js
// Agent 的持久层：会话 / 消息 / 工具调用 / 审批 记录 + 写操作撤销快照。
// 约定：全部挂在 db.agent 下，随 saveDB 一起落盘、随备份一起导出。
// ============================================================
import { Prefs } from '../../store/prefs.js';

export const AGENT_DEFAULTS = {
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0.3,
  maxTurns: 8,
  rememberJournal: true,
  hidden: false,
};
export const MAX_SESSIONS = 30;
export const MAX_MESSAGES = 200;
export const MAX_TOOLCALLS = 200;
export const MAX_APPROVALS = 100;
export const UNDO_TTL = 30 * 60 * 1000; // 30 分钟
const UNDO_KEY = 'agent_undo_v1';
const UNDO_MAX = 20;

function uid(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function agentCfg() {
  const p = Prefs.load();
  return {
    ...AGENT_DEFAULTS,
    baseUrl: String(p.agentBaseUrl || '').trim(),
    apiKey: String(p.agentApiKey || '').trim(),
    model: String(p.agentModel || '').trim(),
    temperature: Number.isFinite(Number(p.agentTemperature)) ? Number(p.agentTemperature) : AGENT_DEFAULTS.temperature,
    maxTurns: Number(p.agentMaxTurns) > 0 ? Number(p.agentMaxTurns) : AGENT_DEFAULTS.maxTurns,
    rememberJournal: p.agentRememberJournal !== false,
    hidden: !!p.agentHidden,
  };
}

export function saveCfg(patch) {
  const map = {
    baseUrl: 'agentBaseUrl', apiKey: 'agentApiKey', model: 'agentModel',
    temperature: 'agentTemperature', maxTurns: 'agentMaxTurns',
    rememberJournal: 'agentRememberJournal', hidden: 'agentHidden',
  };
  const out = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (map[k]) out[map[k]] = v;
  }
  Prefs.set(out);
}

export function ensureAgent(db) {
  if (!db.agent || typeof db.agent !== 'object') db.agent = {};
  const a = db.agent;
  if (!Array.isArray(a.sessions)) a.sessions = [];
  if (!Array.isArray(a.messages)) a.messages = [];
  if (!Array.isArray(a.toolCalls)) a.toolCalls = [];
  if (!Array.isArray(a.approvals)) a.approvals = [];
  return a;
}

export function listSessions(db) {
  return ensureAgent(db).sessions.slice().sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
}

export function getSession(db, id) {
  return ensureAgent(db).sessions.find((s) => s.id === id) || null;
}

export function newSession(db, title = '新对话') {
  const a = ensureAgent(db);
  const now = Date.now();
  const s = {
    id: uid('ag'), title, status: 'idle', createdAt: now, updatedAt: now,
    turns: 0, model: agentCfg().model || '', summary: '', lastError: '',
  };
  a.sessions.push(s);
  prune(db);
  return s;
}

export function updateSession(db, id, patch) {
  const s = getSession(db, id);
  if (!s) return null;
  Object.assign(s, patch, { updatedAt: Date.now() });
  return s;
}

export function deleteSession(db, id) {
  const a = ensureAgent(db);
  a.sessions = a.sessions.filter((s) => s.id !== id);
  a.messages = a.messages.filter((m) => m.sessionId !== id);
  a.toolCalls = a.toolCalls.filter((t) => t.sessionId !== id);
  a.approvals = a.approvals.filter((v) => v.sessionId !== id);
}

export function messagesOf(db, sessionId) {
  return ensureAgent(db).messages.filter((m) => m.sessionId === sessionId);
}

export function addMessage(db, sessionId, msg) {
  const a = ensureAgent(db);
  const m = {
    id: uid('am'), sessionId, role: msg.role, content: String(msg.content || ''),
    toolCallId: msg.toolCallId || null, createdAt: Date.now(), meta: msg.meta || null,
  };
  a.messages.push(m);
  updateSession(db, sessionId, {});
  prune(db);
  return m;
}

export function newToolCall(db, sessionId, { name, args }) {
  const a = ensureAgent(db);
  const t = {
    id: uid('tc'), sessionId, name, args: args || {}, status: 'running',
    result: null, startedAt: Date.now(), finishedAt: null, undoId: null,
  };
  a.toolCalls.push(t);
  prune(db);
  return t;
}

export function finishToolCall(db, id, { status, result, undoId }) {
  const a = ensureAgent(db);
  const t = a.toolCalls.find((x) => x.id === id);
  if (!t) return null;
  t.status = status;
  t.result = result === undefined ? null : result;
  t.finishedAt = Date.now();
  if (undoId !== undefined) t.undoId = undoId;
  return t;
}

export function addApproval(db, sessionId, { toolCallId, preview, risk }) {
  const a = ensureAgent(db);
  const now = Date.now();
  const v = {
    id: uid('ap'), sessionId, toolCallId, risk: risk || 'write', preview: preview || '',
    createdAt: now, expiresAt: now + 30000, decision: 'pending',
  };
  a.approvals.push(v);
  prune(db);
  return v;
}

export function decideApproval(db, id, decision) {
  const a = ensureAgent(db);
  const v = a.approvals.find((x) => x.id === id);
  if (!v) return null;
  v.decision = decision;
  return v;
}

export function latestUndoable(db, sessionId) {
  const a = ensureAgent(db);
  return a.toolCalls
    .filter((t) => t.sessionId === sessionId && t.undoId)
    .sort((x, y) => (y.finishedAt || 0) - (x.finishedAt || 0))[0] || null;
}

export function prune(db) {
  const a = ensureAgent(db);
  if (a.sessions.length > MAX_SESSIONS) {
    const keep = new Set(listSessions(db).slice(0, MAX_SESSIONS).map((s) => s.id));
    a.sessions = a.sessions.filter((s) => keep.has(s.id));
    a.messages = a.messages.filter((m) => keep.has(m.sessionId));
    a.toolCalls = a.toolCalls.filter((t) => keep.has(t.sessionId));
    a.approvals = a.approvals.filter((v) => keep.has(v.sessionId));
  }
  trimBySession(a.messages, MAX_MESSAGES);
  trimBySession(a.toolCalls, MAX_TOOLCALLS);
  trimBySession(a.approvals, MAX_APPROVALS);
}

function trimBySession(arr, cap) {
  const count = new Map();
  const out = [];
  for (let i = arr.length - 1; i >= 0; i--) {
    const sid = arr[i].sessionId;
    const n = (count.get(sid) || 0) + 1;
    count.set(sid, n);
    if (n <= cap) out.push(arr[i]);
  }
  arr.length = 0;
  for (let i = out.length - 1; i >= 0; i--) arr.push(out[i]);
}

// ---------------- 撤销：只记录「本次新增 / 被改动」的差量 ----------------

const readUndo = () => {
  try { return JSON.parse(localStorage.getItem(UNDO_KEY) || '[]'); } catch (e) { return []; }
};
const writeUndo = (list) => {
  try {
    const now = Date.now();
    const keep = list.filter((r) => !r.undone && r.expiresAt > now).slice(-UNDO_MAX);
    localStorage.setItem(UNDO_KEY, JSON.stringify(keep));
  } catch (e) { /* 存不下就放弃持久化，内存里仍可撤销 */ }
};

/** 在写工具执行前调用：拍一份紧凑差量快照 */
export function takeUndoSnapshot(db) {
  const map = new Map();
  for (const a of db.activities || []) map.set(a.id, JSON.stringify(a));
  const journals = new Map();
  for (const j of db.journals || []) journals.set(j.id, String(j.md || ''));
  return {
    activityJson: map,
    activityIds: new Set((db.activities || []).map((a) => a.id)),
    txIds: new Set((db.txs || []).map((t) => t.id)),
    goalIds: new Set((db.goals || []).map((g) => g.id)),
    planIds: new Set((db.plans || []).map((p) => p.id)),
    journals,
    seq: JSON.stringify(db.seq || {}),
  };
}

/** 写工具成功之后：把差量存进撤销记录，返回 undoId */
export function commitUndo(db, sessionId, toolCallId, snap) {
  const addedActivities = (db.activities || []).filter((a) => !snap.activityIds.has(a.id)).map((a) => a.id);
  const changedActivities = (db.activities || [])
    .filter((a) => snap.activityIds.has(a.id) && snap.activityJson.get(a.id) !== JSON.stringify(a))
    .map((a) => ({ id: a.id, prev: snap.activityJson.get(a.id) }));
  const addedTxs = (db.txs || []).filter((t) => !snap.txIds.has(t.id)).map((t) => t.id);
  const addedGoals = (db.goals || []).filter((g) => !snap.goalIds.has(g.id)).map((g) => g.id);
  const addedPlans = (db.plans || []).filter((p) => !snap.planIds.has(p.id)).map((p) => p.id);
  const changedJournals = [];
  for (const j of db.journals || []) {
    if (snap.journals.has(j.id) && snap.journals.get(j.id) !== String(j.md || '')) {
      changedJournals.push({ id: j.id, prev: snap.journals.get(j.id) });
    }
  }
  const rec = {
    id: uid('ud'), sessionId, toolCallId,
    createdAt: Date.now(), expiresAt: Date.now() + UNDO_TTL, undone: false,
    addedActivities, changedActivities, addedTxs, addedGoals, addedPlans,
    changedJournals, prevSeq: snap.seq,
  };
  const list = readUndo();
  list.push(rec);
  writeUndo(list);
  return rec.id;
}

export function undoRecord(id) {
  const list = readUndo();
  const rec = list.find((r) => r.id === id);
  if (!rec || rec.undone) return { ok: false, error: '撤销记录不存在' };
  if (rec.expiresAt <= Date.now()) return { ok: false, error: '已超过 30 分钟，无法撤销' };
  rec.undone = true;
  writeUndo(list);
  return { ok: true, rec };
}

export function listUndo() {
  return readUndo().filter((r) => !r.undone && r.expiresAt > Date.now());
}

export function clearUndoFor(sessionId) {
  const list = readUndo().filter((r) => r.sessionId !== sessionId);
  writeUndo(list);
}

// ============================================================
// services/agent/store.js
// Agent 的持久层：会话 / 消息 / 工具调用 / 审批 记录 + 写操作撤销快照。
// 约定：全部挂在 db.agent 下，随 saveDB 一起落盘、随备份一起导出。
// ============================================================
import { Prefs } from '../../store/prefs.js';
import { encryptText, decryptText } from './secret.js';

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

// ---------------- 多套模型配置（API Key 加密存储） ----------------

function normalizeProfile(p) {
  return {
    id: p.id || uid('agp'),
    name: String(p.name || '未命名').slice(0, 24),
    baseUrl: String(p.baseUrl || '').trim(),
    apiKeyEnc: p.apiKeyEnc || (p.apiKey ? encryptText(p.apiKey) : ''),
    model: String(p.model || '').trim(),
    temperature: Number.isFinite(Number(p.temperature)) ? Number(p.temperature) : AGENT_DEFAULTS.temperature,
    maxTurns: Number(p.maxTurns) > 0 ? Number(p.maxTurns) : AGENT_DEFAULTS.maxTurns,
  };
}

/** 从旧版明文配置迁移一次，并清掉明文 key */
function migrateLegacy() {
  const p = Prefs.load();
  if (Array.isArray(p.agentProfiles) && p.agentProfiles.length) return;
  const legacy = normalizeProfile({
    name: '默认',
    baseUrl: p.agentBaseUrl || '',
    apiKey: p.agentApiKey || '',
    model: p.agentModel || '',
    temperature: p.agentTemperature,
    maxTurns: p.agentMaxTurns,
  });
  Prefs.set({
    agentProfiles: [legacy],
    agentActiveProfile: legacy.id,
    agentBaseUrl: '',
    agentApiKey: '',
    agentModel: '',
  });
}

export function listProfiles() {
  migrateLegacy();
  const list = Prefs.load().agentProfiles;
  return Array.isArray(list) ? list.map(normalizeProfile) : [];
}

export function activeProfile() {
  const list = listProfiles();
  const id = Prefs.load().agentActiveProfile;
  return list.find((p) => p.id === id) || list[0] || normalizeProfile({ name: '默认' });
}

export function setActiveProfile(id) {
  Prefs.set({ agentActiveProfile: id });
}

/** 新建或更新一套配置；apiKey 传明文（空字符串表示保持原 key 不变） */
export function saveProfile(input) {
  const list = listProfiles().map(normalizeProfile);
  const idx = list.findIndex((p) => p.id === input.id);
  const base = idx >= 0 ? list[idx] : normalizeProfile({});
  const next = normalizeProfile({
    ...base,
    ...input,
    id: base.id,
    apiKeyEnc: input.apiKey ? encryptText(input.apiKey) : base.apiKeyEnc,
  });
  if (idx >= 0) list[idx] = next;
  else list.push(next);
  Prefs.set({ agentProfiles: list, agentActiveProfile: next.id });
  return next;
}

export function deleteProfile(id) {
  const list = listProfiles().map(normalizeProfile).filter((p) => p.id !== id);
  if (!list.length) return { ok: false, error: '至少保留一套配置' };
  const active = Prefs.load().agentActiveProfile;
  Prefs.set({
    agentProfiles: list,
    agentActiveProfile: active === id ? list[0].id : active,
  });
  return { ok: true };
}

/** 解析当前生效的配置（key 在此解密，只在内存里） */
export function agentCfg() {
  const p = Prefs.load();
  const pr = activeProfile();
  return {
    ...AGENT_DEFAULTS,
    baseUrl: pr.baseUrl,
    apiKey: decryptText(pr.apiKeyEnc),
    model: pr.model,
    temperature: pr.temperature,
    maxTurns: pr.maxTurns,
    rememberJournal: p.agentRememberJournal !== false,
    hidden: !!p.agentHidden,
  };
}

/** 非模型类的开关（日记上下文 / 隐藏入口） */
export function saveAgentFlags(patch) {
  const out = {};
  if (patch.rememberJournal !== undefined) out.agentRememberJournal = !!patch.rememberJournal;
  if (patch.hidden !== undefined) out.agentHidden = !!patch.hidden;
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

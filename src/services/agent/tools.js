// ============================================================
// services/agent/tools.js
// 进程内工具桥：把 mcp/tools.mjs 的同一套工具接到内存库上，
// 并提供「读/写分级、审批预览、撤销回放」。
// ============================================================
import { TOOLS, TOOL_BY_NAME, callTool } from '../../../mcp/tools.mjs';
import { saveDB } from '../../store/db.js';

export const READ_TOOLS = new Set(['erp.status', 'erp.goals', 'erp.activities', 'erp.transactions', 'erp.journal']);
export const WRITE_TOOLS = new Set(['erp.add_goal', 'erp.add_plan', 'erp.add_activity', 'erp.add_tx', 'erp.append_journal']);

export const isWrite = (name) => WRITE_TOOLS.has(name);

// 模型侧函数名必须匹配 ^[a-zA-Z0-9_-]+$（DeepSeek/OpenAI 都会校验），
// 而 MCP 内部工具名带点（erp.add_activity），所以边界上做一次映射。
export const apiNameOf = (name) => String(name).replace(/[^a-zA-Z0-9_-]/g, '__');

/** 模型返回的 name → 内部工具名（同时兼容模型直接回内部点号名） */
export function internalNameOf(api) {
  if (TOOL_BY_NAME.has(api)) return api;
  const hit = TOOLS.find((t) => apiNameOf(t.name) === api);
  return hit ? hit.name : api;
}

/** 给模型看的工具描述补充：何时用 / 何时不用 / 参数来源 */
const HINTS = {
  'erp.status': '先看整体家底时用。返回余额、目标/计划/活动/流水数量。不要用它替代具体查询。',
  'erp.goals': '需要目标及其下属计划时用；add_plan / add_activity 之前先调它拿真实 id。',
  'erp.activities': '查某天或某状态的活动时用；用户问「今天有什么」时优先用它而不是猜。',
  'erp.transactions': '查流水明细时用；只读，不改余额。',
  'erp.journal': '读某天日记正文。写日记前先用它看已有内容，避免重复。',
  'erp.add_goal': '用户明确要立一个长期方向时用。不要用活动冒充目标。',
  'erp.add_plan': '把目标拆成中期抓手时用；goal_id 必须先由 erp.goals 取得。',
  'erp.add_activity': '把计划落成可排程的一件具体事时用；date 为 YYYY-M-D，start 为 HH:MM；没有确定钟点就只给 date。不要一次塞超过 6 条。',
  'erp.add_tx': '用户口述一笔收入/支出时用；debit=收入、credit=支出，金额必须为正。',
  'erp.append_journal': '往某天日记末尾追加叙述或命令块时用；不要用它改写已有内容。',
};

/** OpenAI tools 数组（schema 原样复用，仅补强描述） */
export function toolDefs() {
  return TOOLS.map((t) => ({
    type: 'function',
    function: {
      name: apiNameOf(t.name),
      description: `${HINTS[t.name] || t.description}\n用途：${t.description}`,
      parameters: t.inputSchema || { type: 'object', properties: {} },
    },
  }));
}

/** 内存库上下文：绕过 mcp.enabled（该开关只约束外部访问） */
export function createCtx(App) {
  const view = new Proxy(App.db, {
    get(target, key) {
      if (key === 'mcp') return { enabled: true };
      return target[key];
    },
  });
  const persist = () => {
    try { saveDB(App.db); } catch (e) {}
    if (App && typeof App.refresh === 'function') App.refresh();
  };
  return {
    file: () => 'memory://personal-erp',
    read: () => view,
    // 与 mcp/tools.mjs 的 createContext 语义一致：先跑写入函数，成功后再落盘
    append: (fn) => {
      const res = fn(view);
      if (!res || res.error) {
        return res || { error: { code: 'ERR_INTERNAL', message: '写入没有返回结果' } };
      }
      persist();
      return res;
    },
  };
}

/** 执行一个工具，永远返回信封 */
export function runTool(App, name, args) {
  try {
    return callTool(name, args || {}, createCtx(App));
  } catch (e) {
    return { ok: false, tool: name, error: { code: 'ERR_INTERNAL', message: String((e && e.message) || e) } };
  }
}

const fmtMoney = (v) => (Math.round(Number(v) * 100) / 100).toString();

/** 审批预览：给人看的一行/几行，不是 JSON */
export function previewOf(name, args, db) {
  const a = args || {};
  if (name === 'erp.add_goal') return `新增目标：「${a.title || ''}」${a.desc ? `\n${String(a.desc).slice(0, 80)}` : ''}`;
  if (name === 'erp.add_plan') {
    const g = (db.goals || []).find((x) => x.id === a.goalId);
    return `新增计划：「${a.title || ''}」\n归属目标：${g ? g.title : (a.goalId || '?')}`;
  }
  if (name === 'erp.add_activity') {
    const when = a.start ? `${a.date || '今天'} ${a.start}` : (a.date || '今天（不排钟点）');
    const mins = a.minutes ? ` · ${a.minutes} 分钟` : '';
    const plan = a.planId ? `\n计划 id：${a.planId}` : '';
    return `新增活动：「${a.title || ''}」\n${when}${mins}${plan}`;
  }
  if (name === 'erp.add_tx') {
    const dir = String(a.direction || '').toLowerCase();
    const income = dir === 'income' || dir === 'debit';
    return `${income ? '收入 +' : '支出 −'}${fmtMoney(a.amount)} · ${a.resource || '默认资源'}${a.note ? `\n备注：${a.note}` : ''}`;
  }
  if (name === 'erp.append_journal') {
    const text = String(a.text || '');
    return `追加到 ${a.date || '今天'} 的日记 · ${text.length} 字\n${text.slice(0, 120)}${text.length > 120 ? '…' : ''}`;
  }
  return `${name}`;
}

/** 回放一条撤销记录（只删除本次新增、恢复本次被改动的条目） */
export function applyUndo(App, rec) {
  const db = App.db;
  const dropActs = new Set(rec.addedActivities || []);
  db.activities = (db.activities || []).filter((x) => !dropActs.has(x.id));
  for (const item of rec.changedActivities || []) {
    const i = db.activities.findIndex((x) => x.id === item.id);
    if (i >= 0) { try { db.activities[i] = JSON.parse(item.prev); } catch (e) {} }
  }
  const dropTxs = new Set(rec.addedTxs || []);
  db.txs = (db.txs || []).filter((x) => !dropTxs.has(x.id));
  const dropGoals = new Set(rec.addedGoals || []);
  db.goals = (db.goals || []).filter((x) => !dropGoals.has(x.id));
  const dropPlans = new Set(rec.addedPlans || []);
  db.plans = (db.plans || []).filter((x) => !dropPlans.has(x.id));
  for (const item of rec.changedJournals || []) {
    const j = (db.journals || []).find((x) => x.id === item.id);
    if (j) j.md = item.prev;
  }
  try { db.seq = JSON.parse(rec.prevSeq || '{}'); } catch (e) {}
  saveDB(db);
  if (App && typeof App.refresh === 'function') App.refresh();
}

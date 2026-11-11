// ============================================================
// mcp/tools.mjs
// Personal ERP 的外部 MCP 工具面：读数据 + 仅追加写入。
//
// 设计约束：
//   · 不改历史：没有任何 update / delete 工具，只能新增实体与追加文本。
//   · 写入必须过领域引擎（src/domain/engine.js）的校验与不变量，不做裸 CRUD。
//   · 结果信封沿用 docs/api/mcp-agent.md：{ ok, tool, version, data|error, warnings? }，永不抛异常。
//   · 预算口径复用 src/domain/capital.js 的 analyze()，与 App 内一致。
// ============================================================
import { createGoal, createPlan, createActivity, adjustResource } from '../src/domain/engine.js';
import { analyze } from '../src/domain/capital.js';

export const VERSION = '1.0';

const ok = (tool, data, warnings) => ({
  ok: true, tool, version: VERSION, data,
  ...(warnings && warnings.length ? { warnings: warnings.slice(0, 5) } : {}),
});
const err = (tool, code, message) => ({
  ok: false, tool, version: VERSION, error: { code, message },
});

// ---------------- 日期工具（日记键统一 YYYY-M-D，不补零；计划时间 YYYY-MM-DDTHH:MM） ----------------

function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function normDay(s) {
  const m = String(s || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? `${+m[1]}-${+m[2]}-${+m[3]}` : null;
}
function padDay(s) {
  const k = normDay(s);
  if (!k) return null;
  const [y, m, d] = k.split('-').map(Number);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function padTime(s) {
  const m = String(s || '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

function activityDateKey(a) {
  if (a.planned_start) return normDay(a.planned_start);
  if (a.planned_date) return normDay(a.planned_date);
  return null;
}

// ---------------- 只读投影 ----------------

function resourceBalances(db) {
  const out = [];
  for (const r of db.resources || []) {
    let bal = Number(r.initial) || 0;
    for (const t of db.txs || []) {
      if (t.resource_id !== r.id) continue;
      bal += (Number(t.debit) || 0) - (Number(t.credit) || 0);
    }
    out.push({
      id: r.id, name: r.name, unit: r.unit || '', status: r.status || 'Active',
      balance: Math.round(bal * 100) / 100,
    });
  }
  return out;
}

function resolveResourceId(db, nameOrId) {
  const key = String(nameOrId || '').trim();
  if (!key) return null;
  const byId = (db.resources || []).find((r) => r.id === key);
  if (byId) return byId.id;
  const byName = (db.resources || []).find((r) => r.name === key);
  return byName ? byName.id : null;
}

function todayJournal(db, key) {
  return (db.journals || []).find((j) => normDay(j.date) === key) || null;
}

// ---------------- 工具定义 ----------------

export const TOOLS = [
  {
    name: 'erp.status',
    description: '整体状态：资源余额、目标/计划/活动/流水数量、建议预算与资本锁定情况。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (args, ctx) => {
      const db = ctx.read();
      if (!db) return { error: { code: 'ERR_NO_DATA', message: `未找到数据文件：${ctx.file()}（桌面应用首次保存后才会生成）` } };
      const a = analyze(db);
      const live = (db.activities || []).filter((x) => !['Archived', 'Completed', 'Reviewed'].includes(x.status));
      return {
        data: {
          file: ctx.file(),
          schemaVersion: db.schemaVersion || 0,
          resources: resourceBalances(db),
          counts: {
            goals: (db.goals || []).length,
            plans: (db.plans || []).length,
            activities: (db.activities || []).length,
            openActivities: live.length,
            transactions: (db.txs || []).length,
            journals: (db.journals || []).length,
          },
          budget: {
            unit: (a.primary && a.primary.unit) || '',
            recommended: Math.round(a.recommended),
            committed: Math.round(a.committed),
            ratio: Number.isFinite(a.ratio) ? Math.round(a.ratio * 100) / 100 : null,
            level: a.level,
            addLocked: a.addLocked,
          },
        },
      };
    },
  },
  {
    name: 'erp.goals',
    description: '列出目标及其下的计划（默认不含已归档）。',
    inputSchema: {
      type: 'object',
      properties: { includeArchived: { type: 'boolean', description: '是否包含已归档/已完成目标' } },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const db = ctx.read();
      if (!db) return { error: { code: 'ERR_NO_DATA', message: '未找到数据文件' } };
      const goals = (db.goals || [])
        .filter((g) => args.includeArchived || g.status !== 'Archived')
        .map((g) => ({
          id: g.id, title: g.title, status: g.status, desc: g.desc || '',
          plans: (db.plans || []).filter((p) => p.goal_id === g.id).map((p) => ({
            id: p.id, title: p.title, status: p.status,
            budget: p.budget === null || p.budget === undefined ? null : Number(p.budget),
            priority: p.priority || 3, horizonMonths: p.horizonMonths || 3,
            budgetState: p.budgetState || 'active',
          })),
        }));
      return { data: goals };
    },
  },
  {
    name: 'erp.activities',
    description: '列出活动；可按日期、状态、计划过滤。日期键为 YYYY-M-D。',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '只看这一天（YYYY-M-D / YYYY-MM-DD）' },
        status: { type: 'string', description: 'Planned / Started / Completed / Failed / Reviewed / Archived' },
        planId: { type: 'string', description: '只属于该计划的活动' },
        limit: { type: 'integer', description: '最多返回条数，默认 50，最大 200' },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const db = ctx.read();
      if (!db) return { error: { code: 'ERR_NO_DATA', message: '未找到数据文件' } };
      const day = args.date ? normDay(args.date) : null;
      if (args.date && !day) return { error: { code: 'ERR_VALIDATION', message: `日期无法识别：${args.date}` } };
      const status = typeof args.status === 'string' && args.status.trim() ? args.status.trim() : null;
      const limit = Math.min(200, Math.max(1, Math.round(Number(args.limit) || 50)));
      const rows = (db.activities || []).filter((a) => {
        if (day && activityDateKey(a) !== day) return false;
        if (status && a.status !== status) return false;
        if (args.planId && !(a.plan_ids || []).includes(args.planId)) return false;
        return true;
      });
      const data = rows
        .slice()
        .sort((x, y) => String(x.planned_start || '').localeCompare(String(y.planned_start || '')))
        .slice(0, limit)
        .map((a) => ({
          id: a.id, title: a.title, status: a.status,
          planned_date: a.planned_date || null, planned_start: a.planned_start || null,
          planned_minutes: a.planned_minutes || 0, repeat: a.repeat || null,
          plan_ids: a.plan_ids || [], note: a.note || '',
        }));
      return { data, warnings: rows.length > data.length ? [`仅返回前 ${limit} 条（共 ${rows.length} 条）`] : [] };
    },
  },
  {
    name: 'erp.transactions',
    description: '最近的收支流水（按时间倒序）。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: '默认 30，最大 200' },
        resource: { type: 'string', description: '资源名或 id' },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const db = ctx.read();
      if (!db) return { error: { code: 'ERR_NO_DATA', message: '未找到数据文件' } };
      const limit = Math.min(200, Math.max(1, Math.round(Number(args.limit) || 30)));
      const rid = args.resource ? resolveResourceId(db, args.resource) : null;
      if (args.resource && !rid) return { error: { code: 'ERR_VALIDATION', message: `资源不存在：${args.resource}` } };
      const names = new Map((db.resources || []).map((r) => [r.id, r.name]));
      const data = (db.txs || [])
        .filter((t) => !rid || t.resource_id === rid)
        .slice()
        .sort((x, y) => (Number(y.created) || 0) - (Number(x.created) || 0))
        .slice(0, limit)
        .map((t) => ({
          id: t.id, resource: names.get(t.resource_id) || t.resource_id,
          direction: (Number(t.debit) || 0) > 0 ? 'income' : 'expense',
          amount: Math.abs((Number(t.debit) || 0) - (Number(t.credit) || 0)),
          note: t.note || '', source_type: t.source_type || '', created: t.created || null,
        }));
      return { data };
    },
  },
  {
    name: 'erp.journal',
    description: '读取某一天的日记 Markdown（默认今天）。',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-M-D，默认今天' } },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const db = ctx.read();
      if (!db) return { error: { code: 'ERR_NO_DATA', message: '未找到数据文件' } };
      const key = args.date ? normDay(args.date) : dayKey();
      if (!key) return { error: { code: 'ERR_VALIDATION', message: `日期无法识别：${args.date}` } };
      const j = todayJournal(db, key);
      return { data: { date: key, md: (j && j.md) || '', exists: !!j } };
    },
  },

  // ---- 追加写（无 update / delete）----
  {
    name: 'erp.add_goal',
    description: '新建一个目标（只追加，不改动已有内容）。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '目标名称' },
        desc: { type: 'string', description: '目标描述' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      if (!args.title || !String(args.title).trim()) {
        return { error: { code: 'ERR_VALIDATION', message: 'title 必填' } };
      }
      return ctx.append((db) => {
        const r = createGoal(db, { title: args.title, desc: args.desc });
        if (!r.ok) return { error: { code: 'ERR_VALIDATION', message: r.error } };
        const g = db.goals[db.goals.length - 1];
        return { data: { id: g.id, title: g.title, status: g.status } };
      });
    },
  },
  {
    name: 'erp.add_plan',
    description: '在指定目标下新建计划（只追加）。',
    inputSchema: {
      type: 'object',
      properties: {
        goalId: { type: 'string', description: '所属目标 id' },
        title: { type: 'string', description: '计划名称' },
        budget: { type: 'number', description: '预算（可空表示不设预算）' },
        priority: { type: 'integer', description: '1 最高 … 5 最低，默认 3' },
        horizonMonths: { type: 'integer', description: '规划周期（月），默认 3' },
      },
      required: ['goalId', 'title'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      if (!args.goalId || !String(args.goalId).trim()) return { error: { code: 'ERR_VALIDATION', message: 'goalId 必填' } };
      if (!args.title || !String(args.title).trim()) return { error: { code: 'ERR_VALIDATION', message: 'title 必填' } };
      if (args.budget !== undefined && args.budget !== null && !(Number(args.budget) >= 0)) {
        return { error: { code: 'ERR_VALIDATION', message: 'budget 必须 ≥ 0 或省略' } };
      }
      return ctx.append((db) => {
        const r = createPlan(db, {
          goal_id: args.goalId, title: args.title,
          budget: args.budget === undefined ? null : args.budget,
          priority: args.priority, horizonMonths: args.horizonMonths,
        });
        if (!r.ok) return { error: { code: 'ERR_VALIDATION', message: r.error } };
        const p = db.plans[db.plans.length - 1];
        return { data: { id: p.id, title: p.title, goal_id: p.goal_id, status: p.status } };
      });
    },
  },
  {
    name: 'erp.add_activity',
    description: '新建活动（只追加）。date + start 给出完整排程；只给 date 则归到当天。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '活动名称' },
        planId: { type: 'string', description: '所属计划 id（可选）' },
        date: { type: 'string', description: '日期 YYYY-M-D（可选，默认今天）' },
        start: { type: 'string', description: '开始钟点 HH:MM（可选）' },
        minutes: { type: 'integer', description: '计划投入分钟，默认 0' },
        repeat: { type: 'string', description: 'daily / weekday / weekly（可选）' },
        note: { type: 'string', description: '备注' },
        depth: { type: 'boolean', description: '是否深度专注（可选）' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      if (!args.title || !String(args.title).trim()) return { error: { code: 'ERR_VALIDATION', message: 'title 必填' } };
      const dayN = normDay(args.date || dayKey());
      if (!dayN) return { error: { code: 'ERR_VALIDATION', message: `日期无法识别：${args.date}` } };
      const dayPad = padDay(dayN);
      const clock = args.start ? padTime(args.start) : null;
      if (args.start && !clock) return { error: { code: 'ERR_VALIDATION', message: `钟点无法识别：${args.start}` } };
      const planned_start = clock ? `${dayPad}T${clock}` : null;
      const repeat = args.repeat || null;
      if (repeat && !['daily', 'weekday', 'weekly'].includes(repeat)) {
        return { error: { code: 'ERR_VALIDATION', message: `repeat 只支持 daily / weekday / weekly` } };
      }
      return ctx.append((db) => {
        const r = createActivity(db, {
          title: args.title,
          note: args.note,
          plan_ids: args.planId ? [args.planId] : [],
          planned_date: clock ? null : dayN,
          planned_start,
          planned_minutes: args.minutes,
          repeat,
          depth: args.depth,
        });
        if (!r.ok) return { error: { code: 'ERR_VALIDATION', message: r.error } };
        const a = db.activities[db.activities.length - 1];
        // createActivity 遇时间冲突会智能顺延（r.shifted），把实际落点告诉调用方
        const warnings = r.shifted ? [`时间冲突，已顺延到 ${r.to}`] : [];
        return {
          data: { id: a.id, title: a.title, planned_start: a.planned_start, planned_date: a.planned_date, status: a.status },
          warnings,
        };
      });
    },
  },
  {
    name: 'erp.add_tx',
    description: '记一笔收支（只追加）。direction: income 记获得，expense 记消耗。',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', description: 'income / expense（也接受 debit / credit）' },
        amount: { type: 'number', description: '金额 > 0' },
        resource: { type: 'string', description: '资源名或 id（可选，默认主资源）' },
        note: { type: 'string', description: '备注' },
      },
      required: ['direction', 'amount'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const dir = String(args.direction || '').toLowerCase();
      const wire = dir === 'income' || dir === 'debit' ? 'debit' : (dir === 'expense' || dir === 'credit' ? 'credit' : null);
      if (!wire) return { error: { code: 'ERR_VALIDATION', message: 'direction 只支持 income / expense' } };
      const amount = Number(args.amount);
      if (!(amount > 0)) return { error: { code: 'ERR_VALIDATION', message: 'amount 必须 > 0' } };
      return ctx.append((db) => {
        const rid = args.resource
          ? resolveResourceId(db, args.resource)
          : ((db.resources || []).find((r) => r.status !== 'Inactive') || {}).id;
        if (!rid) return { error: { code: 'ERR_VALIDATION', message: `资源不存在：${args.resource || '（无可用资源）'}` } };
        const r = adjustResource(db, rid, { direction: wire, amount, note: args.note });
        if (!r.ok) return { error: { code: 'ERR_VALIDATION', message: r.error } };
        const t = db.txs[db.txs.length - 1];
        return { data: { id: t.id, resource_id: t.resource_id, debit: t.debit, credit: t.credit, note: t.note } };
      });
    },
  },
  {
    name: 'erp.append_journal',
    description: '把一段 Markdown 追加到某天的日记末尾（不清空、不覆盖已有内容）。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要追加的 Markdown' },
        date: { type: 'string', description: 'YYYY-M-D，默认今天' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const text = String(args.text || '');
      if (!text.trim()) return { error: { code: 'ERR_VALIDATION', message: 'text 不能为空' } };
      const key = args.date ? normDay(args.date) : dayKey();
      if (!key) return { error: { code: 'ERR_VALIDATION', message: `日期无法识别：${args.date}` } };
      return ctx.append((db) => {
        let j = todayJournal(db, key);
        if (!j) {
          j = { id: `j${(db.seq.j = (db.seq.j || 0) + 1)}`, date: key, md: '', parses: [] };
          db.journals.push(j);
        }
        if (!Array.isArray(j.parses)) j.parses = [];
        const prev = String(j.md || '');
        j.md = prev.trim() ? `${prev.replace(/\n+$/, '')}\n\n${text.trim()}\n` : `${text.trim()}\n`;
        return { data: { date: key, added: text.trim().length, total: j.md.length } };
      });
    },
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/// 执行一个工具，永远返回信封（不抛）
export function callTool(name, args, ctx) {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return err(name || '', 'ERR_VALIDATION', `未知工具：${name}`);
  // 总开关：App「设置 › 外部访问」关闭时，脚本整体封闭（读取也一并拒绝）
  let probe;
  try { probe = ctx.read(); } catch (e) { return err(name, 'ERR_INTERNAL', `读取数据文件失败：${e.message}`); }
  if (!probe) return err(name, 'ERR_NO_DATA', `未找到数据文件：${ctx.file()}（桌面应用首次保存后才会生成）`);
  if (!probe.mcp || probe.mcp.enabled !== true) {
    return err(name, 'ERR_AUTH_DENIED', '外部访问已关闭：请在 App「设置 › 外部访问 · MCP / 脚本」中打开开关后重试。');
  }
  const input = (args && typeof args === 'object' && !Array.isArray(args)) ? args : {};
  let out;
  try {
    out = tool.handler(input, ctx);
  } catch (e) {
    return err(name, 'ERR_INTERNAL', e && e.message ? e.message : String(e));
  }
  if (!out || !out.data && !out.error) return err(name, 'ERR_INTERNAL', '工具没有返回 data');
  if (out.error) return err(name, out.error.code || 'ERR_INTERNAL', out.error.message || '未知错误');
  return ok(name, out.data, out.warnings);
}

/// 构造工具上下文：file + 读写接缝（测试可注入自定义路径）
export function createContext({ file, read, append }) {
  return {
    file: () => file,
    read: () => read(),
    append: (fn) => {
      const db = read();
      if (!db) return { error: { code: 'ERR_NO_DATA', message: `未找到数据文件：${file}` } };
      const res = fn(db);
      if (!res || res.error) return res || { error: { code: 'ERR_INTERNAL', message: '写入没有返回结果' } };
      try {
        append(db);
      } catch (e) {
        return { error: { code: 'ERR_INTERNAL', message: `写文件失败：${e.message}` } };
      }
      return res;
    },
  };
}

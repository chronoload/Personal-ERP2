// ============================================================
// store/db.js
// 持久化层：单机自包含（localStorage），1 个 key 存全部真相。
// 未来切 SQLite/IndexedDB 只改本文件。
// ============================================================

// 文件后端（桌面 Tauri）：与 erp-db.json 双向同步，供外部程序（WorkBuddy MCP / 定时任务）
// 热加载微信巡检事项。importMerge 为本文件提供增量合并；此处形成 ESM 循环依赖，
// 但仅在运行时（轮询合并）调用，模块求值期不触发，安全。
import { mergeImport } from '../domain/importMerge.js';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

const LS_KEY = 'personal_erp_db_v1';
// 库结构版本：数据结构不兼容变更时递增，并在 normalizeDB 的升级链中追加对应步骤。
// 无版本号的旧库一律视为 v0，走遗留修复路径后盖章到当前版本。
// v3：预设收支改为多资源数组 preset_expenses/preset_incomes、default_expenses/default_incomes
//     （v2 单资源 preset_expense/preset_income 自动迁移为单元素数组）。
// v4：新增 journals（日记页）。
// v5：新增 places / commutes / currentPlaceId（地点与排班寻路）。
// v6：新增 templates（自定义模板）与计划的资本准入字段 budgetState/priority/horizonMonths。
export const SCHEMA_VERSION = 6;
let listeners = [];

// ---- 文件后端（桌面 Tauri）：与 erp-db.json 双向同步 ----
// 设计：erp-db.json 作为「外部程序可见的共享数据文件」。
//   - 启动：若文件存在则用其覆盖内存库（MCP 已写入的微信巡检事项即时可见）。
//   - 每次保存：双写文件（原子写由 Rust 端完成）。
//   - 轮询（5s）：若文件被外部程序改动（mtime 变且内容 ≠ 自己刚写的），增量合并进内存库并刷新 UI。
// 仅桌面 Tauri 生效；web / Capacitor 原生环境 isTauri() 为 false，全程纯 localStorage，零影响。
let fileSyncReady = false;       // 引导完成前不写文件，避免覆盖 MCP 已落盘的数据
let lastMtime = null;            // 上次见到的文件 mtime（ms）
let lastWrittenContent = null;   // 上次写出的文件内容（区分「自己写的」与「外部变更」）
let activeDb = null;             // 当前内存库引用（轮询合并目标）
let externalChangeHandler = null; // 外部变更后触发的重渲染回调（由 main.js 注入）
let fileBackend = null;          // 共享文件后端：tauri | native（Capacitor Filesystem）

function isTauri() {
  return typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
}

// 安卓 App（Capacitor）：把同一份 erp-db.json 写到应用私有目录（Directory.Data），
// 供内置 MiniHttpServer 的 /mcp 端点读写；读外部改动 → 增量合并，与桌面 Tauri 同一套语义。
function isNativeApp() {
  try { return typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform(); } catch (e) { return false; }
}

const NATIVE_DB_FILE = 'erp-db.json';
async function nativeRead() {
  try {
    const r = await Filesystem.readFile({ path: NATIVE_DB_FILE, directory: Directory.Data, encoding: Encoding.UTF8 });
    return String(r.data || '');
  } catch (e) { return null; }
}
async function nativeWrite(content) {
  await Filesystem.writeFile({ path: NATIVE_DB_FILE, directory: Directory.Data, data: content, encoding: Encoding.UTF8 });
}
async function nativeMtime() {
  try {
    const r = await Filesystem.stat({ path: NATIVE_DB_FILE, directory: Directory.Data });
    return Number(r.mtime) || null;
  } catch (e) { return null; }
}

function tauriInvoke(cmd, args) {
  if (!isTauri() || typeof window.__TAURI_INTERNALS__.invoke !== 'function') {
    return Promise.reject(new Error('非 Tauri 环境，无法调用 ' + cmd));
  }
  return Promise.resolve(window.__TAURI_INTERNALS__.invoke(cmd, args || {}));
}

// 解析 erp-db.json：兼容「裸 db」({schemaVersion,resources,...}) 与
// 「备份包装」({app,version,db}) 两种格式（MCP server.py 写的是后者）。
// 同时兜底补齐缺失的核心集合，避免 normalizeDB / mergeImport 遍历 undefined 报错。
const ERP_CORE_ARRAYS = [
  'resources', 'rules', 'goals', 'plans', 'activities',
  'txs', 'outputs', 'valueflows', 'goods', 'journals',
  'places', 'commutes', 'templates',
];
function parseErpFile(content) {
  let obj;
  try { obj = JSON.parse(content); } catch (e) { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const candidate =
    obj.db && typeof obj.db === 'object' && Array.isArray(obj.db.resources) ? obj.db : obj;
  if (!Array.isArray(candidate.resources)) return null;
  for (const k of ERP_CORE_ARRAYS) {
    if (!Array.isArray(candidate[k])) candidate[k] = [];
  }
  if (!candidate.seq || typeof candidate.seq !== 'object') candidate.seq = {};
  return candidate;
}

// 统一写出格式：包装为 {app,version,exportedAt,db}，与 MCP server.py 对齐（避免格式来回震荡）
function toFilePayload(db) {
  return JSON.stringify({
    app: 'personal-erp',
    version: 1,
    exportedAt: new Date().toISOString(),
    db,
  });
}

export function setExternalChangeHandler(fn) {
  externalChangeHandler = fn;
}

// 启动引导：尝试从 erp-db.json 加载；存在则用它覆盖内存库，并启动轮询。
// 返回加载到的 db（无文件 / 解析失败返回 null），由调用方决定是否替换 App.db。
// 桌面（Tauri）与安卓（Capacitor）共用同一份文件契约，只是底层 IO 不同。
export async function initErpFileSync() {
  const backend = isTauri() ? {
    kind: 'tauri', read: () => tauriInvoke('read_erp_db'), write: (c) => tauriInvoke('write_erp_db', { content: c }), stat: () => tauriInvoke('stat_erp_db'),
  } : (isNativeApp() ? {
    kind: 'native', read: nativeRead, write: nativeWrite, stat: nativeMtime,
  } : null);
  if (!backend) return null;
  let loaded = null;
  try {
    const content = await backend.read();
    if (content) {
      const parsed = parseErpFile(content);
      if (parsed) {
        ensureSeq(parsed);
        normalizeDB(parsed);
        activeDb = parsed;
        lastWrittenContent = toFilePayload(parsed);
        loaded = parsed;
      }
    }
    lastMtime = await backend.stat();
  } catch (e) {
    console.error(`[erp-file] ${backend.kind} 初始化失败，回落 localStorage：`, e);
  }
  fileSyncReady = true;
  fileBackend = backend;
  startIndexer();
  return loaded;
}

// 轮询：检测到文件被外部改动时增量合并进内存库并刷新 UI（幂等：已存在的 id 不重复并入）。
function startIndexer() {
  if (!fileBackend || startIndexer._timer) return;
  startIndexer._timer = setInterval(async () => {
    try {
      const mtime = await fileBackend.stat();
      if (mtime == null) return;
      if (mtime === lastMtime) return; // 无变更，跳过
      const content = await fileBackend.read();
      if (!content || content === lastWrittenContent) { lastMtime = mtime; return; }
      const parsed = parseErpFile(content);
      if (!parsed) { lastMtime = mtime; return; }
      // 外部访问开关关闭时「封闭脚本逻辑」：不把外部写入合并进内存库，
      // 只更新 mtime，避免下一次访问继续触发。
      if (!activeDb || activeDb.mcp?.enabled !== true) { lastMtime = mtime; return; }
      if (activeDb) {
        mergeImport(activeDb, parsed);
        normalizeDB(activeDb);
      }
      lastMtime = mtime;
      lastWrittenContent = content;
      if (externalChangeHandler) externalChangeHandler();
    } catch (e) {
      console.error('[erp-file] 轮询合并失败：', e);
    }
  }, 5000);
}

/// 立即把内存库写进共享文件（安卓端启动 MCP 服务前先落一次，保证文件存在）
export async function flushErpFile(db = activeDb) {
  if (!fileBackend || !db) return false;
  try {
    const payload = toFilePayload(db);
    lastWrittenContent = payload;
    await fileBackend.write(payload);
    lastMtime = await fileBackend.stat();
    return true;
  } catch (e) {
    console.error('[erp-file] 立即写文件失败：', e);
    return false;
  }
}

export function loadDB() {
  let db = null;
  let rawCorrupt = null; // 原始残缺数据（转存用，绝不静默丢弃）
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      try { db = JSON.parse(raw); } catch (e) { rawCorrupt = raw; }
    }
  } catch (e) { /* 读取失败按无库处理 */ }
  // 结构严重残缺（缺多个核心集合）→ 先把残缺库转存到独立 key（供数据抢救），
  // 再回退种子库。★ 绝不直接覆盖：种子一写入，用户数据就真没了。
  const coreKeys = ['resources', 'rules', 'goals', 'plans', 'activities', 'txs', 'outputs', 'valueflows'];
  const broken = !db || typeof db !== 'object' || coreKeys.filter((k) => !Array.isArray(db[k])).length > 2;
  if (broken) {
    if (rawCorrupt || db) {
      try {
        localStorage.setItem(`${LS_KEY}_corrupt_${Date.now()}`, rawCorrupt ?? JSON.stringify(db));
      } catch (e) { /* 配额满则只能放弃转存 */ }
      console.error('[db] 检测到结构损坏的数据库，已转存为 _corrupt_*，当前以全新空库启动');
    }
    db = seedDB();
  }
  ensureSeq(db);
  migrate(db);
  normalizeDB(db);
  activeDb = db; // 文件后端轮询合并的目标（与 App.db 同一引用）
  return db;
}

// 术语迁移：Token → 价值元（兼容旧数据）
function migrate(db) {
  for (const r of db.resources) {
    if (r.name === 'Token') r.name = '价值元';
    if (r.unit === 'Token') r.unit = '价值元';
  }
}

// 遗留库（v0）修复：对每个聚合根的每条实体补齐缺失字段为安全默认值，
// 字段清单以 domain/entities.js 各 new* 工厂为准（含 engine 内联构造的 tx/valueflow）。
// 兼容旧版备份导入的残缺实体，防止渲染层 a.plan_ids.map(...) 等调用 TypeError。
// 语义冻结：仅由 normalizeDB 作为 v0 遗留迁移步骤调用，不再单独导出。
function migrateV0(db) {
  if (!db || typeof db !== 'object') return;
  const asArray = (v) => Array.isArray(v) ? v : [];
  for (const key of ['resources', 'rules', 'goals', 'plans', 'activities', 'txs', 'outputs', 'valueflows', 'goods']) {
    if (!Array.isArray(db[key])) db[key] = [];
  }
  const num = (v, dflt = 0) => { const n = Number(v); return Number.isFinite(n) ? n : dflt; };
  const str = (v, dflt = '') => typeof v === 'string' ? v : dflt;
  for (const r of db.resources) {
    if (!r || typeof r !== 'object') continue;
    r.name = str(r.name); r.unit = str(r.unit); r.initial = num(r.initial);
    r.color = r.color ?? null; r.status = str(r.status, 'Active'); r.created = num(r.created, Date.now());
  }
  for (const ru of db.rules) {
    if (!ru || typeof ru !== 'object') continue;
    ru.label = str(ru.label); ru.from = ru.from ?? null; ru.to = ru.to ?? null; ru.rate = num(ru.rate);
    ru.status = str(ru.status, 'Active'); ru.created = num(ru.created, Date.now());
  }
  for (const g of db.goals) {
    if (!g || typeof g !== 'object') continue;
    g.title = str(g.title); g.desc = str(g.desc); g.created = num(g.created, Date.now());
  }
  for (const p of db.plans) {
    if (!p || typeof p !== 'object') continue;
    p.goal_id = p.goal_id ?? null; p.title = str(p.title); p.budget = p.budget ?? null;
    p.color = p.color ?? null; p.status = str(p.status, 'Incubating'); p.created = num(p.created, Date.now());
    p.default_expenses = asArray(p.default_expenses); p.default_incomes = asArray(p.default_incomes);
  }
  for (const a of db.activities) {
    if (!a || typeof a !== 'object') continue;
    a.title = str(a.title); a.note = str(a.note);
    a.plan_ids = asArray(a.plan_ids);
    a.planned_date = a.planned_date ?? null;
    a.planned_start = a.planned_start ?? null;
    a.planned_minutes = num(a.planned_minutes);
    a.repeat = a.repeat ?? null;
    a.repeat_until = a.repeat_until ?? null;
    a.time_logs = asArray(a.time_logs);
    a.theme = a.theme ?? null;
    a.preset_expenses = asArray(a.preset_expenses);
    a.preset_incomes = asArray(a.preset_incomes);
    a.conflicts = asArray(a.conflicts);
    a.actual_start = a.actual_start ?? null;
    a.actual_end = a.actual_end ?? null;
    a.status = str(a.status, 'Planned'); a.created = num(a.created, Date.now());
  }
  for (const t of db.txs) {
    if (!t || typeof t !== 'object') continue;
    t.resource_id = t.resource_id ?? null;
    t.debit = num(t.debit); t.credit = num(t.credit);
    t.source_type = str(t.source_type, 'manual'); t.source_id = str(t.source_id, 'manual');
    t.note = str(t.note); t.reversal_of = t.reversal_of ?? null; t.created = num(t.created, Date.now());
  }
  for (const o of db.outputs) {
    if (!o || typeof o !== 'object') continue;
    o.title = str(o.title); o.tags = asArray(o.tags); o.note = str(o.note);
    o.status = str(o.status, 'Draft'); o.created = num(o.created, Date.now());
  }
  for (const v of db.valueflows) {
    if (!v || typeof v !== 'object') continue;
    v.output_id = v.output_id ?? null;
    v.giver = str(v.giver); v.receiver = str(v.receiver);
    v.status = str(v.status, 'Pending'); v.expected = num(v.expected);
    v.feedback = str(v.feedback); v.created = num(v.created, Date.now());
  }
  for (const gd of db.goods) {
    if (!gd || typeof gd !== 'object') continue;
    gd.name = str(gd.name); gd.emoji = str(gd.emoji, '🛍️');
    gd.costs = asArray(gd.costs); gd.note = str(gd.note);
    gd.status = str(gd.status, 'Active'); gd.created = num(gd.created, Date.now());
  }
}

// 结构迁移入口：按 schemaVersion 分派升级步骤，保证旧库无损升到当前版本。
// - 未来版本（> 当前）：绝不降级、绝不改动，原样返回，由上层决定如何提示。
// - 无有效版本号（遗留 v0）：先跑全部历史修复逻辑，再盖章为当前版本。
// - 旧于当前的整数版本：沿升级链逐级迁移（v1 为首个版本，链暂为空）后盖章。
// 导出名与签名冻结：main.js 恢复/合并导入、engine 等既有调用方零改动。
export function normalizeDB(db) {
  if (!db || typeof db !== 'object') return;
  if (db.schemaVersion > SCHEMA_VERSION) return db;
  if (!Number.isInteger(db.schemaVersion)) {
    migrateV0(db);
    db.schemaVersion = SCHEMA_VERSION;
    // 不 return：继续走下方幂等补齐，保证 v4 新增字段（journals）就位
  }
  if (db.schemaVersion < SCHEMA_VERSION) {
    // 任意旧版 → 当前：预设收支统一为多资源数组
    // v2 单资源 preset_expense/preset_income → 包成单元素数组；v1 及更早无字段 → 空数组
    // 幂等，跨版本升级不炸（事故#5 教训）
    const toArr = (v) => Array.isArray(v) ? v : (v ? [v] : []);
    for (const p of db.plans) {
      if (!p || typeof p !== 'object') continue;
      p.default_expenses = toArr(p.default_expenses ?? p.default_expense);
      p.default_incomes = toArr(p.default_incomes ?? p.default_income);
      delete p.default_expense; delete p.default_income;
    }
    for (const a of db.activities) {
      if (!a || typeof a !== 'object') continue;
      a.preset_expenses = toArr(a.preset_expenses ?? a.preset_expense);
      a.preset_incomes = toArr(a.preset_incomes ?? a.preset_income);
      delete a.preset_expense; delete a.preset_income;
    }
  }
  // 幂等补齐（不依赖版本号）：目标 status 缺省回落 Active（三级归档字段，旧库可能缺）
  for (const g of db.goals) {
    if (g && typeof g === 'object' && !g.status) g.status = 'Active';
  }
  // 幂等补齐：日记池（v4 新增）。旧库无该字段 → 空数组；元素结构归一。
  if (!Array.isArray(db.journals)) db.journals = [];
  for (const j of db.journals) {
    if (!j || typeof j !== 'object') continue;
    if (typeof j.md !== 'string') j.md = '';
    if (!Array.isArray(j.parses)) j.parses = [];
  }
  // 幂等补齐：地点池 / 通勤矩阵 / 当前地点（v5 新增）。
  if (!Array.isArray(db.places)) db.places = [];
  for (const p of db.places) {
    if (!p || typeof p !== 'object') continue;
    if (typeof p.name !== 'string') p.name = '';
    if (!Number.isFinite(Number(p.radius)) || Number(p.radius) <= 0) p.radius = 120;
  }
  if (!Array.isArray(db.commutes)) db.commutes = [];
  for (const c of db.commutes) {
    if (!c || typeof c !== 'object') continue;
    if (!Number.isFinite(Number(c.minutes)) || Number(c.minutes) < 0) c.minutes = 0;
  }
  if (typeof db.currentPlaceId !== 'string' || !db.currentPlaceId) db.currentPlaceId = null;
  // 幂等补齐：自定义模板池（v6）。
  if (!Array.isArray(db.templates)) db.templates = [];
  // 幂等补齐：计划的资本准入轴（v6）。status 状态机不被冻结污染。
  for (const p of db.plans) {
    if (!p || typeof p !== 'object') continue;
    if (p.budgetState !== 'frozen') p.budgetState = 'active';
    const pri = Math.round(Number(p.priority));
    p.priority = Number.isFinite(pri) ? Math.min(5, Math.max(1, pri)) : 3;
    const hz = Math.round(Number(p.horizonMonths));
    p.horizonMonths = Number.isFinite(hz) ? Math.min(36, Math.max(1, hz)) : 3;
    if (p.frozenAt === undefined) p.frozenAt = null;
  }
  if (typeof db.capitalLock !== 'boolean') db.capitalLock = false;
  // 外部 MCP / 脚本访问开关（v6 起）：默认关闭。状态随 db 写入 erp-db.json，
  // 外部脚本读到 enabled=false 后拒绝一切工具调用（封闭）。
  if (!db.mcp || typeof db.mcp !== 'object') db.mcp = { enabled: false, updatedAt: null };
  if (typeof db.mcp.enabled !== 'boolean') db.mcp.enabled = false;
  if (typeof db.mcp.updatedAt !== 'number') db.mcp.updatedAt = null;
  // 幂等补齐：活动的排班输入（v5 新增）。place_id/depth 缺失视为「任何地点 / 自动判定」。
  // 同时清理指向已删除地点的悬空引用，避免寻路时把不存在的边当成可达。
  const placeIds = new Set(db.places.map((p) => p && p.id).filter(Boolean));
  for (const a of db.activities) {
    if (!a || typeof a !== 'object') continue;
    if (a.place_id === undefined) a.place_id = null;
    else if (a.place_id && !placeIds.has(a.place_id)) a.place_id = null;
    if (a.depth === undefined) a.depth = null;
    else if (a.depth !== true && a.depth !== false) a.depth = null;
  }
  db.schemaVersion = SCHEMA_VERSION;
}

export function saveDB(db) {
  activeDb = db;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(db));
  } catch (e) {
    // 容量满等配额异常：store 层无 toast 依赖，仅记录明确日志，仍广播监听者
    console.error('[db] saveDB 持久化失败（可能是存储配额已满），本次变更未落盘：', e);
  }
  // 文件后端（桌面 Tauri / 安卓 Capacitor）：双写 erp-db.json，供 MCP / 定时任务读取与热加载。
  // fileSyncReady 在 initErpFileSync() 完成前为 false —— 启动早期（含首次 render）不写文件，
  // 避免把尚未加载的 localStorage 内容覆盖掉 MCP 已写入的 erp-db.json。
  if (fileBackend && fileSyncReady) {
    const payload = toFilePayload(db);
    lastWrittenContent = payload; // 同步记录，避免下一轮轮询把「自己刚写的」误判为外部变更
    Promise.resolve()
      .then(() => fileBackend.write(payload))
      .catch((e) => console.error('[erp-file] 写入 erp-db.json 失败：', e));
  }
  listeners.forEach((fn) => fn(db));
}

// UI 订阅数据变更（用于跨视图同步刷新）
export function subscribe(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((x) => x !== fn); };
}

export function resetDB() {
  const db = seedDB();
  saveDB(db);
  return db;
}

// 保证每个聚合根的 seq 计数器存在且足够大（导入备份后也调用）
export function ensureSeq(db) {
  const maxOf = (arr, prefix) => arr.reduce((m, x) => {
    const n = parseInt(String(x.id).replace(prefix, ''), 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  db.seq = db.seq || {};
  db.seq.r = Math.max(db.seq.r || 0, maxOf(db.resources, 'r'));
  db.seq.ru = Math.max(db.seq.ru || 0, maxOf(db.rules, 'ru'));
  db.seq.g = Math.max(db.seq.g || 0, maxOf(db.goals, 'g'));
  db.seq.p = Math.max(db.seq.p || 0, maxOf(db.plans, 'p'));
  db.seq.a = Math.max(db.seq.a || 0, maxOf(db.activities, 'a'));
  db.seq.t = Math.max(db.seq.t || 0, maxOf(db.txs, 't'));
  db.seq.o = Math.max(db.seq.o || 0, maxOf(db.outputs, 'o'));
  db.seq.v = Math.max(db.seq.v || 0, maxOf(db.valueflows, 'v'));
  db.seq.gd = Math.max(db.seq.gd || 0, maxOf(db.goods || [], 'gd'));
  db.seq.j = Math.max(db.seq.j || 0, maxOf(db.journals || [], 'j'));
  db.seq.pl = Math.max(db.seq.pl || 0, maxOf(db.places || [], 'pl'));
  db.seq.cm = Math.max(db.seq.cm || 0, maxOf(db.commutes || [], 'cm'));
  db.seq.tpl = Math.max(db.seq.tpl || 0, maxOf(db.templates || [], 'tpl'));
}

// 全新初始化：资源不预设，首次启动进入「初始化资源」流程由用户自行配置
export function seedDB() {
  return {
    schemaVersion: SCHEMA_VERSION,
    resources: [],
    rules: [],
    goals: [],
    plans: [],
    activities: [],
    txs: [],
    outputs: [],
    valueflows: [],
    goods: [],
    journals: [],
    places: [],
    commutes: [],
    currentPlaceId: null,
    templates: [],
    capitalLock: false,
    seq: { r: 0, ru: 0, g: 0, p: 0, a: 0, t: 0, o: 0, v: 0, gd: 0, j: 0, pl: 0, cm: 0, tpl: 0 },
  };
}

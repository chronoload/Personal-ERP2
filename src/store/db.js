// ============================================================
// store/db.js
// 持久化层：单机自包含（localStorage），1 个 key 存全部真相。
// 未来切 SQLite/IndexedDB 只改本文件。
// ============================================================

const LS_KEY = 'personal_erp_db_v1';
// 库结构版本：数据结构不兼容变更时递增，并在 normalizeDB 的升级链中追加对应步骤。
// 无版本号的旧库一律视为 v0，走遗留修复路径后盖章到当前版本。
// v3：预设收支改为多资源数组 preset_expenses/preset_incomes、default_expenses/default_incomes
//     （v2 单资源 preset_expense/preset_income 自动迁移为单元素数组）。
export const SCHEMA_VERSION = 3;
let listeners = [];

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
    return;
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
  db.schemaVersion = SCHEMA_VERSION;
}

export function saveDB(db) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(db));
  } catch (e) {
    // 容量满等配额异常：store 层无 toast 依赖，仅记录明确日志，仍广播监听者
    console.error('[db] saveDB 持久化失败（可能是存储配额已满），本次变更未落盘：', e);
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
    seq: { r: 0, ru: 0, g: 0, p: 0, a: 0, t: 0, o: 0, v: 0, gd: 0 },
  };
}

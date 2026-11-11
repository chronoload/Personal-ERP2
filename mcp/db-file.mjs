// ============================================================
// mcp/db-file.mjs
// 外部 MCP / 定时任务共用同一个数据文件 erp-db.json（桌面 Tauri 应用写出）。
// 读写规则与 src/store/db.js 的 parseErpFile / toFilePayload 一致：
//   文件格式 = { app:'personal-erp', version:1, exportedAt, db }（也兼容裸 db）。
// 写：先写 .tmp 再 rename（原子），并把旧文件留一份 .bak。
// ============================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeDB, ensureSeq } from '../src/store/db.js';

const CORE_ARRAYS = [
  'resources', 'rules', 'goals', 'plans', 'activities',
  'txs', 'outputs', 'valueflows', 'goods', 'journals',
  'places', 'commutes', 'templates',
];

/// 默认路径：%LOCALAPPDATA%\com.personal.erp.desktop\erp-db.json（与环境变量 ERP_DB 可覆盖）
export function defaultDbPath() {
  if (process.env.ERP_DB) return path.resolve(process.env.ERP_DB);
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(local, 'com.personal.erp.desktop', 'erp-db.json');
}

/// 补齐核心集合与 seq（外部脚本可能拿到手工拼的库：缺集合会让 ensureSeq 抛错）
function ensureShape(db) {
  for (const k of CORE_ARRAYS) if (!Array.isArray(db[k])) db[k] = [];
  if (!db.seq || typeof db.seq !== 'object') db.seq = {};
  return db;
}

/// 解析文件内容 → db；无 db 结构返回 null
export function parsePayload(content) {
  let obj;
  try { obj = JSON.parse(content); } catch (e) { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const candidate = (obj.db && typeof obj.db === 'object' && Array.isArray(obj.db.resources)) ? obj.db : obj;
  if (!Array.isArray(candidate.resources)) return null;
  return ensureShape(candidate);
}

/// 读库；文件不存在 / 结构损坏 → null（调用方转 ERR_NO_DATA，不抛）
export function readDb(file = defaultDbPath()) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
  return parsePayload(raw);
}

/// 写库：归一化 + 补 seq → 备份旧文件 → 原子替换
export function writeDb(db, file = defaultDbPath()) {
  ensureShape(db);
  ensureSeq(db);
  normalizeDB(db);
  const payload = JSON.stringify({
    app: 'personal-erp',
    version: 1,
    exportedAt: new Date().toISOString(),
    db,
  }, null, 2);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  } catch (e) { /* 备份失败不阻断写入 */ }
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, payload, 'utf8');
  fs.renameSync(tmp, file);
}

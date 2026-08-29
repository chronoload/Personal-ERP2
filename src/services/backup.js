// ============================================================
// services/backup.js
// 数据备份 / 恢复（自包含数据安全）：
//   export：native 写入 Documents/backups（本地保存，不再调分享）；web 触发 JSON 下载
//   exportLocal：静默本地备份（定时自动备份用）——native 写 Documents/backups；web 存 localStorage 备份历史
//   import：隐藏 file input（Capacitor WebView 自动调起系统文件选择器）
// 备份文件契约：{ app:'personal-erp', version:1, exportedAt, db:{...} }
// ============================================================
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { inspectImport, mergeImport } from '../domain/importMerge.js';
import { Prefs } from '../store/prefs.js';
import { toast } from '../ui/helpers.js';

const NATIVE = () => Capacitor.isNativePlatform();
const WEB_BACKUP_KEY = 'personal_erp_backups'; // web 端本地备份历史（保留最近 10 份）
const MAX_WEB_BACKUPS = 10;

function dbShapeOK(d) {
  return d && Array.isArray(d.resources) && Array.isArray(d.rules) && Array.isArray(d.goals)
    && Array.isArray(d.plans) && Array.isArray(d.activities) && Array.isArray(d.txs)
    && Array.isArray(d.outputs) && Array.isArray(d.valueflows)
    && (!d.goods || Array.isArray(d.goods)); // 兼容旧备份（无 goods 字段）
}

// 备份文件名：PersonalERP_backup_YYYYMMDD_HHMM.json（分钟级，避免同日覆盖）
function backupFilename() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `PersonalERP_backup_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.json`;
}

// 写入后立即回读比对长度，防「写成功但内容损坏」（事故#1 加固建议）
async function verifyBackupWrite(path, json) {
  try {
    const res = await Filesystem.readFile({ path, directory: Directory.Documents, encoding: Encoding.UTF8 });
    const back = typeof res.data === 'string' ? res.data : '';
    if (back.length !== json.length) {
      toast(`警告：备份回读校验不一致（${back.length}/${json.length}），建议重新导出`, 'err');
    }
  } catch (e) { /* 回读失败不阻断导出（部分 ROM Documents 读受限） */ }
}

// 检测文本是否为二进制乱码：采样前 2KB，可疑字符占比 > 15% 判为二进制
// 可疑 = 控制字符（除 \t\r\n）或 Latin-1 扩展区（0x7F~0x2FFF，base64 解码产物的主要落点；
// 正常中文在 U+4E00 以上、全角标点 U+3000 起，均不落入该区间）
function looksBinary(text) {
  if (!text) return false;
  const sample = text.slice(0, 2048);
  let bad = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || (c >= 0x7f && c < 0x3000) || c === 0xfffd) bad++;
  }
  return bad / sample.length > 0.15;
}

export const Backup = {
  serialize(db) {
    return JSON.stringify({ app: 'personal-erp', version: 1, exportedAt: new Date().toISOString(), db }, null, 2);
  },

  // 校验并解析备份内容 → { ok, db } | { ok:false, error }
  parse(text) {
    // 二进制乱码特征（事故#1）：高比例非可打印字符 → 给出针对性提示而非笼统 JSON 报错
    if (looksBinary(text)) {
      return { ok: false, error: '文件是二进制损坏的备份（导出版本过旧），无法直接导入；请用数据抢救工具还原' };
    }
    const trimmed = String(text ?? '').trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return { ok: false, error: '备份文件已损坏（旧版本导出缺陷所致），数据无法直接导入；原始文件请勿删除' };
    }
    try {
      const obj = JSON.parse(trimmed);
      if (obj && obj.app === 'personal-erp' && obj.db && dbShapeOK(obj.db)) {
        return { ok: true, db: obj.db };
      }
      if (dbShapeOK(obj)) return { ok: true, db: obj };
      return { ok: false, error: '不是有效的 Personal ERP 备份文件' };
    } catch (e) {
      return { ok: false, error: `备份文件已损坏（旧版本导出缺陷所致），数据无法直接导入；原始文件请勿删除（JSON 解析失败：${e.message}）` };
    }
  },

  // 手动导出：native 本地保存（Documents/backups，不调分享）；web 触发 JSON 下载
  async export(db) {
    const json = this.serialize(db);
    const filename = backupFilename();
    if (NATIVE()) {
      try {
        await Filesystem.writeFile({
          path: `backups/${filename}`, data: json, directory: Directory.Documents, recursive: true,
          // ★ 不传 encoding 时 Capacitor 按 base64 解码写入 → JSON 变二进制乱码（事故#1 根因）
          encoding: Encoding.UTF8,
        });
        await verifyBackupWrite(`backups/${filename}`, json);
        Prefs.set({ lastAutoBackup: Date.now() });
        toast(`备份已保存到本地：Documents/backups/${filename}`);
      } catch (e) {
        toast(`导出失败：${e.message || '未知错误'}`, 'err');
      }
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    Prefs.set({ lastAutoBackup: Date.now() });
    toast('备份已下载');
  },

  // 静默本地备份（定时自动备份用）：native 写 Documents/backups；web 存 localStorage 备份历史
  // 返回 { ok, filename } | { ok:false, error }
  async exportLocal(db) {
    const json = this.serialize(db);
    const filename = backupFilename();
    if (NATIVE()) {
      try {
        await Filesystem.writeFile({
          path: `backups/${filename}`, data: json, directory: Directory.Documents, recursive: true,
          encoding: Encoding.UTF8,
        });
        await verifyBackupWrite(`backups/${filename}`, json);
        Prefs.set({ lastAutoBackup: Date.now() });
        return { ok: true, filename };
      } catch (e) {
        return { ok: false, error: e.message || '写入失败' };
      }
    }
    try {
      const list = JSON.parse(localStorage.getItem(WEB_BACKUP_KEY) || '[]');
      list.push({ filename, exportedAt: new Date().toISOString(), data: json });
      while (list.length > MAX_WEB_BACKUPS) list.shift();
      localStorage.setItem(WEB_BACKUP_KEY, JSON.stringify(list));
      Prefs.set({ lastAutoBackup: Date.now() });
      return { ok: true, filename };
    } catch (e) {
      return { ok: false, error: e.message || '本地存储失败' };
    }
  },

  // 最近一次本地备份时间（web 端从备份历史读；原生端由 Prefs.lastAutoBackup 记录）
  lastLocalBackup() {
    if (NATIVE()) return null;
    try {
      const list = JSON.parse(localStorage.getItem(WEB_BACKUP_KEY) || '[]');
      return list.length ? list[list.length - 1].exportedAt : null;
    } catch (e) { return null; }
  },

  // 本地备份清单（最新的在前）：native 读 Documents/backups 目录；web 读 localStorage 备份历史。
  // 让自动备份「看得见、能恢复」——否则用户在 App 里看到已备份却找不到文件 = 假备份。
  async listLocalBackups() {
    if (NATIVE()) {
      try {
        const res = await Filesystem.readdir({ path: 'backups', directory: Directory.Documents });
        return (res.files || [])
          .map((f) => f.name || '')
          .filter((n) => /^PersonalERP_backup_.*\.json$/i.test(n))
          .sort((a, b) => (b < a ? -1 : 1)) // 文件名含时间戳，字典序=时间序（新的在前）
          .map((filename) => ({ filename, source: 'native' }));
      } catch (e) { return []; }
    }
    try {
      const list = JSON.parse(localStorage.getItem(WEB_BACKUP_KEY) || '[]');
      return [...list].reverse().map((b) => ({ filename: b.filename, exportedAt: b.exportedAt, source: 'web' }));
    } catch (e) { return []; }
  },

  // 读取并解析一份本地备份 → { ok, db } | { ok:false, error }
  async readLocalBackup(which) {
    const raw = await this._readLocalRaw(which);
    if (raw == null) return { ok: false, error: '读取备份失败' };
    return Backup.parse(raw);
  },
  async _readLocalRaw(which) {
    if (which && which.source === 'native') {
      try {
        const res = await Filesystem.readFile({
          path: `backups/${which.filename}`, directory: Directory.Documents, encoding: Encoding.UTF8,
        });
        return typeof res.data === 'string' ? res.data : null;
      } catch (e) { return null; }
    }
    try {
      const list = JSON.parse(localStorage.getItem(WEB_BACKUP_KEY) || '[]');
      const b = list.find((x) => x.filename === (which && which.filename));
      return b ? b.data : null;
    } catch (e) { return null; }
  },

  // 调起文件选择，读取后回调 onDone(parsedDb)
  importFromFile(onDone) {
    let input = document.getElementById('erp-import-input');
    if (!input) {
      input = document.createElement('input');
      input.id = 'erp-import-input';
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.style.display = 'none';
      document.body.appendChild(input);
    }
    input.onchange = () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const res = Backup.parse(String(reader.result));
        if (!res.ok) return toast(res.error, 'err');
        onDone(res.db);
      };
      reader.onerror = () => toast('读取文件失败', 'err');
      reader.readAsText(file);
    };
    input.click();
  },

  // 预览：统计将新增 / 同名复用数量（供导入确认）
  inspect: inspectImport,
  // 增量合并导入（同名资源复用，其余按 id 去重）
  merge: mergeImport,
};

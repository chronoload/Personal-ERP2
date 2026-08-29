// ============================================================
// services/errorLog.js
// 全局错误日志（自包含诊断）：
//   install：挂钩 window.onerror + unhandledrejection → 环形缓冲写入 localStorage
//   log / entries / count：手动记录与只读访问（全部静默容错，日志绝不反噬主流程）
//   export：native 写 Documents/perp-errorlog-*.txt；web 触发 txt 下载
// 条目契约：{ ts, kind:'error'|'rejection', msg(≤300), stack(≤600) }
// ============================================================
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { toast } from '../ui/helpers.js';

const NATIVE = () => Capacitor.isNativePlatform();
const LOG_KEY = 'perp_errorlog_v1'; // 环形缓冲（保留最近 50 条，丢最旧）
const LOG_CAP = 50;

// 读取全部条目（损坏/缺失一律按空处理，永不抛错）
function readAll() {
  try {
    const arr = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

// 写回并裁剪到容量上限（超限丢最旧；写失败静默）
function writeAll(list) {
  try {
    while (list.length > LOG_CAP) list.shift();
    localStorage.setItem(LOG_KEY, JSON.stringify(list));
  } catch (e) { /* 存储不可用时静默 */ }
}

// 统一落盘入口：install 钩子与手动 log 共用
function record(kind, msg, err) {
  try {
    const list = readAll();
    list.push({
      ts: Date.now(),
      kind,
      msg: String((err && err.message) || msg || '').slice(0, 300),
      stack: String((err && err.stack) || '').slice(0, 600),
    });
    writeAll(list);
  } catch (e) { /* 日志记录绝不抛错 */ }
}

export const ErrorLog = {
  // 安装全局兜底钩子：同步脚本错误 + 未处理的 Promise 拒绝
  install() {
    try {
      window.onerror = (msg, source, lineno, colno, error) => {
        record('error', `${msg} (${source || '?'}:${lineno || 0}:${colno || 0})`, error);
      };
      window.addEventListener('unhandledrejection', (ev) => {
        const r = ev && ev.reason;
        record('rejection', r instanceof Error ? r.message : String(r), r instanceof Error ? r : null);
      });
    } catch (e) { /* 挂钩失败静默 */ }
  },

  // 手动记录 API
  log(kind, msg, err) {
    record(kind, msg, err);
  },

  // 只读副本（最旧在前、最新在后）
  entries() {
    return readAll().slice();
  },

  count() {
    return readAll().length;
  },

  // 导出可读文本：原生端保存到 Documents 根；网页端触发 txt 下载
  async export() {
    const list = this.entries();
    if (!list.length) return toast('暂无错误日志');
    const text = list.map((it) =>
      `[${new Date(it.ts).toISOString()}] ${it.kind} ${it.msg}\n${it.stack}\n---`,
    ).join('\n');
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const filename = `perp-errorlog-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.txt`;
    if (NATIVE()) {
      try {
        await Filesystem.writeFile({
          path: filename, data: text, directory: Directory.Documents,
          // ★ 不传 encoding 时 Capacitor 按 base64 解码写入 → 文本变二进制乱码（同备份事故#1）
          encoding: Encoding.UTF8,
        });
        toast(`日志已导出到 Documents/${filename}`);
      } catch (e) {
        toast(`导出失败：${e.message || '未知错误'}`, 'err');
      }
      return;
    }
    try {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('日志已下载');
    } catch (e) {
      toast(`导出失败：${e.message || '未知错误'}`, 'err');
    }
  },
};

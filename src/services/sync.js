// ============================================================
// services/sync.js
// 局域网同步：通过 FastAPI 单文件服务（sync_server.py）推送/拉取备份 JSON。
//   push：先比较服务器版本（exportedAt），服务器更新则返回 conflict，由用户决定覆盖
//   pull：GET 服务器最新备份，交给 stats.doImport 做增量合并或全量替换
// 冗余：服务端保留最近 10 份；本地备份历史保留最近 10 份（backup.js）
// ============================================================
import { Backup } from './backup.js';
import { Prefs } from '../store/prefs.js';
import { Capacitor } from '@capacitor/core';

export const Sync = {
  server() {
    return (Prefs.load().syncServer || '').trim().replace(/\/+$/, '');
  },
  setServer(url) {
    const v = (url || '').trim().replace(/\/+$/, '');
    Prefs.set({ syncServer: v });
    if (v) this.addHistory(v);
  },

  // 历史地址（最近 8 个，去重）
  history() {
    const h = Prefs.load().syncHistory;
    return Array.isArray(h) ? h : [];
  },
  addHistory(url) {
    const v = (url || '').trim().replace(/\/+$/, '');
    if (!v) return;
    const h = this.history().filter((x) => x !== v);
    h.unshift(v);
    Prefs.set({ syncHistory: h.slice(0, 8) });
  },

  // 自动检测本机局域网 IP：优先用页面访问地址（location.hostname），否则 WebRTC 探测
  async detectLocalIP() {
    const hn = location.hostname;
    if (hn && hn !== 'localhost' && hn !== '127.0.0.1' && /^\d+\.\d+\.\d+\.\d+$/.test(hn)) {
      return hn;
    }
    return new Promise((resolve) => {
      try {
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('');
        pc.onicecandidate = (e) => {
          if (!e.candidate) { try { pc.close(); } catch (x) {} resolve(null); return; }
          const m = /([0-9]{1,3}(\.[0-9]{1,3}){3})/.exec(e.candidate.candidate);
          if (m) {
            const ip = m[1];
            if (!ip.startsWith('127.') && !ip.startsWith('169.254.')) {
              try { pc.close(); } catch (x) {}
              resolve(ip);
            }
          }
        };
        pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => resolve(null));
        setTimeout(() => { try { pc.close(); } catch (x) {} resolve(null); }, 2500);
      } catch (e) { resolve(null); }
    });
  },

  // 启动命令（供一键复制）
  startCommand(port = 6920) {
    return `python sync_server.py --port ${port}`;
  },

  // ---- 安卓 App 内一键启动同步服务（手机当服务器）----
  nativeAvailable() {
    return Capacitor.isNativePlatform();
  },
  // 插件自检：确认 Capacitor 桥真的连上了原生 Sync 插件（排查「not implemented in Android」）
  async diag() {
    const info = {
      platform: Capacitor.getPlatform(),
      native: Capacitor.isNativePlatform(),
      ua: String(navigator.userAgent).slice(0, 120),
    };
    try {
      const P = Capacitor.registerPlugin('Sync');
      const r = await P.ping();
      return { ...info, ping: 'ok', name: r && r.name };
    } catch (e) {
      return { ...info, ping: 'fail', error: (e && e.message) || String(e) };
    }
  },
  async startServer(port = 6920) {
    if (!this.nativeAvailable()) return { ok: false, error: '仅安卓 App 内支持' };
    try {
      const P = Capacitor.registerPlugin('Sync');
      const r = await P.start({ port });
      return { ok: true, running: r.running, port: r.port, ip: r.ip };
    } catch (e) { return { ok: false, error: e.message || '启动失败' }; }
  },
  async stopServer() {
    if (!this.nativeAvailable()) return { ok: false, error: '仅安卓 App 内支持' };
    try {
      const P = Capacitor.registerPlugin('Sync');
      await P.stop();
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message || '停止失败' }; }
  },
  async serverStatus() {
    if (!this.nativeAvailable()) return { ok: false, running: false };
    try {
      const P = Capacitor.registerPlugin('Sync');
      const r = await P.status();
      return { ok: true, running: r.running, port: r.port, ip: r.ip };
    } catch (e) { return { ok: false, running: false }; }
  },

  async health() {
    const s = this.server();
    if (!s) return { ok: false, error: '未配置服务器地址' };
    try {
      const r = await fetch(`${s}/health`);
      return r.ok ? { ok: true } : { ok: false, error: `服务器响应 ${r.status}` };
    } catch (e) {
      return { ok: false, error: `无法连接：${e.message}` };
    }
  },

  // 推送当前数据到服务器。返回 { ok } | { ok:false, error } | { ok:false, conflict, server }
  async push(db) {
    const s = this.server();
    if (!s) return { ok: false, error: '未配置服务器地址' };
    const json = Backup.serialize(db);
    const mine = JSON.parse(json).exportedAt;
    try {
      // 防冲突（客户端先比较）：服务器更新则提示，不盲目覆盖
      const cur = await fetch(`${s}/backup`);
      if (cur.ok) {
        const serverObj = await cur.json();
        if (serverObj.exportedAt && serverObj.exportedAt > mine) {
          return { ok: false, conflict: true, server: serverObj };
        }
      }
      const r = await fetch(`${s}/backup`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: json,
      });
      if (r.status === 409) {
        const body = await r.json();
        return { ok: false, conflict: true, server: body.server };
      }
      if (!r.ok) return { ok: false, error: `推送失败：${r.status}` };
      Prefs.set({ lastSyncAt: Date.now() });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `无法连接：${e.message}` };
    }
  },

  // 强制覆盖服务器（用户已确认冲突）：跳过客户端比较，服务端 force=1 跳过冲突检查
  async pushForce(db) {
    const s = this.server();
    if (!s) return { ok: false, error: '未配置服务器地址' };
    const json = Backup.serialize(db);
    try {
      const r = await fetch(`${s}/backup?force=1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: json,
      });
      if (!r.ok) return { ok: false, error: `推送失败：${r.status}` };
      Prefs.set({ lastSyncAt: Date.now() });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `无法连接：${e.message}` };
    }
  },

  // 拉取服务器最新备份。返回 { ok, db } | { ok:false, error }
  async pull() {
    const s = this.server();
    if (!s) return { ok: false, error: '未配置服务器地址' };
    try {
      const r = await fetch(`${s}/backup`);
      if (r.status === 404) return { ok: false, error: '服务器暂无备份' };
      if (!r.ok) return { ok: false, error: `拉取失败：${r.status}` };
      const text = await r.text();
      const res = Backup.parse(text);
      if (!res.ok) return { ok: false, error: res.error };
      Prefs.set({ lastSyncAt: Date.now() });
      return { ok: true, db: res.db };
    } catch (e) {
      return { ok: false, error: `无法连接：${e.message}` };
    }
  },
};
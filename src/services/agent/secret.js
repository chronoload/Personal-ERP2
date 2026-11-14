// ============================================================
// services/agent/secret.js
// API Key 的本机混淆存储：
//   · 首次使用时生成随机 32 位十六进制密钥（存 Prefs.agentSecret）
//   · 用 FNV-1a 把密钥扩展成字节流，对明文做 XOR，再 base64
// 说明：这是「不明文落盘」的混淆，不是真正的密钥保险箱（密钥同在本机）。
//       目的是让 localStorage / 备份 / 导出文件里看不到 sk- 开头的原文。
// ============================================================
import { Prefs } from '../../store/prefs.js';

const SECRET_KEY = 'agentSecret';
const PREFIX = 'v1.';

function randomHex(n) {
  const bytes = new Uint8Array(n);
  try {
    crypto.getRandomValues(bytes);
  } catch (e) {
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function getSecret() {
  const p = Prefs.load();
  if (p[SECRET_KEY] && String(p[SECRET_KEY]).length >= 16) return String(p[SECRET_KEY]);
  const s = randomHex(16);
  Prefs.set({ [SECRET_KEY]: s });
  return s;
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function keyBytes() {
  const s = getSecret();
  const out = [];
  for (let i = 0; i < 64; i++) out.push(fnv1a(`${s}:${i}`) & 0xff);
  return out;
}

export function encryptText(text) {
  const t = String(text || '');
  if (!t) return '';
  const ks = keyBytes();
  let raw = '';
  for (let i = 0; i < t.length; i++) raw += String.fromCharCode(t.charCodeAt(i) ^ ks[i % ks.length]);
  try {
    return PREFIX + btoa(unescape(encodeURIComponent(raw)));
  } catch (e) {
    return '';
  }
}

export function decryptText(enc) {
  const s = String(enc || '');
  if (!s) return '';
  if (!s.startsWith(PREFIX)) return s; // 兼容旧的明文
  try {
    const raw = decodeURIComponent(escape(atob(s.slice(PREFIX.length))));
    const ks = keyBytes();
    let out = '';
    for (let i = 0; i < raw.length; i++) out += String.fromCharCode(raw.charCodeAt(i) ^ ks[i % ks.length]);
    return out;
  } catch (e) {
    return '';
  }
}

export function isEncrypted(v) {
  return typeof v === 'string' && v.startsWith(PREFIX);
}

/** 给界面看的掩码：sk-••••abcd */
export function maskKey(plain) {
  const s = String(plain || '');
  if (!s) return '未设置';
  if (s.length <= 8) return '••••';
  return `${s.slice(0, 3)}••••${s.slice(-4)}`;
}

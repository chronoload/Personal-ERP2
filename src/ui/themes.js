// ============================================================
// ui/themes.js
// 背景主题：全局背景 / 任务卡片虚化主题 共用同一套主题结构。
//   theme = null | { type:'gradient', value:'linear-gradient(...)' }
//                | { type:'image', url:'data:image/...' }
// ============================================================
import { icon } from './icons.js';

export const THEMES = [
  { name: '晨曦', value: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)' },
  { name: '青空', value: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
  { name: '暮紫', value: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)' },
  { name: '森林', value: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
  { name: '晚霞', value: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)' },
  { name: '深海', value: 'linear-gradient(135deg, #2b5876 0%, #4e4376 100%)' },
];

export function themeStyle(theme) {
  if (!theme) return null;
  if (theme.type === 'image' && theme.url) return `url(${theme.url}) center / cover no-repeat`;
  if (theme.type === 'gradient' && theme.value) return theme.value;
  return null;
}

// ---------------- 主题校验（纯函数，可单测） ----------------
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
// 允许所有字母（角度单位 deg/turn/grad 里有 d-e-g 之外的字），
// 真正的注入面由 BAD_CSS 拦截，而不是靠缩小字符白名单。
const GRADIENT_RE = /^linear-gradient\([0-9a-zA-Z#,.%\s()\/-]+\)$/i;
const BAD_CSS = /url\s*\(|expression\s*\(|;|["'\\<>]/i;

export function safeGradient(v) {
  if (typeof v !== 'string' || !v || v.length > 300) return null;
  if (GRADIENT_RE.test(v) === false) return null;
  if (BAD_CSS.test(v) || /[\r\n]/.test(v)) return null;
  const hexes = v.match(/#[0-9a-fA-F]+/g) || [];
  if ((v.match(/#/g) || []).length !== hexes.length) return null;
  return hexes.every((h) => COLOR_RE.test(h)) ? v : null;
}

export function safeTheme(t) {
  if (!t || typeof t !== 'object') return null;
  if (t.type === 'gradient') {
    const v = safeGradient(t.value);
    return v ? { type: 'gradient', value: v } : null;
  }
  if (t.type === 'image') {
    const url = t.url;
    if (typeof url === 'string' && url.startsWith('data:image/') && url.length <= 3000000) {
      return { type: 'image', url };
    }
    return null;
  }
  return null;
}

// 全局背景：图片固定铺满（随屏滚动跟随），渐变直接平铺
export function bgStyle(theme) {
  if (!theme) return null;
  if (theme.type === 'image' && theme.url) return `url(${theme.url}) center / cover no-repeat fixed`;
  if (theme.type === 'gradient' && theme.value) return theme.value;
  return null;
}

// 生成一行主题选择按钮（渐变 + 上传图片 + 无），供弹窗/设置页复用
// chosen: 当前主题；onPick(theme): 选中回调；onUpload(file): 上传图片回调
export function themePickerHTML({ chosen }) {
  return `
    <div class="theme-row">
      <button type="button" class="theme-chip t-none ${chosen ? '' : 'on'}" data-t="none">无</button>
      ${THEMES.map((t) => `<button type="button" class="theme-chip ${chosen && chosen.type === 'gradient' && chosen.value === t.value ? 'on' : ''}" data-g="${t.value}" title="${t.name}" style="background:${t.value}"></button>`).join('')}
      <label class="theme-chip t-upload" title="上传图片">${icon('camera')}<input type="file" accept="image/*" style="display:none" class="theme-file"></label>
    </div>`;
}

// 绑定主题选择交互；onPick/onUpload 由调用方传入
export function bindThemePicker(scope, { onPick, onUpload }) {
  const chips = scope.querySelectorAll('.theme-chip');
  chips.forEach((chip) => {
    chip.onclick = () => {
      let theme = null;
      if (chip.dataset.t === 'none') theme = null;
      else if (chip.dataset.g) theme = { type: 'gradient', value: chip.dataset.g };
      chips.forEach((x) => x.classList.toggle('on', x === chip));
      if (onPick) onPick(theme);
    };
  });
  const file = scope.querySelector('.theme-file');
  if (file) file.onchange = () => {
    const f = file.files[0];
    if (f && onUpload) onUpload(f);
  };
}

// 读本地图片为 data URL（自包含存储，离线可用）
export function readImageAsDataURL(file, cb) {
  const r = new FileReader();
  r.onload = () => cb(r.result);
  r.onerror = () => cb(null);
  r.readAsDataURL(file);
}

// ---------------- 智能文字对比度 ----------------
// 卡片主题整卡铺满，按主题真实亮度决定文字：平均亮度 > 150 → 亮底 → 深字(dark)；否则 → 暗底 → 白字(light)
const toneCache = new Map(); // image url -> 'dark'|'light'

function rawLum(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (Number.isNaN(n)) return 180;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
function gradientTone(value) {
  const colors = String(value || '').match(/#[0-9a-fA-F]{6}/g) || [];
  if (!colors.length) return 'dark';
  const avg = colors.reduce((s, c) => s + rawLum(c), 0) / colors.length;
  return avg > 150 ? 'dark' : 'light';
}
// 同步可判定的色调：渐变直接算；图片优先取缓存
export function themeTone(theme) {
  if (!theme) return 'dark';
  if (theme.type === 'gradient') return gradientTone(theme.value);
  if (theme.type === 'image' && theme.url) {
    if (toneCache.has(theme.url)) return toneCache.get(theme.url);
    return null; // 未知：交由异步采样
  }
  return 'dark';
}
// 异步采样图片平均亮度 → 色调（按 url 缓存，会话内不重复计算）
export function sampleImageTone(theme, cb) {
  if (!theme || theme.type !== 'image' || !theme.url) return cb && cb('dark');
  if (toneCache.has(theme.url)) return cb && cb(toneCache.get(theme.url));
  const img = new Image();
  img.onload = () => {
    let tone = 'dark';
    try {
      const c = document.createElement('canvas');
      c.width = Math.min(img.naturalWidth || 64, 64);
      c.height = Math.min(img.naturalHeight || 64, 64);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let sum = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        n++;
      }
      tone = sum / n > 150 ? 'dark' : 'light';
    } catch (e) { tone = 'dark'; }
    toneCache.set(theme.url, tone);
    cb && cb(tone);
  };
  img.onerror = () => { toneCache.set(theme.url, 'dark'); cb && cb('dark'); };
  img.src = theme.url;
}

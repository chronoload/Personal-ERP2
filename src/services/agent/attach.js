// ============================================================
// services/agent/attach.js
// 对话附件：读文件 → 图片压缩成 dataURL / 文本读成字符串。
// 只做本地预处理，不落独立存储；结果随消息 meta 一起进 db。
// ============================================================

export const MAX_FILES = 4;                 // 单条消息最多附件数
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_CHARS = 20000;
const KEEP_ORIGINAL_BYTES = 700 * 1024;     // 小于此值不压缩
const MAX_EDGE = 1280;

export const ACCEPT = 'image/*,text/*,.md,.markdown,.json,.csv,.tsv,.log,.yml,.yaml,.txt,.ics';

let seq = 0;
const uid = () => `at${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const SKIP_NAMES = new Set(['.DS_Store', 'Thumbs.db']);

const TEXT_EXT = /\.(txt|md|markdown|json|csv|tsv|log|yml|yaml|xml|html|css|js|mjs|ts|tsx|jsx|py|java|kt|c|h|cpp|rs|go|sql|sh|ps1|ini|toml|ics)$/i;

function isTextLike(file) {
  if (String(file.type || '').startsWith('text/')) return true;
  if (/json|csv|xml|yaml|javascript|typescript/.test(String(file.type || ''))) return true;
  return TEXT_EXT.test(file.name || '');
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error(`读取失败：${file.name}`));
    r.readAsDataURL(file);
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片无法解码'));
    img.src = url;
  });
}

/** 超过阈值或长边过大时缩放；输出 JPEG 压体积，PNG 截图保留清晰度 */
async function shrinkImage(file, dataUrl) {
  if (file.size <= KEEP_ORIGINAL_BYTES) return { dataUrl, note: `${Math.round(file.size / 1024)}KB` };
  let img;
  try { img = await loadImage(dataUrl); } catch (e) { return { dataUrl, note: '' }; }
  const edge = Math.max(img.width || 1, img.height || 1);
  const scale = Math.min(1, MAX_EDGE / edge);
  const w = Math.max(1, Math.round((img.width || 1) * scale));
  const h = Math.max(1, Math.round((img.height || 1) * scale));
  if (scale === 1 && file.size <= KEEP_ORIGINAL_BYTES * 2) return { dataUrl, note: `${Math.round(file.size / 1024)}KB` };
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { dataUrl, note: '' };
    ctx.drawImage(img, 0, 0, w, h);
    // 透明背景涂白，避免 PNG 失败时 JPEG 出现黑底
    let out = canvas.toDataURL('image/jpeg', 0.85);
    if (out.length > 900 * 1024) out = canvas.toDataURL('image/jpeg', 0.7);
    return { dataUrl: out, note: `${w}×${h}` };
  } catch (e) {
    return { dataUrl, note: '' };
  }
}

/** 单个 File → 附件记录；不支持的图片直接给出 note */
export async function toAttachment(file) {
  const name = String(file.name || '未命名');
  const mime = String(file.type || '');
  const base = {
    id: uid(), name, mime, size: Number(file.size) || 0,
    kind: 'file', dataUrl: '', text: '', note: '',
  };
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(name)) {
    if (file.size > MAX_IMAGE_BYTES) {
      return { ...base, kind: 'image', note: `图片过大（${Math.round(file.size / 1024 / 1024)}MB，上限 10MB）` };
    }
    const raw = await readAsDataURL(file);
    const { dataUrl, note } = await shrinkImage(file, raw);
    return { ...base, kind: 'image', dataUrl, note };
  }
  if (isTextLike(file)) {
    const raw = typeof file.text === 'function' ? await file.text() : '';
    const truncated = raw.length > MAX_TEXT_CHARS;
    return {
      ...base, kind: 'text',
      text: truncated ? raw.slice(0, MAX_TEXT_CHARS) : raw,
      note: truncated ? `已截取前 ${MAX_TEXT_CHARS} 字` : `${Math.round(file.size / 1024)}KB`,
    };
  }
  return { ...base, note: `${mime || '未知类型'} · 仅记录文件名` };
}

/** 用户选中 / 拖入 / 粘贴的一批文件 → 附件数组（最多 MAX_FILES） */
export async function readFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => f && !SKIP_NAMES.has(f.name));
  const out = [];
  const problems = [];
  for (const f of files.slice(0, MAX_FILES)) {
    try {
      out.push(await toAttachment(f));
    } catch (e) {
      problems.push(`${f.name}：${(e && e.message) || '读取失败'}`);
    }
  }
  if (files.length > MAX_FILES) problems.push(`一次最多 ${MAX_FILES} 个附件，多出的已忽略`);
  return { attachments: out, problems };
}

export function sizeText(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

// ============================================================
// services/saveFile.js
// 导出落盘的统一出口（Android 适配）：
//   native（APK）：WebView 里 <a download> 点击是 no-op（无浏览器下载管理器接管），
//     任何走 Blob 下载的导出在 APK 里都是静默失败——统一改写 Filesystem 到
//     Documents/exports/<filename> 并 toast 告知路径（用户文件管理器可见）。
//   web：保持 Blob 下载行为。
// 文本传 string；二进制（如 .pptx 的 zip 容器）传 { bytes: Uint8Array }——
// 原生端按 base64 落盘（Capacitor writeFile 不传 encoding 时即按 base64 解码，恰好契合二进制）。
// 已接入：编辑器「导出 .md」、智能简报「导出 PPTX」。ICS 导出原本就走了原生分支。
// ============================================================
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { toast } from '../ui/helpers.js';

const NATIVE = () => Capacitor.isNativePlatform();

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000; // 分块避免 String.fromCharCode 参数上限
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * 保存/下载文件。
 * @param {string} filename 文件名（如 `erp-2026-9-6.md`）
 * @param {string} mime web 下载的 MIME
 * @param {string|{bytes:Uint8Array}} content 文本，或 { bytes } 二进制
 * @returns {Promise<{ok:boolean, how?:'download'|'native', error?:string}>}
 */
export async function saveFile(filename, mime, content) {
  const isBytes = !!(content && content.bytes instanceof Uint8Array);
  if (!NATIVE()) {
    const blob = new Blob([isBytes ? content.bytes : content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return { ok: true, how: 'download' };
  }
  try {
    await Filesystem.writeFile({
      path: `exports/${filename}`,
      directory: Directory.Documents,
      recursive: true,
      ...(isBytes
        ? { data: bytesToBase64(content.bytes) }
        : { data: String(content), encoding: Encoding.UTF8 }),
    });
    toast(`已保存到本地：Documents/exports/${filename}`);
    return { ok: true, how: 'native' };
  } catch (e) {
    toast(`保存失败：${(e && e.message) || '未知错误'}`, 'err');
    return { ok: false, error: (e && e.message) || '未知错误' };
  }
}

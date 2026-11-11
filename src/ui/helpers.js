// ============================================================
// ui/helpers.js
// UI 基础工具：DOM 构建、弹窗、Toast、格式化、状态徽章
// ============================================================

import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { icon } from './icons.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function fmtNum(n, digits = 0) {
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: digits });
}

export function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${fmtDate(ts)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtDuration(min) {
  if (!min) return '';
  return min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}` : `${min}m`;
}

// 状态徽章配色映射（统一状态语义）
export function badgeClass(state) {
  const map = {
    Planned: 'b-muted', Started: 'b-blue', Completed: 'b-green',
    Reviewed: 'b-amber', Archived: 'b-gray',
    Incubating: 'b-purple', Active: 'b-blue', Paused: 'b-amber',
    Draft: 'b-gray', Published: 'b-blue',
    Pending: 'b-amber', Overdue: 'b-red', Closed: 'b-green',
    Active_: 'b-green', Inactive: 'b-gray',
  };
  return map[state] || 'b-gray';
}

export function badge(state, label) {
  return `<span class="badge ${badgeClass(state)}">${esc(label || state)}</span>`;
}

// ---------- Toast ----------
let toastTimer = null;
export function toast(msg, type = 'info') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = esc(msg);
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    root.querySelectorAll('.toast.show').forEach((t) => t.classList.remove('show'));
    setTimeout(() => (root.innerHTML = ''), 300);
  }, 2600);
}

// ---------- Modal（通用）----------
// accent: brand(默认·创建) | info(执行/兑换) | ok(闭环/反馈) | warn(严格/完成) | danger(危险/冲正)
export function openModal({ title, bodyHTML, footerHTML, width = 520, accent = 'brand' }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-mask" onclick="this.dataset.closing=1;this.classList.add('closing');setTimeout(()=>{this.remove()},180)">
      <div class="modal-panel accent-${accent}" style="max-width:${width}px" onclick="event.stopPropagation()">
        <div class="modal-head">
          <h3>${esc(title)}</h3>
          <button class="icon-btn" data-close>${icon('close')}</button>
        </div>
        <div class="modal-body">${bodyHTML}</div>
        ${footerHTML ? `<div class="modal-foot">${footerHTML}</div>` : ''}
      </div>
    </div>`;
  const mask = root.querySelector('.modal-mask');
  mask.querySelector('[data-close]').onclick = () => closeModal(mask);
  // 填写交互优化：Esc 关闭；Enter 提交（输入框内回车 = 提交所在区域的主按钮）
  mask.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(mask); return; }
    if (e.key !== 'Enter' || e.shiftKey) return;
    const t = e.target;
    if (!t || (t.tagName !== 'INPUT' && t.tagName !== 'SELECT')) return;
    if (t.type === 'checkbox' || t.type === 'radio' || t.type === 'button' || t.type === 'file') return;
    e.preventDefault();
    const zone = t.closest('[data-enter-zone]') || mask;
    const btn = [...zone.querySelectorAll('[data-enter]')].find((b) => b.offsetParent !== null)
      || zone.querySelector('[data-save]');
    if (btn) btn.click();
  });
  return {
    el: mask,
    close: () => closeModal(mask),
    q: (sel) => mask.querySelector(sel),
    qa: (sel) => mask.querySelectorAll(sel),
  };
}

export function closeModal(mask) {
  if (!mask) return;
  mask.classList.add('closing');
  setTimeout(() => mask.remove(), 180);
}

// 快捷按钮生成
export function btn(label, onclick, { cls = '', disabled = false } = {}) {
  return `<button class="btn ${cls}" ${disabled ? 'disabled' : ''} onclick="${onclick}">${esc(label)}</button>`;
}

// 资源稳定配色（按 id 哈希）：顶栏标签 / 流水圆点等共用
export function resColor(id) {
  const colors = ['#596271', '#4a7fbf', '#7c6cff', '#3da06a', '#c98a2b', '#d05a7a'];
  return colors[Math.abs(String(id).split('').reduce((s, c) => s + c.charCodeAt(0), 0)) % colors.length];
}

// 空态占位
export function empty(text, hint = '') {
  return `<div class="empty">${esc(text)}${hint ? `<div class="muted">${esc(hint)}</div>` : ''}</div>`;
}

// ---- 触觉反馈（仅关键节点调用；web 端 Capacitor 无操作，天然降级）----
export async function haptic(kind = 'light') {
  try {
    if (kind === 'success') await Haptics.notification({ type: NotificationType.Success });
    else await Haptics.impact({ style: kind === 'heavy' ? ImpactStyle.Heavy : ImpactStyle.Light });
  } catch (e) { /* 不支持的平台静默 */ }
}

// ---- 余额数字滚动变色（账本心跳）----
export function animateBalance(resourceId, fromVal, toVal, digits = 0) {
  const el = document.querySelector(`[data-res-balance="${resourceId}"]`);
  if (!el) return;
  el.classList.add(toVal >= fromVal ? 'bal-up' : 'bal-down');
  const t0 = performance.now(), dur = 400;
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3); // ease-out
    el.firstChild.nodeValue = fmtNum(fromVal + (toVal - fromVal) * eased, digits);
    if (p < 1) requestAnimationFrame(tick);
    else setTimeout(() => el.classList.remove('bal-up', 'bal-down'), 600);
  };
  requestAnimationFrame(tick);
}

// ============================================================
// ui/gestures.js
// 卡片手势工具层：纯函数判定核心（可单测）+ DOM 绑定。
// 安全边界：方向锁 12px、滑动触发阈值 64px、长按 500ms；
// 纵向滑动永远返回 null（不抢页面滚动）。
// ============================================================

const MOVE_LOCK = 12;   // 方向锁：超过此位移锁定轴向
const SWIPE_DIST = 64;  // 滑动触发距离
const LONG_MS = 500;    // 长按时长

export function resolveGesture({ dx, dy, durMs, longFired = false }, opts = {}) {
  const swipeDist = opts.swipeDist ?? SWIPE_DIST;
  const dist = Math.abs(dx);
  const vdist = Math.abs(dy);
  // 长按优先：计时器已触发且基本没挪动
  if (longFired && Math.hypot(dx, dy) < MOVE_LOCK) return 'long';
  // 轴向已锁横且距离够 → 滑动
  if (dist > vdist && dist >= swipeDist) return dx > 0 ? 'right' : 'left';
  // 纵向大幅滑动留给页面滚动
  if (vdist >= dist && Math.hypot(dx, dy) >= MOVE_LOCK * 2) return null;
  // 未构成滑动的小动作按点击处理（长按由计时器负责，此处 dur 仅参考）
  return 'tap';
}

export function attachCard(el, handlers, opts = {}) {
  let sx = 0, sy = 0, st = 0, locked = false, longTimer = null, longFired = false, active = false;

  const clearLong = () => { if (longTimer) { clearTimeout(longTimer); longTimer = null; } };
  const fire = (g, x, y) => {
    if (g === 'tap' && handlers.onTap) handlers.onTap(x, y);
    else if (g === 'long' && handlers.onLongPress) handlers.onLongPress(x, y);
    else if (g === 'right' && handlers.onSwipeRight) handlers.onSwipeRight(x, y);
    else if (g === 'left' && handlers.onSwipeLeft) handlers.onSwipeLeft(x, y);
  };

  const onStart = (e) => {
    const t = e.touches[0];
    sx = t.clientX; sy = t.clientY; st = Date.now();
    active = true; locked = false; longFired = false;
    clearLong();
    longTimer = setTimeout(() => {
      if (!active) return;
      longFired = true;
      fire('long', sx, sy);
    }, opts.longMs ?? LONG_MS);
  };
  const onMove = (e) => {
    if (!active || locked) return;
    const t = e.touches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.hypot(dx, dy) > MOVE_LOCK) {
      locked = true;          // 轴向锁定后取消长按意图
      clearLong();
      // 右滑跟手预览：露出底层 ✓ 层（CSS 类由调用方样式定义）
      if (handlers.onSwipePreview && dx > 0 && Math.abs(dx) > Math.abs(dy)) {
        handlers.onSwipePreview(Math.min(dx, SWIPE_DIST));
      }
    }
  };
  const onEnd = (e) => {
    if (!active) return;
    if (longFired) { active = false; clearLong(); if (handlers.onSwipePreviewEnd) handlers.onSwipePreviewEnd(); return; }
    active = false; clearLong();
    const t = e.changedTouches[0];
    const g = resolveGesture({
      dx: t.clientX - sx, dy: t.clientY - sy,
      durMs: Date.now() - st, longFired,
    }, opts);
    if (handlers.onSwipePreviewEnd) handlers.onSwipePreviewEnd();
    if (g) fire(g, t.clientX, t.clientY);
  };

  const onCancel = () => { active = false; clearLong(); };
  el.addEventListener('touchstart', onStart, { passive: true });
  el.addEventListener('touchmove', onMove, { passive: true });
  el.addEventListener('touchend', onEnd);
  el.addEventListener('touchcancel', onCancel);
  // 返回解绑函数（测试/重渲染时用）
  return () => {
    el.removeEventListener('touchstart', onStart);
    el.removeEventListener('touchmove', onMove);
    el.removeEventListener('touchend', onEnd);
    el.removeEventListener('touchcancel', onCancel);
    clearLong();
  };
}

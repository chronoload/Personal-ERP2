// ============================================================
// ui/icons.js
// 内联 SVG 图标：替代界面里的 unicode 占位字形（▶ ● ✓ ✕ ▸ …）。
//   · 24 网格 / 1.8 描边 / currentColor：跟随文字颜色与字号，无需图片资源
//   · 纯函数输出字符串，可直接拼进模板字符串；不依赖 DOM
//   · 只放「界面图形」语义；toast / 导出 / 注释里的文本符号保持原样
// ============================================================

// 描边图标（默认）
const STROKE = {
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M4.5 12.5l5 5L19.5 6.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  'arrow-left': '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  'arrow-up': '<path d="M12 19V5M6 11l6-6 6 6"/>',
  'arrow-down': '<path d="M12 5v14M6 13l6 6 6-6"/>',
  'chevron-down': '<path d="M6 9l6 6 6-6"/>',
  'chevron-right': '<path d="M9 6l6 6-6 6"/>',
  'chevron-up': '<path d="M6 15l6-6 6 6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  refresh: '<path d="M20 12a8 8 0 10-2.3 5.7"/><path d="M20 5v6h-6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alarm: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 1.5M5 3.5L3 5.5M19 3.5L21 5.5"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  archive: '<path d="M4 7h16v3H4z"/><path d="M6 10v9h12v-9M10 13.5h4"/>',
  note: '<path d="M4 20h4L20 8l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  chart: '<path d="M4 20V11M10 20V4M16 20v-6M22 20V7"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  book: '<path d="M5 4a2 2 0 012-2h11v20H7a2 2 0 01-2-2z"/><path d="M9 2v20"/>',
  file: '<path d="M6 2h7l5 5v15H6z"/><path d="M13 2v5h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>',
  edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3"/><path d="M6 7l1 14h10l1-14"/>',
  warning: '<path d="M12 3l9.5 17h-19z"/><path d="M12 9v5M12 17.2v.2"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  upload: '<path d="M12 20V8M7 13l5-5 5 5"/><path d="M4 4h16"/>',
  bag: '<path d="M6 8h12l1 13H5z"/><path d="M9 8V6a3 3 0 016 0v2"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  dot: '<circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/>',
  tomato: '<circle cx="12" cy="14" r="7"/><path d="M12 7c0-2 1.5-3.5 3.5-3.5M12 7c0-2-1.5-3.5-3.5-3.5M12 7v-1"/>',
  filter: '<path d="M4 6h16l-6 7v6l-4 2v-8z"/>',
  pin: '<path d="M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  link: '<path d="M10 14a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1"/><path d="M14 10a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  flag: '<path d="M5 21V4h9l1 3h5v9h-6l-1-3H5"/>',
  tag: '<path d="M4 4h8l8 8-8 8-8-8z"/><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/>',
  'trend-up': '<path d="M4 17l6-6 4 4 6-7"/><path d="M20 8h-4M20 8v4"/>',
  calculator: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h.01M12 11h.01M15 11h.01M9 14h.01M12 14h.01M15 14h.01M9 17h3M15 17h.01"/>',
  eye: '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  flask: '<path d="M9 3h6M10 3v6l-5.2 9.4A2 2 0 006.5 21h11a2 2 0 001.7-2.6L14 9V3"/><path d="M7.5 15h9"/>',
  camera: '<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.4"/><path d="M8 7l1.5-3h5L16 7"/>',
  car: '<path d="M4 16v-3.6L6.2 7h11.6L20 12.4V16"/><path d="M4 16h16"/><circle cx="7.5" cy="17.5" r="1.6"/><circle cx="16.5" cy="17.5" r="1.6"/><path d="M5 12h14"/>',
  backspace: '<path d="M9 5h11v14H9L3 12z"/><path d="M12 9.5l5 5M17 9.5l-5 5"/>',
  lightbulb: '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 00-3.5 10.9V16h7v-2.1A6 6 0 0012 3z"/>',
  scale: '<path d="M12 3v18M7 21h10M4 7h16"/><path d="M4 7l-2 5h4zM20 7l-2 5h4z"/>',
  gauge: '<path d="M3.5 17a8.5 8.5 0 1117 0"/><path d="M12 17l4.2-5.2"/>',
};

// 填充图标（实心，用于强调 / 状态点）
const FILL = {
  bolt: '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
  star: '<path d="M12 3l2.7 5.9 6.3.6-4.8 4.2 1.4 6.3L12 16.8 6.4 20l1.4-6.3L3 9.5l6.3-.6z"/>',
  'dot-fill': '<circle cx="12" cy="12" r="5"/>',
};

/**
 * 生成一个内联 SVG 图标。
 * @param {string} name 图标名（见 STROKE / FILL）
 * @param {string} [cls] 追加 class（如 "sm"）
 */
export function icon(name, cls = '') {
  const fill = FILL[name];
  const body = fill || STROKE[name] || '';
  const paint = fill ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg class="ico${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" ${paint} aria-hidden="true" focusable="false">${body}</svg>`;
}

/** 纯文本场景（toast / 导出 / 通知）不换图标，这里只暴露可用性判断，便于测试 */
export function hasIcon(name) {
  return !!(STROKE[name] || FILL[name]);
}

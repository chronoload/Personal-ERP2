// ============================================================
// store/prefs.js
// 轻量偏好记忆：记住用户上次的输入习惯，用于「按语境预填」，
// 让新建/完成时只需快速调整。
// ============================================================
const KEY = 'personal_erp_prefs';
// 缺省值：未设置过的偏好按此回退（存储值覆盖同名缺省）
const DEFAULTS = {
  remindBeforeMin: 15, failGraceMin: 30,
  reportRemind: true, // 周/月报通知提醒开关
  reportModules: { activity: true, ledger: true, plan: true, balance: true, vf: true }, // 报告模块配置
  hudEnabled: false, // HUD 侧边栏开关（目标→计划→活动 层级树）
  nightTheme: 'auto', // 界面夜间模式：auto 跟随系统 / light 浅色 / dark 深色
  smartRecommend: true, // L3 智能推荐开关：按历史习惯推荐「一键新建」新活动（可彻底关闭）
  topbarMode: 'full', // 上部整体布局：full 完整顶栏 / compact 顶栏紧凑(仅图标) / left 左侧边栏 / right 右侧边栏 / hidden 完全收起
  homeTodayWidget: true, // 开屏首页 · 今日日程大片开关（安卓原生卡片读它）
  lockScreenToday: false, // 锁屏常驻通知 + 开屏页开关（默认关，需用户主动打开）
  lockScreenFull: true, // 亮屏时是否整页盖在锁屏（系统未允许全屏通知时自动降级）
};

export const Prefs = {
  load() {
    try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; } catch (e) { return { ...DEFAULTS }; }
  },
  set(patch) {
    const p = this.load();
    Object.assign(p, patch);
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {}
  },
};

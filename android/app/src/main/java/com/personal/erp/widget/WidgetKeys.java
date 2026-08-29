package com.personal.erp.widget;

/**
 * JS 侧与原生侧共享的存储契约（集中管理，避免散落硬编码）：
 *  - SharedPreferences 文件名 "CapacitorStorage"
 *  - db / prefs / snapshot 三个 key
 * JS 侧对应：src/store/db.js (personal_erp_db_v1)、src/store/prefs.js (personal_erp_prefs)、src/services/widget.js (widget_snapshot)
 */
public final class WidgetKeys {
  public static final String PREFS_FILE = "CapacitorStorage";
  public static final String KEY_DB = "personal_erp_db_v1";
  public static final String KEY_PREFS = "personal_erp_prefs";
  public static final String KEY_SNAP = "widget_snapshot";
  public static final String KEY_CONFIG = "widget_config";
  public static final String KEY_REV = "widget_db_rev";
  // 计时器跨进程锚点（JSON：target/sec/sessionStart/mode/endTs/remainingMs/ts）
  public static final String KEY_TIMER = "personal_erp_timer";
  private WidgetKeys() {}
}
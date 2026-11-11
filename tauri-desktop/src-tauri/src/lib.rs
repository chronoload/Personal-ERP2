// Personal ERP · Tauri 2 桌面壳
//
// 后台持续运行的自主服务
// 标准桌面窗口承载完整前端。壳只做三件事，页面逻辑不改：
//   1. 标准可缩放窗口（无浮条/托盘特殊形态）；tray-icon 特性关闭
//   2. 单实例：重复启动只唤出已有窗口
//   3. read_text_file：配合前端文件选择对话框读取文本备份/导入

use std::fs;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use tauri::{Manager, WebviewWindow};

/// 读取文本文件内容（配合前端文件选择对话框使用）
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("读取失败：{e}"))
}

/// erp-db.json 的绝对路径：使用 Tauri 解析的应用数据目录
/// （标识符 com.personal.erp.desktop → C:\Users\<user>\AppData\Local\com.personal.erp.desktop\erp-db.json）
/// 与 WorkBuddy MCP（personal_erp_mcp/server.py）写入的是同一文件，实现双向同步。
fn erp_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法解析应用数据目录：{e}"))?;
    // 确保目录存在（首次启动时 app_data_dir 可能尚未创建）
    let _ = fs::create_dir_all(&dir);
    Ok(dir.join("erp-db.json"))
}

/// 读取 erp-db.json（MCP / 定时任务共用的数据文件）。文件不存在返回 None。
#[tauri::command]
fn read_erp_db(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let p = erp_db_path(&app)?;
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(&p)
        .map(Some)
        .map_err(|e| format!("读取 erp-db.json 失败：{e}"))
}

/// 原子写入 erp-db.json：先写临时文件再重命名，避免半截文件被前端读走。
#[tauri::command]
fn write_erp_db(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let p = erp_db_path(&app)?;
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, content.as_bytes()).map_err(|e| format!("写入临时文件失败：{e}"))?;
    fs::rename(&tmp, &p).map_err(|e| format!("重命名失败：{e}"))
}

/// 返回 erp-db.json 的修改时间（毫秒时间戳）；文件不存在返回 None。
/// 供前端轮询判断「是否有外部程序（MCP / 定时任务）改动了文件」。
#[tauri::command]
fn stat_erp_db(app: tauri::AppHandle) -> Result<Option<f64>, String> {
    let p = erp_db_path(&app)?;
    if !p.exists() {
        return Ok(None);
    }
    let meta = fs::metadata(&p).map_err(|e| format!("stat 失败：{e}"))?;
    let mtime = meta
        .modified()
        .map_err(|e| format!("读取修改时间失败：{e}"))?;
    let ms = mtime
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("{e}"))?
        .as_secs_f64()
        * 1000.0;
    Ok(Some(ms))
}

/// 显示主窗口（单实例回调 / 前端请求聚焦用）
fn show_main(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// 前端请求聚焦主窗口（可选；后端不依赖）
#[tauri::command]
fn focus_main_window(window: WebviewWindow) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        // 只允许一个实例：重复启动唤出已有窗口
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app;
            show_main(app);
        }))
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            focus_main_window,
            read_erp_db,
            write_erp_db,
            stat_erp_db
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
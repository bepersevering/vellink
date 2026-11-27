mod fs;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // 自动更新：检查/下载/验签由 updater 负责，装完重启由 process 负责
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(fs::WatchState::default())
        .invoke_handler(tauri::generate_handler![
            fs::fs_default_root,
            fs::fs_ensure_dir,
            fs::fs_list_markdown,
            fs::fs_read_markdown,
            fs::fs_write_markdown,
            fs::fs_trash_markdown,
            fs::fs_rename_markdown,
            fs::fs_watch_start,
            fs::fs_watch_stop,
            fs::fs_reveal,
            fs::export_write_text,
            fs::export_write_bytes,
            fs::export_print,
            fs::fs_write_asset,
            fs::fs_read_asset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running vellink");
}

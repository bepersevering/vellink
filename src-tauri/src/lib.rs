mod fs;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            fs::fs_default_root,
            fs::fs_ensure_dir,
            fs::fs_list_markdown,
            fs::fs_read_markdown,
            fs::fs_write_markdown,
            fs::fs_trash_markdown,
            fs::fs_rename_markdown,
            fs::fs_reveal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running vellink");
}

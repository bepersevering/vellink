//! 本地 Markdown 文件系统命令。
//!
//! 只暴露「一个工作区目录里的 .md 文件」这一层能力，不做通用 fs：
//! 读写删全部限制在 Markdown 扩展名内，删除是移动到 `.vellink-trash/`
//! 而不是真删，避免编辑器误删用户唯一一份稿子。
//!
//! 写入走「临时文件 + rename」，Crash 或断电时不会留下半截文件。
//!
//! 另外提供一个目录监听器：外部编辑器、git pull、同步盘改动会以事件形式推给
//! 前端，取代固定间隔轮询。

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{Emitter, Manager};

/// 前端监听的事件名；payload 是发生变化的路径列表。
const WATCH_EVENT: &str = "vellink://fs-changed";

/// 一份 Markdown 文件的元信息；`path` 是绝对路径，也被前端当作文档 id。
#[derive(Serialize)]
pub struct FsEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
    /// 修改时间（Unix 毫秒），前端用它判断文件是否被外部改动。
    pub modified: u64,
}

const MARKDOWN_EXTS: [&str; 2] = ["md", "markdown"];
/// 图片资产的目录名（点开头：列举笔记时会跳过，不会被当成文档）。
const ASSET_DIR: &str = ".vellink-assets";
const ASSET_EXTS: [&str; 5] = ["png", "jpg", "jpeg", "gif", "webp"];
/// 单张图片上限 20MB，和前端的 MAX_IMAGE_BYTES 保持一致。
const MAX_ASSET_BYTES: usize = 20 * 1024 * 1024;
/// 递归列举的最大深度：笔记目录再深也不该超过这个层数。
const MAX_DEPTH: usize = 6;
/// 这些目录一定不是写作内容，跳过以免列举 node_modules 卡死。
const SKIP_DIRS: [&str; 5] = ["node_modules", "target", "dist", "build", "vendor"];

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| MARKDOWN_EXTS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// 自己制造的噪音：回收目录、原子写的临时文件、隐藏文件。
fn is_ignored(path: &Path) -> bool {
    if path
        .components()
        .any(|part| part.as_os_str() == ".vellink-trash")
    {
        return true;
    }
    let Some(name) = path.file_name().map(|name| name.to_string_lossy()) else {
        return true;
    };
    name.starts_with('.') || name.ends_with(".vellink.tmp")
}

fn to_string_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn entry_of(path: &Path) -> FsEntry {
    let meta = fs::metadata(path).ok();
    FsEntry {
        path: to_string_path(path),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default(),
        size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
        modified: modified_ms(path),
    }
}

/// 校验并规范化一个 Markdown 文件路径；拒绝目录与非 Markdown 文件。
fn markdown_path(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err(format!("路径必须是绝对路径: {raw}"));
    }
    if !is_markdown(&path) {
        return Err(format!("只允许操作 .md / .markdown 文件: {raw}"));
    }
    Ok(path)
}

/// 去掉 UTF-8 BOM 并把 CRLF / 孤立 CR 统一成 LF。
///
/// 编辑器内部只用 `\n` 作为换行，Windows 文件直接读进来会导致每个块尾多一个
/// 不可见字符、往返序列化不相等；入口处统一比在每个视图里兼容便宜得多。
fn normalize_text(raw: String) -> String {
    let without_bom = raw.strip_prefix('\u{feff}').unwrap_or(&raw).to_string();
    without_bom.replace("\r\n", "\n").replace('\r', "\n")
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<FsEntry>) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for item in entries.flatten() {
        let path = item.path();
        // 符号链接目录可能成环，一律不跟进
        let Ok(file_type) = item.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            let name = item.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            walk(&path, depth + 1, out);
        } else if is_markdown(&path) {
            out.push(entry_of(&path));
        }
    }
}

/// 默认工作区：`~/Documents/Vellink`（拿不到文档目录时退回家目录）。
#[tauri::command]
pub fn fs_default_root(app: tauri::AppHandle) -> Result<String, String> {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|err| format!("无法定位文档目录: {err}"))?;
    Ok(to_string_path(&base.join("Vellink")))
}

#[tauri::command]
pub fn fs_ensure_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|err| format!("创建目录失败 {path}: {err}"))
}

/// 递归列举工作区里的全部 Markdown 文件，按修改时间倒序。
#[tauri::command]
pub fn fs_list_markdown(root: String) -> Result<Vec<FsEntry>, String> {
    let path = PathBuf::from(&root);
    if !path.is_dir() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    walk(&path, 0, &mut files);
    files.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(files)
}

#[tauri::command]
pub fn fs_read_markdown(path: String) -> Result<String, String> {
    let target = markdown_path(&path)?;
    let raw = fs::read_to_string(&target).map_err(|err| format!("读取失败 {path}: {err}"))?;
    Ok(normalize_text(raw))
}

/// 原子写：先写同目录临时文件并 fsync，再 rename 覆盖。
///
/// 半截文件和「写完但还在页缓存里」的结果都不该被用户看到：断电或崩溃时
/// 目标文件要么是旧内容，要么是新内容。
fn write_atomic_bytes(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let path = to_string_path(target);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("创建目录失败: {err}"))?;
    }

    let file_name = target
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "document.md".to_string());
    let temp = target.with_file_name(format!(".{file_name}.vellink.tmp"));

    {
        let mut file = File::create(&temp).map_err(|err| format!("写入失败 {path}: {err}"))?;
        file.write_all(bytes)
            .map_err(|err| format!("写入失败 {path}: {err}"))?;
        file.sync_all()
            .map_err(|err| format!("落盘失败 {path}: {err}"))?;
    }

    fs::rename(&temp, target).map_err(|err| {
        let _ = fs::remove_file(&temp);
        format!("替换文件失败 {path}: {err}")
    })
}

fn write_atomic(target: &Path, contents: &str) -> Result<(), String> {
    write_atomic_bytes(target, contents.as_bytes())
}

/// 写入 Markdown：必要时补建目录，先写临时文件再 rename 覆盖。
#[tauri::command]
pub fn fs_write_markdown(path: String, contents: String) -> Result<FsEntry, String> {
    let target = markdown_path(&path)?;
    write_atomic(&target, &contents)?;
    Ok(entry_of(&target))
}

/// 把文件移到回收目录（而不是删除），返回移动后的路径。
///
/// 显式声明 `snake_case`：这是唯一带下划线的参数，不依赖 Tauri 的默认重命名规则，
/// 前端发什么就是什么，避免 IPC 层悄悄改名导致「删除无反应」。
#[tauri::command(rename_all = "snake_case")]
pub fn fs_trash_markdown(path: String, trash_dir: String) -> Result<String, String> {
    let source = markdown_path(&path)?;
    fs::create_dir_all(&trash_dir).map_err(|err| format!("创建回收目录失败: {err}"))?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let name = source
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "document.md".to_string());

    let mut destination = PathBuf::from(&trash_dir).join(format!("{stamp}-{name}"));
    let mut index = 2;
    while destination.exists() {
        destination = PathBuf::from(&trash_dir).join(format!("{stamp}-{index}-{name}"));
        index += 1;
    }

    fs::rename(&source, &destination).map_err(|err| format!("移动到回收目录失败: {err}"))?;
    Ok(to_string_path(&destination))
}

#[tauri::command]
pub fn fs_rename_markdown(from: String, to: String) -> Result<FsEntry, String> {
    let source = markdown_path(&from)?;
    let target = markdown_path(&to)?;
    if target.exists() {
        return Err(format!("目标文件已存在: {to}"));
    }
    fs::rename(&source, &target).map_err(|err| format!("重命名失败: {err}"))?;
    Ok(entry_of(&target))
}

/// 导出允许落盘的扩展名。这里不含 `.pdf`：PDF 由系统打印面板写出，
/// 应用自己不做 PDF 编码。
const EXPORT_EXTS: [&str; 7] = ["md", "markdown", "html", "htm", "docx", "epub", "odt"];

/// 校验导出目标：必须是绝对路径，且扩展名在白名单里。
///
/// 与 `markdown_path` 分开是刻意的：工作区只认 `.md`（防止编辑器把任意文件
/// 当笔记打开），导出要能写 `.html`；两套白名单混用迟早会放开错的那一个。
fn export_target(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err(format!("导出路径必须是绝对路径: {raw}"));
    }
    let allowed = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| EXPORT_EXTS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false);
    if !allowed {
        return Err(format!("不支持导出的扩展名: {raw}"));
    }
    Ok(path)
}

/// 写一个导出文件（Markdown / HTML），同样是原子写。
#[tauri::command]
pub fn export_write_text(path: String, contents: String) -> Result<(), String> {
    let target = export_target(&path)?;
    write_atomic(&target, &contents)
}

/// 导出二进制格式（DOCX / EPUB / ODT）：字节经 IPC 传来，同样原子写。
#[tauri::command]
pub fn export_write_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    let target = export_target(&path)?;
    write_atomic_bytes(&target, &data)
}

/// 调起系统打印对话框。
///
/// PDF 不走自建渲染器：系统打印面板本来就能「存储为 PDF」，字体、分页、
/// 中文断行全交给平台，比在应用里重造一套排版可靠得多。
#[tauri::command]
pub fn export_print(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到主窗口".to_string())?;
    window.print().map_err(|err| format!("调起打印失败: {err}"))
}

/// 导入 Markdown 时读源文件旁边的图片：必须是绝对路径 + 图片扩展名。
#[tauri::command]
pub fn fs_read_image(path: String) -> Result<Vec<u8>, String> {
    let target = PathBuf::from(&path);
    if !target.is_absolute() {
        return Err(format!("路径必须是绝对路径: {path}"));
    }
    let ext = target
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp") {
        return Err(format!("只允许读取图片: {path}"));
    }
    fs::read(&target).map_err(|err| format!("读取图片失败 {path}: {err}"))
}

/* ------------------------------ 图片资产 ------------------------------ */

/// 资产文件名只接受「一个普通文件名 + 图片扩展名」。
///
/// 名字来自前端的 slug + 内容哈希，但 IPC 传来的东西一律不可信：
/// 带分隔符或 `..` 就会跳出资源目录，点开头会变成隐藏文件，
/// SVG 能带脚本，所以也不收。
fn asset_target(root: &str, name: &str) -> Result<PathBuf, String> {
    let dir = PathBuf::from(root);
    if !dir.is_absolute() {
        return Err(format!("工作区路径必须是绝对路径: {root}"));
    }
    if name.is_empty()
        || name.len() > 128
        || name.starts_with('.')
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
    {
        return Err(format!("非法的资产文件名: {name}"));
    }
    let ext = Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default();
    if !ASSET_EXTS.contains(&ext.as_str()) {
        return Err(format!("不支持的图片格式: {name}"));
    }
    Ok(dir.join(ASSET_DIR).join(name))
}

/// 写入一张图片，返回 Markdown 里用的相对路径。
#[tauri::command]
pub fn fs_write_asset(root: String, name: String, data: Vec<u8>) -> Result<String, String> {
    if data.len() > MAX_ASSET_BYTES {
        return Err(format!("图片超过 20MB（{} 字节）", data.len()));
    }
    let target = asset_target(&root, &name)?;
    write_atomic_bytes(&target, &data)?;
    Ok(format!("{ASSET_DIR}/{name}"))
}

/// 导出 HTML / PDF 时读回图片，交给前端转 data URI。
#[tauri::command]
pub fn fs_read_asset(root: String, name: String) -> Result<Vec<u8>, String> {
    let target = asset_target(&root, &name)?;
    fs::read(&target).map_err(|err| format!("读取图片失败 {}: {err}", to_string_path(&target)))
}

/// 列出工作区资产目录里的文件名（只给名字，不读内容）。
#[tauri::command]
pub fn fs_list_assets(root: String) -> Result<Vec<String>, String> {
    let dir = PathBuf::from(&root).join(".vellink-assets");
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for entry in fs::read_dir(&dir).map_err(|err| format!("列举资产失败: {err}"))? {
        let entry = entry.map_err(|err| format!("列举资产失败: {err}"))?;
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            if let Some(name) = entry.file_name().to_str() {
                out.push(name.to_string());
            }
        }
    }
    Ok(out)
}

/// 把孤立资产移到回收站（不直接删除，保留恢复可能）。
#[tauri::command(rename_all = "snake_case")]
pub fn fs_trash_asset(root: String, name: String, trash_dir: String) -> Result<String, String> {
    let asset = asset_target(&root, &name)?;
    fs::create_dir_all(&trash_dir).map_err(|err| format!("创建回收目录失败: {err}"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let target = PathBuf::from(&trash_dir).join(format!("{}-{}", stamp, name));
    fs::rename(&asset, &target).map_err(|err| format!("回收资产失败: {err}"))?;
    Ok(to_string_path(&target))
}

/// 当前工作区的目录监听器；换目录时整体替换，旧的自然被 drop 停止。
#[derive(Default)]
pub struct WatchState(pub Mutex<Option<RecommendedWatcher>>);

/// 开始监听一个目录（递归）。
///
/// 事件只带路径，前端自己决定要不要读：一次保存会触发多条事件，
/// 去重与判定放在前端，Rust 侧不做节流，避免两边各有一套时间窗口。
#[tauri::command]
pub fn fs_watch_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, WatchState>,
    root: String,
) -> Result<(), String> {
    let path = PathBuf::from(&root);
    if !path.is_dir() {
        return Err(format!("目录不存在: {root}"));
    }

    let mut guard = state
        .0
        .lock()
        .map_err(|_| "监听器状态异常".to_string())?;
    *guard = None;

    let app_handle = app.clone();
    let mut watcher = notify::recommended_watcher(
        move |result: notify::Result<notify::Event>| {
            let Ok(event) = result else {
                return;
            };
            let changed: Vec<String> = event
                .paths
                .iter()
                .filter(|item| !is_ignored(item) && is_markdown(item))
                .map(|item| to_string_path(item))
                .collect();
            if changed.is_empty() {
                return;
            }
            // 调试构建里留一行痕迹：桌面上没法自动点 UI，日志是唯一可观测证据
            #[cfg(debug_assertions)]
            eprintln!("[vellink] fs-changed: {changed:?}");
            let _ = app_handle.emit(WATCH_EVENT, changed);
        },
    )
    .map_err(|err| format!("创建监听器失败: {err}"))?;

    watcher
        .watch(&path, RecursiveMode::Recursive)
        .map_err(|err| format!("监听目录失败 {root}: {err}"))?;

    *guard = Some(watcher);
    #[cfg(debug_assertions)]
    eprintln!("[vellink] watching {root}");
    Ok(())
}

#[tauri::command]
pub fn fs_watch_stop(state: tauri::State<'_, WatchState>) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "监听器状态异常".to_string())?;
    *guard = None;
    Ok(())
}

/// 在系统文件管理器里定位文件（macOS 选中，其它平台打开所在目录）。
#[tauri::command]
pub fn fs_reveal(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = std::process::Command::new("open");
        cmd.arg("-R").arg(&target);
        cmd
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = std::process::Command::new("explorer");
        cmd.arg(format!("/select,{}", target.to_string_lossy()));
        cmd
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let dir = target
            .parent()
            .map(|parent| parent.to_path_buf())
            .unwrap_or_else(|| target.clone());
        let mut cmd = std::process::Command::new("xdg-open");
        cmd.arg(&dir);
        cmd
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|err| format!("无法打开文件管理器: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vellink-test-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn accepts_export_extensions_only() {
        assert!(export_target("/tmp/note.md").is_ok());
        assert!(export_target("/tmp/note.MARKDOWN").is_ok());
        assert!(export_target("/tmp/report.html").is_ok());
        assert!(export_target("/tmp/report.HTM").is_ok());
        // PDF 由系统打印面板写，应用不自己编码
        assert!(export_target("/tmp/report.pdf").is_err());
        assert!(export_target("/tmp/run.sh").is_err());
        assert!(export_target("/tmp/noext").is_err());
        // 相对路径一律拒绝：导出路径必须来自保存对话框
        assert!(export_target("note.md").is_err());
    }

    #[test]
    fn writes_export_atomically() {
        let dir = temp_dir("export-write");
        let target = dir.join("导出.html");
        export_target(target.to_str().unwrap()).unwrap();
        write_atomic(&target, "<h1>hi</h1>").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "<h1>hi</h1>");
        // 覆盖写：不残留临时文件
        write_atomic(&target, "<h1>bye</h1>").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "<h1>bye</h1>");
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".vellink.tmp"))
            .collect();
        assert!(leftovers.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn recognizes_markdown_extensions() {
        assert!(is_markdown(Path::new("/tmp/a.md")));
        assert!(is_markdown(Path::new("/tmp/a.MARKDOWN")));
        assert!(!is_markdown(Path::new("/tmp/a.txt")));
        assert!(!is_markdown(Path::new("/tmp/md")));
    }

    #[test]
    fn normalizes_bom_and_newlines() {
        assert_eq!(normalize_text("\u{feff}# a\r\n\r\nb".to_string()), "# a\n\nb");
        assert_eq!(normalize_text("a\rb".to_string()), "a\nb");
    }

    #[test]
    fn rejects_non_markdown_and_relative_paths() {
        assert!(markdown_path("notes/a.md").is_err());
        assert!(markdown_path("/tmp/a.txt").is_err());
        assert!(markdown_path("/tmp/a.md").is_ok());
    }

    #[test]
    fn writes_lists_and_trashes() {
        let root = temp_dir("fs");
        let nested = root.join("notes").join("deep.md");
        let entry = fs_write_markdown(to_string_path(&nested), "# Deep\n\nbody".into()).unwrap();
        assert_eq!(entry.name, "deep.md");
        assert!(entry.modified > 0);
        assert_eq!(fs_read_markdown(to_string_path(&nested)).unwrap(), "# Deep\n\nbody");

        // 临时文件不应残留
        let leftovers: Vec<_> = fs::read_dir(root.join("notes"))
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains("vellink.tmp"))
            .collect();
        assert!(leftovers.is_empty());

        let listed = fs_list_markdown(to_string_path(&root)).unwrap();
        assert_eq!(listed.len(), 1);

        let trashed =
            fs_trash_markdown(to_string_path(&nested), to_string_path(&root.join(".vellink-trash")))
                .unwrap();
        assert!(Path::new(&trashed).exists());
        assert!(!nested.exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn skips_hidden_and_heavy_directories() {
        let root = temp_dir("skip");
        for name in ["node_modules", ".git", "notes"] {
            fs::create_dir_all(root.join(name)).unwrap();
            fs::write(root.join(name).join("x.md"), "# x").unwrap();
        }
        let listed = fs_list_markdown(to_string_path(&root)).unwrap();
        assert_eq!(listed.len(), 1);
        assert!(listed[0].path.ends_with("notes/x.md"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn ignores_own_noise() {
        assert!(is_ignored(Path::new("/docs/.vellink-trash/1-a.md")));
        assert!(is_ignored(Path::new("/docs/.a.md.vellink.tmp")));
        assert!(is_ignored(Path::new("/docs/.hidden.md")));
        assert!(!is_ignored(Path::new("/docs/a.md")));
    }

    #[test]
    fn renames_and_refuses_occupied_target() {
        let root = temp_dir("rename");
        let source = root.join("旧.md");
        fs_write_markdown(to_string_path(&source), "# 旧".into()).unwrap();

        let target = root.join("新.md");
        let entry = fs_rename_markdown(to_string_path(&source), to_string_path(&target)).unwrap();
        assert_eq!(entry.name, "新.md");
        assert!(!source.exists());
        assert_eq!(fs_read_markdown(to_string_path(&target)).unwrap(), "# 旧");

        // 目标已存在时拒绝，不覆盖别人的稿子
        fs_write_markdown(to_string_path(&source), "# 又建了一个".into()).unwrap();
        assert!(fs_rename_markdown(to_string_path(&source), to_string_path(&target)).is_err());
        assert_eq!(
            fs_read_markdown(to_string_path(&target)).unwrap(),
            "# 旧"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn watcher_reports_new_markdown_files() {
        let root = temp_dir("watch");
        let (tx, rx) = std::sync::mpsc::channel::<Vec<String>>();

        let mut watcher = notify::recommended_watcher(
            move |result: notify::Result<notify::Event>| {
                let Ok(event) = result else {
                    return;
                };
                let changed: Vec<String> = event
                    .paths
                    .iter()
                    .filter(|item| !is_ignored(item) && is_markdown(item))
                    .map(|item| to_string_path(item))
                    .collect();
                if !changed.is_empty() {
                    let _ = tx.send(changed);
                }
            },
        )
        .unwrap();
        watcher
            .watch(&root, RecursiveMode::Recursive)
            .unwrap();

        let target = root.join("新文件.md");
        fs::write(&target, "# 新").unwrap();

        let hits = rx
            .recv_timeout(std::time::Duration::from_secs(10))
            .expect("监听器没有上报新建的 Markdown 文件");
        assert!(hits.iter().any(|path| path.ends_with("新文件.md")));

        drop(watcher);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn asset_names_are_single_safe_files() {
        let dir = temp_dir("asset-name");
        let root = dir.to_str().unwrap();
        assert!(asset_target(root, "shot-a1b2c3d4.png").is_ok());
        assert!(asset_target(root, "photo.JPG").is_ok());
        // 不能跳出资源目录，也不能伪装成隐藏文件
        assert!(asset_target(root, "../outside.png").is_err());
        assert!(asset_target(root, "sub/shot.png").is_err());
        assert!(asset_target(root, "..\\windows.png").is_err());
        assert!(asset_target(root, ".hidden.png").is_err());
        // SVG 能带脚本，不当图片收
        assert!(asset_target(root, "x.svg").is_err());
        assert!(asset_target(root, "x.exe").is_err());
        assert!(asset_target("relative/root", "x.png").is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn writes_and_reads_an_asset_atomically() {
        let dir = temp_dir("asset-write");
        let root = dir.to_str().unwrap();
        let rel = fs_write_asset(root.to_string(), "shot-1234abcd.png".into(), vec![1, 2, 3])
            .unwrap();
        assert_eq!(rel, ".vellink-assets/shot-1234abcd.png");
        assert_eq!(
            fs_read_asset(root.to_string(), "shot-1234abcd.png".into()).unwrap(),
            vec![1, 2, 3]
        );
        // 覆盖写，且不留临时文件
        fs_write_asset(root.to_string(), "shot-1234abcd.png".into(), vec![9, 8]).unwrap();
        assert_eq!(
            fs_read_asset(root.to_string(), "shot-1234abcd.png".into()).unwrap(),
            vec![9, 8]
        );
        let leftovers: Vec<_> = fs::read_dir(dir.join(ASSET_DIR))
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().ends_with(".vellink.tmp"))
            .collect();
        assert!(leftovers.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}

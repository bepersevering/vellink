//! 本地 Markdown 文件系统命令。
//!
//! 只暴露「一个工作区目录里的 .md 文件」这一层能力，不做通用 fs：
//! 读写删全部限制在 Markdown 扩展名内，删除是移动到 `.vellink-trash/`
//! 而不是真删，避免编辑器误删用户唯一一份稿子。
//!
//! 写入走「临时文件 + rename」，Crash 或断电时不会留下半截文件。

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::Manager;

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

/// 写入 Markdown：必要时补建目录，先写临时文件再 rename 覆盖。
#[tauri::command]
pub fn fs_write_markdown(path: String, contents: String) -> Result<FsEntry, String> {
    let target = markdown_path(&path)?;
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
        file.write_all(contents.as_bytes())
            .map_err(|err| format!("写入失败 {path}: {err}"))?;
        file.sync_all()
            .map_err(|err| format!("落盘失败 {path}: {err}"))?;
    }

    fs::rename(&temp, &target).map_err(|err| {
        let _ = fs::remove_file(&temp);
        format!("替换文件失败 {path}: {err}")
    })?;

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
}

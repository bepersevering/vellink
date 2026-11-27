//! Local Markdown filesystem commands.
//!
//! Only exposes the ability to work with ".md files inside one workspace directory"; no general-purpose fs:
//! reads, writes and deletes are all restricted to Markdown extensions, and deleting moves a file to
//! `.vellink-trash/` instead of removing it, so the editor can't accidentally destroy the user's only copy.
//!
//! Writes go through "temp file + rename", so a crash or power loss never leaves a half-written file.
//!
//! Also provides a directory watcher: changes from external editors, `git pull`, or sync drives are
//! pushed to the frontend as events, replacing fixed-interval polling.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{Emitter, Manager};

/// Event name the frontend listens for; the payload is the list of changed paths.
const WATCH_EVENT: &str = "vellink://fs-changed";

/// Metadata for a Markdown file; `path` is an absolute path and is also used by the frontend as the document id.
#[derive(Serialize)]
pub struct FsEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
    /// Modification time (Unix milliseconds); the frontend uses it to detect external changes.
    pub modified: u64,
}

const MARKDOWN_EXTS: [&str; 2] = ["md", "markdown"];
/// Directory name for image assets (starts with a dot so it is skipped when listing notes and never treated as a document).
const ASSET_DIR: &str = ".vellink-assets";
const ASSET_EXTS: [&str; 5] = ["png", "jpg", "jpeg", "gif", "webp"];
/// 20 MB limit per image; keep in sync with the frontend's MAX_IMAGE_BYTES.
const MAX_ASSET_BYTES: usize = 20 * 1024 * 1024;
/// Maximum recursion depth when listing; note directories should never be deeper than this.
const MAX_DEPTH: usize = 6;
/// These directories are never writing content; skip them so listing doesn't hang on node_modules.
const SKIP_DIRS: [&str; 5] = ["node_modules", "target", "dist", "build", "vendor"];

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| MARKDOWN_EXTS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Noise we create ourselves: the trash directory, atomic-write temp files, and hidden files.
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

/// Validate and normalize a Markdown file path; reject directories and non-Markdown files.
fn markdown_path(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err(format!("path must be absolute: {raw}"));
    }
    if !is_markdown(&path) {
        return Err(format!("only .md / .markdown files are allowed: {raw}"));
    }
    Ok(path)
}

/// Strip a UTF-8 BOM and normalize CRLF / lone CR to LF.
///
/// The editor internally uses only `\n`. Reading a Windows file as-is leaves an invisible
/// character at the end of every block and breaks round-trip serialization; normalizing at
/// the entry point is far cheaper than handling it in every view.
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
        // Symlinked directories can form cycles; never follow them
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

/// Default workspace: `~/Documents/Vellink` (falls back to the home directory if the Documents dir is unavailable).
#[tauri::command]
pub fn fs_default_root(app: tauri::AppHandle) -> Result<String, String> {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|err| format!("could not locate the Documents directory: {err}"))?;
    Ok(to_string_path(&base.join("Vellink")))
}

#[tauri::command]
pub fn fs_ensure_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|err| format!("failed to create directory {path}: {err}"))
}

/// Recursively list all Markdown files in the workspace, newest first.
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
    let raw = fs::read_to_string(&target).map_err(|err| format!("failed to read {path}: {err}"))?;
    Ok(normalize_text(raw))
}

/// Atomic write: create a temp file in the same directory, fsync it, then rename over the target.
///
/// Users should never see a half-written file or data still sitting in the page cache: on a
/// power loss or crash the target is either the old content or the new content.
fn write_atomic_bytes(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let path = to_string_path(target);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("failed to create directory: {err}"))?;
    }

    let file_name = target
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "document.md".to_string());
    let temp = target.with_file_name(format!(".{file_name}.vellink.tmp"));

    {
        let mut file = File::create(&temp).map_err(|err| format!("failed to write {path}: {err}"))?;
        file.write_all(bytes)
            .map_err(|err| format!("failed to write {path}: {err}"))?;
        file.sync_all()
            .map_err(|err| format!("failed to flush {path} to disk: {err}"))?;
    }

    fs::rename(&temp, target).map_err(|err| {
        let _ = fs::remove_file(&temp);
        format!("failed to replace {path}: {err}")
    })
}

fn write_atomic(target: &Path, contents: &str) -> Result<(), String> {
    write_atomic_bytes(target, contents.as_bytes())
}

/// Write Markdown: create parent directories if needed, write a temp file, then rename over the target.
#[tauri::command]
pub fn fs_write_markdown(path: String, contents: String) -> Result<FsEntry, String> {
    let target = markdown_path(&path)?;
    write_atomic(&target, &contents)?;
    Ok(entry_of(&target))
}

/// Move a file to the trash directory (instead of deleting it) and return the new path.
///
/// `snake_case` is declared explicitly: this is the only underscored argument, so we don't rely
/// on Tauri's default renaming rules. The frontend's field names pass through unchanged, avoiding
/// silent IPC renames that would make "delete" appear to do nothing.
#[tauri::command(rename_all = "snake_case")]
pub fn fs_trash_markdown(path: String, trash_dir: String) -> Result<String, String> {
    let source = markdown_path(&path)?;
    fs::create_dir_all(&trash_dir).map_err(|err| format!("failed to create trash directory: {err}"))?;

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

    fs::rename(&source, &destination).map_err(|err| format!("failed to move to trash: {err}"))?;
    Ok(to_string_path(&destination))
}

#[tauri::command]
pub fn fs_rename_markdown(from: String, to: String) -> Result<FsEntry, String> {
    let source = markdown_path(&from)?;
    let target = markdown_path(&to)?;
    if target.exists() {
        return Err(format!("target file already exists: {to}"));
    }
    fs::rename(&source, &target).map_err(|err| format!("failed to rename: {err}"))?;
    Ok(entry_of(&target))
}

/// Extensions allowed for exports. `.pdf` is intentionally absent: PDFs are written by the
/// system print dialog, the app does not encode PDFs itself.
const EXPORT_EXTS: [&str; 7] = ["md", "markdown", "html", "htm", "docx", "epub", "odt"];

/// Validate an export target: it must be an absolute path with an allowed extension.
///
/// Kept separate from `markdown_path` on purpose: the workspace only accepts `.md` (so the
/// editor can't open arbitrary files as notes), while exports must be able to write `.html`.
/// Mixing the two allowlists would eventually open the wrong one up.
fn export_target(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err(format!("export path must be absolute: {raw}"));
    }
    let allowed = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| EXPORT_EXTS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false);
    if !allowed {
        return Err(format!("unsupported export extension: {raw}"));
    }
    Ok(path)
}

/// Write an export file (Markdown / HTML), also atomically.
#[tauri::command]
pub fn export_write_text(path: String, contents: String) -> Result<(), String> {
    let target = export_target(&path)?;
    write_atomic(&target, &contents)
}

/// Export binary formats (DOCX / EPUB / ODT): bytes arrive over IPC and are also written atomically.
#[tauri::command]
pub fn export_write_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    let target = export_target(&path)?;
    write_atomic_bytes(&target, &data)
}

/// Open the system print dialog.
///
/// PDFs don't use a custom renderer: the system print panel already supports "Save as PDF",
/// and fonts, pagination and CJK line breaking are all left to the platform, which is far more
/// reliable than rebuilding a layout engine in the app.
#[tauri::command]
pub fn export_print(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window.print().map_err(|err| format!("failed to open print dialog: {err}"))
}

/// Read images next to a source file when importing Markdown: must be an absolute path with an image extension.
#[tauri::command]
pub fn fs_read_image(path: String) -> Result<Vec<u8>, String> {
    let target = PathBuf::from(&path);
    if !target.is_absolute() {
        return Err(format!("path must be absolute: {path}"));
    }
    let ext = target
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp") {
        return Err(format!("only images may be read: {path}"));
    }
    fs::read(&target).map_err(|err| format!("failed to read image {path}: {err}"))
}

/* ------------------------------ Image assets ------------------------------ */

/// Asset filenames accept only "a plain filename + an image extension".
///
/// The name comes from the frontend's slug + content hash, but anything arriving over IPC is
/// untrusted: separators or `..` could escape the asset directory, a leading dot makes a hidden
/// file, and SVGs can carry scripts, so they are rejected too.
fn asset_target(root: &str, name: &str) -> Result<PathBuf, String> {
    let dir = PathBuf::from(root);
    if !dir.is_absolute() {
        return Err(format!("workspace path must be absolute: {root}"));
    }
    if name.is_empty()
        || name.len() > 128
        || name.starts_with('.')
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
    {
        return Err(format!("invalid asset filename: {name}"));
    }
    let ext = Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default();
    if !ASSET_EXTS.contains(&ext.as_str()) {
        return Err(format!("unsupported image format: {name}"));
    }
    Ok(dir.join(ASSET_DIR).join(name))
}

/// Write an image and return the relative path used in Markdown.
#[tauri::command]
pub fn fs_write_asset(root: String, name: String, data: Vec<u8>) -> Result<String, String> {
    if data.len() > MAX_ASSET_BYTES {
        return Err(format!("image exceeds 20 MB ({} bytes)", data.len()));
    }
    let target = asset_target(&root, &name)?;
    write_atomic_bytes(&target, &data)?;
    Ok(format!("{ASSET_DIR}/{name}"))
}

/// Read an image back when exporting HTML / PDF, handing it to the frontend to convert to a data URI.
#[tauri::command]
pub fn fs_read_asset(root: String, name: String) -> Result<Vec<u8>, String> {
    let target = asset_target(&root, &name)?;
    fs::read(&target).map_err(|err| format!("failed to read image {}: {err}", to_string_path(&target)))
}

/// List filenames in the workspace asset directory (names only, no content).
#[tauri::command]
pub fn fs_list_assets(root: String) -> Result<Vec<String>, String> {
    let dir = PathBuf::from(&root).join(".vellink-assets");
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for entry in fs::read_dir(&dir).map_err(|err| format!("failed to list assets: {err}"))? {
        let entry = entry.map_err(|err| format!("failed to list assets: {err}"))?;
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            if let Some(name) = entry.file_name().to_str() {
                out.push(name.to_string());
            }
        }
    }
    Ok(out)
}

/// Move orphaned assets to the trash (rather than deleting them, so they can be recovered).
#[tauri::command(rename_all = "snake_case")]
pub fn fs_trash_asset(root: String, name: String, trash_dir: String) -> Result<String, String> {
    let asset = asset_target(&root, &name)?;
    fs::create_dir_all(&trash_dir).map_err(|err| format!("failed to create trash directory: {err}"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let target = PathBuf::from(&trash_dir).join(format!("{}-{}", stamp, name));
    fs::rename(&asset, &target).map_err(|err| format!("failed to trash asset: {err}"))?;
    Ok(to_string_path(&target))
}

/// Directory watcher for the current workspace; replacing it drops and stops the old one.
#[derive(Default)]
pub struct WatchState(pub Mutex<Option<RecommendedWatcher>>);

/// Start watching a directory (recursively).
///
/// Events carry only paths; the frontend decides whether to read them. A single save can
/// trigger multiple events, so deduplication is left to the frontend. The Rust side does no
/// throttling, avoiding a second set of timing windows on this side.
#[tauri::command]
pub fn fs_watch_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, WatchState>,
    root: String,
) -> Result<(), String> {
    let path = PathBuf::from(&root);
    if !path.is_dir() {
        return Err(format!("directory does not exist: {root}"));
    }

    let mut guard = state
        .0
        .lock()
        .map_err(|_| "watcher state is invalid".to_string())?;
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
            // Leave a trace in debug builds: on the desktop we can't automate UI clicks, so logs are the only observable evidence
            #[cfg(debug_assertions)]
            eprintln!("[vellink] fs-changed: {changed:?}");
            let _ = app_handle.emit(WATCH_EVENT, changed);
        },
    )
    .map_err(|err| format!("failed to create watcher: {err}"))?;

    watcher
        .watch(&path, RecursiveMode::Recursive)
        .map_err(|err| format!("failed to watch directory {root}: {err}"))?;

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
        .map_err(|_| "watcher state is invalid".to_string())?;
    *guard = None;
    Ok(())
}

/// Reveal a file in the system file manager (select it on macOS, open its directory elsewhere).
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
        .map_err(|err| format!("failed to open file manager: {err}"))
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
        // PDFs are written by the system print panel, not encoded by the app
        assert!(export_target("/tmp/report.pdf").is_err());
        assert!(export_target("/tmp/run.sh").is_err());
        assert!(export_target("/tmp/noext").is_err());
        // Always reject relative paths: export paths must come from a save dialog
        assert!(export_target("note.md").is_err());
    }

    #[test]
    fn writes_export_atomically() {
        let dir = temp_dir("export-write");
        let target = dir.join("export.html");
        export_target(target.to_str().unwrap()).unwrap();
        write_atomic(&target, "<h1>hi</h1>").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "<h1>hi</h1>");
        // Overwrite: no temp files should remain
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

        // Temp files should not remain
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
        let source = root.join("old.md");
        fs_write_markdown(to_string_path(&source), "# Old".into()).unwrap();

        let target = root.join("new.md");
        let entry = fs_rename_markdown(to_string_path(&source), to_string_path(&target)).unwrap();
        assert_eq!(entry.name, "new.md");
        assert!(!source.exists());
        assert_eq!(fs_read_markdown(to_string_path(&target)).unwrap(), "# Old");

        // Reject an existing target; don't overwrite someone else's draft
        fs_write_markdown(to_string_path(&source), "# Created another".into()).unwrap();
        assert!(fs_rename_markdown(to_string_path(&source), to_string_path(&target)).is_err());
        assert_eq!(
            fs_read_markdown(to_string_path(&target)).unwrap(),
            "# Old"
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

        let target = root.join("new-file.md");
        fs::write(&target, "# New").unwrap();

        let hits = rx
            .recv_timeout(std::time::Duration::from_secs(10))
            .expect("watcher did not report the newly created Markdown file");
        assert!(hits.iter().any(|path| path.ends_with("new-file.md")));

        drop(watcher);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn asset_names_are_single_safe_files() {
        let dir = temp_dir("asset-name");
        let root = dir.to_str().unwrap();
        assert!(asset_target(root, "shot-a1b2c3d4.png").is_ok());
        assert!(asset_target(root, "photo.JPG").is_ok());
        // Must not escape the asset directory or masquerade as a hidden file
        assert!(asset_target(root, "../outside.png").is_err());
        assert!(asset_target(root, "sub/shot.png").is_err());
        assert!(asset_target(root, "..\\windows.png").is_err());
        assert!(asset_target(root, ".hidden.png").is_err());
        // SVGs can carry scripts, so they are not accepted as images
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
        // Overwrite, and leave no temp files behind
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

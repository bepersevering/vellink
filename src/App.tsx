import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DocumentStore } from "./core/store";
import type { PluginRuntime, PluginSummary } from "./core/plugin/runtime";
import { createPluginRuntime, persistPluginEnabled } from "./plugins/loader";
import { createLocalCredentialStore } from "./core/vfs/credentials";
import { buildOutline, type OutlineEntry } from "./core/outline";
import { fallbackDocument, seedDocuments } from "./core/seed";
import { Workspace, type DocSummary, type ExternalFile } from "./core/workspace";
import { persistRoot, resolveWorkspaceEnv } from "./core/workspace-env";
import {
  desktopAssets,
  desktopFs,
  isDesktop,
  onFsChanged,
  pickFolder,
  pickMarkdownFiles,
} from "./core/desktop/bridge";
import type { FileWorkspaceBackend } from "./core/workspace-fs";
import { FileChangeDetector } from "./core/file-changes";
import { TitleRenamer } from "./core/title-rename";
import {
  Autosave,
  type SaveState,
  type WorkspaceBackend,
} from "./core/workspace-storage";
import { buildExport, clampRange, type ExportFormat } from "./core/export";
import { planImports, titleFromFileName } from "./core/import-docs";
import { buildTable } from "./core/table-insert";
import { applyCustomCss } from "./core/custom-css";
import { findOrphanAssets } from "./core/orphan-assets";
import { fitWithin, needsResize } from "./core/image-resize";
import { findRelativeImages, rewriteImagePaths } from "./core/import-images";
import { printCurrentWindow, saveExportFile } from "./core/export/save";
import { docCss } from "./core/export/html";
import {
  ASSET_DIR,
  MAX_IMAGE_BYTES,
  assetName,
  assetRelativePath,
  dataUriOf,
  imageMarkdown,
  inlineLocalImages,
  isAssetPath,
  isImageType,
  mimeFromAssetPath,
} from "./core/asset";
import {
  applySettings,
  loadSettings,
  resolveTheme,
  saveSettings,
  type Settings,
} from "./core/settings";
import { t, useLocale } from "./i18n";
import { TitleBar, type AppMode, type Theme } from "./ui/TitleBar";
import { FileDrawer } from "./ui/FileDrawer";
import {
  Editor,
  type DocStats,
  type EditorHandle,
  type EditorMode,
} from "./ui/Editor";
import { SideDrawer, type PanelTab } from "./ui/SideDrawer";
import { StatusBar } from "./ui/StatusBar";
import { UpdateNotice } from "./ui/UpdateNotice";
import { useUpdater } from "./ui/useUpdater";
import { CommandPalette } from "./ui/CommandPalette";
import { ExportDialog, type ExportScope } from "./ui/ExportDialog";
import { TableDialog } from "./ui/TableDialog";
import { SettingsDialog } from "./ui/SettingsDialog";
import { IconSprite } from "./ui/Icon";
import { commands as commandItems, type PluginInfo, type CommandItem } from "./ui/data";

/** Tauri command errors are strings; local exceptions use their message. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** File name from a path (with the file backend, the id is an absolute path). */
function baseName(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(index + 1) : path;
}

export default function App() {
  const { locale } = useLocale();
  const [mode, setMode] = useState<AppMode>("focus");
  const [editorMode, setEditorMode] = useState<EditorMode>("wysiwyg");
  const [stats, setStats] = useState<DocStats>({
    line: 1,
    chars: 0,
    pm: 1,
    source: 0,
    sourceText: "",
  });
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Whether the OS is in dark mode: only consulted when the theme follows the system. */
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );
  const theme = resolveTheme(settings.theme, systemDark);
  /**
   * The one-time startup effect (workspace setup) needs the latest settings.
   * Use a ref instead of putting settings in the deps: that would reinitialize the whole workspace.
   */
  const settingsRef = useRef(settings);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>("outline");
  const [pluginSummaries, setPluginSummaries] = useState<PluginSummary[]>([]);
  const [pluginErrors, setPluginErrors] = useState<string[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState("");
  /** Export dialog and a snapshot of the selection when it opened (the selection can change, so snapshot it on open). */
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSelection, setExportSelection] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  /** Document body queued for printing: PDFs are rendered by the system print dialog, not encoded here. */
  const [printSheet, setPrintSheet] = useState<{
    html: string;
    title: string;
  } | null>(null);

  /** Auto-update: check silently on startup; the version in the bottom-right allows a manual check. */
  const updater = useUpdater();

  // Workspace state
  const [ready, setReady] = useState(false);
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<{ id: string; store: DocumentStore } | null>(null);
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /** Where documents live: a local folder or browser localStorage. */
  const [storage, setStorage] = useState<{
    kind: "files" | "browser";
    root: string | null;
  }>({ kind: "browser", root: null });

  const toastTimer = useRef<number | null>(null);
  const editorRef = useRef<EditorHandle>(null);
  const workspaceRef = useRef<Workspace | null>(null);
  const backendRef = useRef<WorkspaceBackend | null>(null);
  const filesRef = useRef<FileWorkspaceBackend | null>(null);
  const autosaveRef = useRef<Autosave | null>(null);
  const activeStoreRef = useRef<DocumentStore | null>(null);
  const runtimeRef = useRef<PluginRuntime | null>(null);
  const [runtimeReady, setRuntimeReady] = useState<PluginRuntime | null>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  /** File names follow titles: once a title edit settles, rename the file on disk. */
  const renamerRef = useRef<TitleRenamer | null>(null);
  /** External-change detector, wired up by the watcher effect below. */
  const detectorRef = useRef<FileChangeDetector | null>(null);
  /**
   * Counter for local structural changes (renames, deletions).
   *
   * Scans are async: if a file is renamed mid-scan, the snapshot shows the old path
   * present and the new one missing, which would misclassify the renamed document as
   * externally deleted. Any change to this counter discards the current round.
   */
  const mutationRef = useRef(0);
  const [liveWatch, setLiveWatch] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 1800);
  }, []);

  const handleStats = useCallback((next: DocStats) => setStats(next), []);

  /* ------------------------------ Workspace startup ------------------------------ */

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => undefined as void;

    void (async () => {
      // Desktop reads/writes a local folder; the browser falls back to localStorage; all backends expose the same methods
      const env = await resolveWorkspaceEnv();
      if (cancelled) return;

      backendRef.current = env.backend;
      filesRef.current = env.files;
      setStorage({ kind: env.kind, root: env.root });

      const autosave = new Autosave(
        env.backend,
        {
          onState: (id, state) =>
            setSaveStates((prev) => (prev[id] === state ? prev : { ...prev, [id]: state })),
          onSaved: (id, source) => {
            workspaceRef.current?.markSaved(id, source);
            setSavedAt(Date.now());
            // Our own writes also fire watch events: mark them so we don't reread them as external changes
            detectorRef.current?.markOwn(id);
          },
          onError: (error: unknown) =>
            showToast(
              error instanceof Error && /quota|storage/i.test(error.name + error.message)
                ? t("toast.storageFull")
                : t("toast.saveFailed"),
            ),
        },
        // Read through the ref: this effect runs once, so closing over settings would capture a stale first-frame value
        settingsRef.current.autosaveMs,
      );
      autosaveRef.current = autosave;

      const stored = await env.backend.load();
      if (cancelled) return;

      // Empty folder: seed two documents on first use, otherwise start with a single blank doc (no repeated seeding)
      let initial = stored ?? [];
      if (initial.length === 0) {
        const now = Date.now();
        initial = env.fresh
          ? seedDocuments(now, (title) => env.files?.pathFor(title) ?? title)
          : [
              fallbackDocument(
                now,
                env.files?.pathFor(t("doc.untitled")) ?? undefined,
                t("doc.untitled"),
              ),
            ];
        for (const doc of initial) await env.backend.save(doc);
        if (cancelled) return;
      }

      const workspace = new Workspace(initial);
      workspaceRef.current = workspace;

      // File backend only: rename the corresponding file when the title changes
      if (env.files) {
        renamerRef.current = new TitleRenamer({
          files: env.files,
          workspace,
          autosave,
          beforeRename: (from, to) => {
            detectorRef.current?.markOwn(from, to);
            mutationRef.current += 1;
          },
          onError: (error) =>
            showToast(t("toast.renameFailed", { message: errorMessage(error) })),
        });
      }

      const sync = () => {
        setDocs(workspace.summaries());
        setActiveId(workspace.activeId);
      };
      sync();
      unsubscribe = workspace.subscribe(sync);
      setReady(true);
    })();

    return () => {
      cancelled = true;
      unsubscribe();
      renamerRef.current?.dispose();
      renamerRef.current = null;
      autosaveRef.current?.dispose();
    };
  }, [showToast]);

  // Active document → authoritative undo instance
  useEffect(() => {
    if (!ready || !activeId) {
      activeStoreRef.current = null;
      setActive(null);
      return;
    }
    const store = workspaceRef.current?.store(activeId) ?? null;
    activeStoreRef.current = store;
    setActive(store ? { id: activeId, store } : null);
  }, [ready, activeId]);

  // Queue anything with unsaved changes (debouncing happens inside Autosave)
  useEffect(() => {
    const workspace = workspaceRef.current;
    const autosave = autosaveRef.current;
    if (!workspace || !autosave) return;
    for (const summary of docs) {
      if (!summary.dirty) continue;
      const doc = workspace.get(summary.id);
      if (doc) autosave.schedule(doc);
    }
  }, [docs]);

  // Disk changes: filesystem events first; 30-second polling is a fallback (network drives / lost events)
  useEffect(() => {
    const files = filesRef.current;
    if (!ready || storage.kind !== "files" || !files) return;

    let stopped = false;
    let debounce: number | null = null;
    const detector = new FileChangeDetector();
    detectorRef.current = detector;

    const scan = async () => {
      if (stopped) return;
      const generation = mutationRef.current;
      try {
        const entries = await files.listMeta();
        if (stopped) return;
        // Files were renamed / deleted locally during the scan: this snapshot is no longer trustworthy
        if (generation !== mutationRef.current) {
          schedule();
          return;
        }
        const { candidates, present } = detector.diff(entries);
        const changed: ExternalFile[] = [];
        for (const candidate of candidates) {
          const doc = workspaceRef.current?.get(candidate.path);
          // Unsaved in-memory changes win: keep them and let the user save explicitly
          if (doc && doc.source !== doc.savedSource) continue;
          changed.push({
            id: candidate.path,
            source: await files.read(candidate.path),
            updatedAt: candidate.modified,
          });
        }
        if (stopped || generation !== mutationRef.current) {
          if (!stopped) schedule();
          return;
        }
        const result = workspaceRef.current?.syncExternal(changed, present);
        if (result && result.updated.length > 0) showToast(t("toast.externalUpdated"));
      } catch {
        // Folder unplugged / permissions changed: skip this round, retry next time
      }
    };

    const schedule = () => {
      if (stopped) return;
      if (debounce) window.clearTimeout(debounce);
      // One save fires several events; coalesce them into a single scan window
      debounce = window.setTimeout(() => {
        debounce = null;
        void scan();
      }, 200);
    };

    let unlisten = () => undefined as void;
    void (async () => {
      // Record a baseline first: on startup we shouldn't reread the whole library as external changes
      const initial = await files.listMeta().catch(() => []);
      if (stopped) return;
      detector.rebaseline(initial);

      try {
        unlisten = await onFsChanged(() => schedule());
        if (stopped) {
          unlisten();
          return;
        }
        await desktopFs.watch(files.root);
        if (!stopped) setLiveWatch(true);
      } catch (error) {
        // If watching is unavailable, fall back to polling so the feature still works
        console.warn("[vellink] folder watching unavailable, falling back to polling", error);
      }
    })();

    const onVisible = () => {
      if (document.visibilityState === "visible") schedule();
    };
    // FSEvents may drop events while the lid is closed or after switching back; scan again
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void scan(), 30_000);

    return () => {
      stopped = true;
      if (debounce) window.clearTimeout(debounce);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
      unlisten();
      detectorRef.current = null;
    };
  }, [ready, storage.kind, showToast]);

  // Follow title changes with file renames (file backend only; debouncing is inside TitleRenamer)
  useEffect(() => {
    const renamer = renamerRef.current;
    if (!renamer || !activeId) return;
    const summary = docs.find((doc) => doc.id === activeId);
    if (!summary) return;
    // Only local edits trigger a rename: an external tool changing H1 leaves the file name alone
    renamer.observe(summary.id, summary.uid, summary.title, summary.dirty);
  }, [docs, activeId]);

  // Outline follows the active document, debounced while typing to avoid a full parse per keystroke
  const activeSource = useMemo(
    () => (activeId ? (workspaceRef.current?.get(activeId)?.source ?? "") : ""),
    // Every docs change implies a body change (source isn't in summaries; updatedAt triggers it)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeId, docs],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setOutline(buildOutline(activeSource)), 200);
    return () => window.clearTimeout(timer);
  }, [activeSource]);

  /* ------------------------------ Plugins ------------------------------ */

  useEffect(() => {
    let disposed = false;
    void createPluginRuntime({
      getStore: () => activeStoreRef.current,
      notify: showToast,
      credentialStore: createLocalCredentialStore(),
    }).then(({ runtime, errors }) => {
      // The runtime is an app-level singleton: don't dispose it in StrictMode's first cleanup,
      // or the second mount would get an already-disposed instance.
      if (disposed) return;
      runtimeRef.current = runtime;
      setRuntimeReady(runtime);
      setPluginSummaries(runtime.list());
      setPluginErrors(errors.map((error) => `${error.path}: ${error.message}`));
    });
    return () => {
      disposed = true;
    };
  }, [showToast]);

  const plugins = useMemo<PluginInfo[]>(
    () =>
      pluginSummaries.map((plugin, index) => ({
        id: plugin.id,
        name: plugin.name,
        desc:
          plugin.error ??
          plugin.description ??
          (plugin.active
            ? t("plugins.activated")
            : t("plugins.installedInactive")),
        tag: t("plugins.tagLine", {
          version: plugin.version,
          commands: plugin.commands.length,
          views: plugin.views.length,
        }),
        icon: (["folder", "ai", "chart"] as const)[index % 3],
        tone: (["i1", "i2", "i3"] as const)[index % 3],
        enabled: plugin.enabled,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-resolve copy when the locale changes
    [pluginSummaries, locale],
  );

  const paletteCommands = useMemo(
    () => [
      ...commandItems,
      ...pluginSummaries.flatMap((plugin) =>
        plugin.commands.map((command) => ({
          id: command.command,
          label: command.title,
          icon: "edit" as const,
          group: t("group.plugins", { name: plugin.name }),
          action: `plugin:${command.command}`,
        })),
      ),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-resolve copy when the locale changes
    [pluginSummaries, locale],
  );

/** Scale large images down proportionally with canvas; leave GIFs untouched (would lose animation); fall back to original bytes on failure. */
async function shrinkImage(file: File, maxEdge: number): Promise<Uint8Array> {
  const original = new Uint8Array(await file.arrayBuffer());
  if (!maxEdge || file.type === "image/gif") return original;
  try {
    const bitmap = await createImageBitmap(file);
    const size = fitWithin({ width: bitmap.width, height: bitmap.height }, maxEdge);
    if (!needsResize({ width: bitmap.width, height: bitmap.height }, maxEdge)) {
      bitmap.close();
      return original;
    }
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return original;
    }
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, file.type, 0.92));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : original;
  } catch {
    return original;
  }
}

  /* ------------------------------ Document actions ------------------------------ */

  const createDoc = useCallback(async () => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const title = t("doc.untitled");
    // File backend: reserve a disk path (avoiding existing names) before creating the document
    const id = filesRef.current ? await filesRef.current.newPath(title) : undefined;
    workspace.create(title, id);
    showToast(t("toast.docCreated"));
  }, [showToast]);

  /** Insert an empty table via insertMarkdown's block mode so the current line isn't split. */
  const insertTable = useCallback((rows: number, cols: number) => {
    editorRef.current?.insertMarkdown(buildTable(rows, cols), { block: true });
    setTableOpen(false);
    showToast(t("table.inserted"));
  }, [showToast]);

  /**
   * Import Markdown files.
   *
   * On desktop, write each file into the current workspace folder (via newPath to avoid
   * name clashes), then add it to the workspace as already saved. In the browser there
   * are no real files, so autosave persists to localStorage. Picked files already contain
   * full Markdown, so don't wrap them in the newDocumentSource title template.
   */
  const importDocs = useCallback(async () => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    try {
      const picked = await pickMarkdownFiles();
      if (picked.length === 0) return;

      const plan = planImports(
        picked,
        workspace.summaries().map((doc) => doc.title),
        t("doc.untitled"),
      );
      const files = filesRef.current;
      // Writing triggers the watcher; this batch is a user-initiated import, so invalidate any stale scan in flight
      if (files) mutationRef.current += 1;
      const entries: { title: string; source: string; id?: string; saved?: boolean }[] = [];

      for (const item of plan.items) {
        if (files) {
          // Relative-path images: copy them from the source folder into the workspace's
          // .vellink-assets/ and rewrite references. The browser has no source folder, so skip.
          let text = item.text;
          const refs = findRelativeImages(text);
          if (refs.length && item.path && files.root) {
            const sourceDir = item.path.slice(0, item.path.lastIndexOf("/"));
            text = await rewriteImagePathsAsync(text, refs, async (ref) => {
              try {
                const bytes = new Uint8Array(
                  await desktopAssets.readImage(`${sourceDir}/${ref.path.replace(/^\.\//, "")}`),
                );
                const mime = mimeFromAssetPath(ref.fileName);
                const name = assetName(ref.fileName, mime ?? "image/png", bytes);
                if (!name || bytes.length > MAX_IMAGE_BYTES) return null;
                await desktopAssets.write(files.root, name, bytes);
                return assetRelativePath(name);
              } catch {
                return null;
              }
            });
          }

          const path = await files.newPath(
            titleFromFileName(item.sourceName, t("doc.untitled")),
          );
          await desktopFs.write(path, text);
          detectorRef.current?.markOwn(path);
          entries.push({ title: item.title, source: text, id: path, saved: true });
        } else {
          entries.push({ title: item.title, source: item.text });
        }
      }

      const added = workspace.importDocs(entries);
      if (added.length > 0) {
        showToast(
          t("toast.imported", {
            count: added.length,
            skipped: plan.skipped.length,
          }),
        );
      } else {
        showToast(t("toast.importFailed", { message: t("toast.importBadFile") }));
      }
    } catch (error) {
      showToast(t("toast.importFailed", { message: errorMessage(error) }));
    }
  }, [showToast]);

  /** Async wrapper for imported image migration: resolve all target paths, then rewrite the source once. */
  const rewriteImagePathsAsync = useCallback(
    async (
      source: string,
      refs: ReturnType<typeof findRelativeImages>,
      targetFor: (ref: (typeof refs)[number]) => Promise<string | null>,
    ) => {
      const targets = new Map<number, string>();
      for (const ref of refs) {
        const target = await targetFor(ref);
        if (target) targets.set(ref.from, target);
      }
      return rewriteImagePaths(source, refs, (ref) => targets.get(ref.from) ?? null);
    },
    [],
  );

  /** Drag-to-reorder in the browser; on desktop the disk dictates order, so this isn't offered. */
  const reorderDocs = useCallback((ids: string[]) => {
    workspaceRef.current?.reorder(ids);
    void backendRef.current?.reorder?.(ids);
  }, []);

  /** Switch the workspace folder: persist, reload the page, and rebuild everything for the new folder. */
  const switchFolder = useCallback(async () => {
    if (!isDesktop()) {
      showToast(t("toast.desktopOnly"));
      return;
    }
    try {
      const picked = await pickFolder();
      if (!picked) return;
      // Before switching, flush pending renames and unsaved edits so nothing is lost in a debounce window
      await renamerRef.current?.flush();
      await autosaveRef.current?.flush();
      persistRoot(picked);
      window.location.reload();
    } catch (error) {
      showToast(t("toast.folderPickFailed", { message: errorMessage(error) }));
    }
  }, [showToast]);

  /** Reveal the current workspace folder in the system file manager. */
  const revealFolder = useCallback(async () => {
    const root = filesRef.current?.root;
    if (!root) return;
    try {
      await desktopFs.reveal(root);
    } catch (error) {
      showToast(t("toast.revealFailed", { message: errorMessage(error) }));
    }
  }, [showToast]);

  const deleteDoc = useCallback(
    async (id: string) => {
      const workspace = workspaceRef.current;
      const autosave = autosaveRef.current;
      if (!workspace) return;
      if (!workspace.remove(id)) {
        showToast(t("toast.cannotDeleteLast"));
        return;
      }
      // Cancel pending renames and writes, wait for any in-flight write, then touch the file:
      // otherwise a debounce timer or ongoing write could recreate the just-deleted file.
      renamerRef.current?.cancel(id);
      autosave?.cancel(id);
      await autosave?.settled(id);
      mutationRef.current += 1;
      void backendRef.current?.remove(id);

      // Desktop: after deletion, trash images no document references (move to trash, don't delete outright)
      const files = filesRef.current;
      if (files?.root) {
        void (async () => {
          try {
            const names = await desktopAssets.list(files.root);
            if (!names.length) return;
            const sources = workspace
              .summaries()
              .map((summary) => workspace.get(summary.id)?.source ?? "");
            const orphans = findOrphanAssets(sources, names);
            for (const name of orphans) {
              await desktopAssets.trash(files.root, name, `${files.root}/.vellink-trash/assets`);
            }
          } catch {
            // Cleanup failure shouldn't override the primary result: the document was deleted
          }
        })();
      }
      showToast(t("toast.docDeleted"));
    },
    [showToast],
  );

  const saveNow = useCallback(async () => {
    const workspace = workspaceRef.current;
    const autosave = autosaveRef.current;
    const id = activeIdRef.current;
    if (!workspace || !autosave || !id) return;
    const doc = workspace.get(id);
    if (!doc) return;
    autosave.schedule(doc);
    await autosave.flush(id);
    // ⌘S also flushes pending renames: a manual save should align the file name immediately
    await renamerRef.current?.flush();
    showToast(t("toast.savedNow"));
  }, [showToast]);

  /* ------------------------------ Image assets ------------------------------ */

  /** Pasted/dropped images: write to the workspace folder on desktop, fall back to data URIs in the browser. */
  const handleImages = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        if (!isImageType(file.type)) continue;
        if (file.size > MAX_IMAGE_BYTES) {
          showToast(t("toast.imageTooLarge"));
          continue;
        }
        try {
          const bytes = await shrinkImage(file, settingsRef.current.maxImageEdge);
          const name = assetName(file.name, file.type, bytes);
          if (!name) {
            showToast(t("toast.imageFailed"));
            continue;
          }
          const root = filesRef.current?.root;
          const target =
            isDesktop() && root
              ? await desktopAssets.write(root, name, bytes)
              : dataUriOf(bytes, file.type);
          editorRef.current?.insertMarkdown(imageMarkdown(file.name, target), { block: true });
          showToast(t("toast.imageInserted"));
        } catch (error) {
          showToast(t("toast.imageFailed", { message: errorMessage(error) }));
        }
      }
    },
    [showToast],
  );

  /** Inline local images before HTML/PDF export; Markdown keeps relative paths. */
  const inlineImagesForExport = useCallback(async (source: string) => {
    const root = filesRef.current?.root;
    // Images pasted in the browser are already data URIs; there's no local path to resolve
    if (!isDesktop() || !root) return source;
    return inlineLocalImages(source, async (path) => {
      if (!isAssetPath(path)) return null;
      const name = path.slice(ASSET_DIR.length + 1);
      if (!name || name.includes("/")) return null;
      const mime = mimeFromAssetPath(path);
      if (!mime) return null;
      try {
        const bytes = await desktopAssets.read(root, name);
        return dataUriOf(Uint8Array.from(bytes), mime);
      } catch {
        // Image deleted externally: keep the original path rather than losing the document body
        return null;
      }
    });
  }, []);

  /* ------------------------------ Export ------------------------------ */

  const openExport = useCallback(() => {
    // Snapshot the selection when opening: the dialog is modal, so it can't change afterwards
    setExportSelection(editorRef.current?.selectionRange() ?? null);
    setExportOpen(true);
  }, []);

  const runExport = useCallback(
    async (format: ExportFormat, scope: ExportScope) => {
      const workspace = workspaceRef.current;
      const id = activeIdRef.current;
      const doc = id ? workspace?.get(id) : undefined;
      if (!doc) {
        showToast(t("export.failed", { message: t("export.noDoc") }));
        return;
      }
      setExporting(true);
      try {
        // Export what's on screen: include unsaved edits instead of waiting for autosave.
        //
        // Narrow the selection before inlining images: inlining replaces relative paths with
        // long data URIs, which shifts all source offsets, so buildExport can't slice by the
        // original range afterwards.
        const requested = scope === "selection" ? clampRange(doc.source, exportSelection) : null;
        const picked = requested ? doc.source.slice(requested.from, requested.to) : null;
        const selected = picked && picked.trim() ? picked : null;
        const exportSource =
          format === "markdown"
            ? (selected ?? doc.source)
            : await inlineImagesForExport(selected ?? doc.source);
        const payload = await buildExport({
          format,
          title: doc.title,
          source: exportSource,
          partial: Boolean(selected),
          selectionSuffix: t("export.fileSuffix.selection"),
          lang: locale,
          customCss: settings.customCss,
          imageBase: settings.imageBase,
        });

        if (format === "pdf") {
          // Close the dialog before mounting the print snapshot: the dialog shouldn't appear on paper
          setExportOpen(false);
          setPrintSheet({
            html: String(payload.contents),
            // The print dialog's default filename comes from document.title
            title: payload.fileName.replace(/\.pdf$/i, ""),
          });
          return;
        }

        const result = await saveExportFile(payload, {
          defaultDir: filesRef.current?.root ?? null,
        });
        if (!result.saved) return;
        setExportOpen(false);
        showToast(t("export.done", { name: payload.fileName }));
      } catch (error) {
        showToast(t("export.failed", { message: errorMessage(error) }));
      } finally {
        setExporting(false);
      }
    },
    [exportSelection, locale, showToast, inlineImagesForExport],
  );

  /**
   * PDF: mount the body into the print sheet, then open the system print dialog two frames later.
   *
   * The two frames are intentional: the first lets React commit the DOM, the second lets
   * stylesheets and font substitution settle. Skipping one may hand the print dialog a blank,
   * unlaid-out page.
   */
  useEffect(() => {
    const sheet = printSheet;
    if (!sheet) return;
    let cancelled = false;
    const previousTitle = document.title;
    if (sheet.title) document.title = sheet.title;

    const clear = () => {
      if (cancelled) return;
      document.title = previousTitle;
      setPrintSheet(null);
    };
    window.addEventListener("afterprint", clear);

    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void printCurrentWindow().catch((error) => {
          if (!cancelled) {
            showToast(t("export.failed", { message: errorMessage(error) }));
          }
        });
      });
    });
    // Some platforms never dispatch afterprint: clean up as a fallback so the sheet doesn't linger
    const timer = window.setTimeout(clear, 120_000);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", clear);
      document.title = previousTitle;
    };
  }, [printSheet, showToast]);

  const selectDoc = useCallback((id: string) => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    workspace.setActive(id);
  }, []);

  const jumpTo = useCallback((offset: number) => {
    editorRef.current?.seek(offset);
  }, []);

  /** Library-wide search hit: switch to that document and jump to the source offset. */
  const pendingSeekRef = useRef<{ id: string; offset: number; length: number } | null>(null);
  const seekTokenRef = useRef(0);

  const openNoteHit = useCallback((id: string, offset: number, length: number) => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    if (workspace.activeId === id) {
      editorRef.current?.seek(offset, length);
      return;
    }
    pendingSeekRef.current = { id, offset, length };
    workspace.setActive(id);
  }, []);

  // Switching documents rebuilds the editor: wait until it mounts the new store before seeking; don't rely on a single rAF
  useEffect(() => {
    const pending = pendingSeekRef.current;
    if (!pending || pending.id !== activeId) return;
    pendingSeekRef.current = null;
    const token = (seekTokenRef.current += 1);
    let attempts = 0;
    const trySeek = () => {
      if (token !== seekTokenRef.current) return;
      attempts += 1;
      if (editorRef.current?.seek(pending.offset, pending.length)) return;
      if (attempts < 12) window.setTimeout(trySeek, 40);
    };
    const timer = window.setTimeout(trySeek, 40);
    return () => window.clearTimeout(timer);
  }, [activeId]);

  /** Data source for the command palette's library-wide search. */
  const searchNotes = useCallback(
    (query: string): CommandItem[] => {
      const workspace = workspaceRef.current;
      if (!workspace) return [];
      return workspace.search(query, { limit: 6 }).map((hit) => {
        // The last two segments are offset and length; paths may contain colons, so split from the end
        const action = `note:${hit.id}:${hit.offset}:${hit.length}`;
        return {
          id: action,
          label: hit.title,
          icon: "file" as const,
          hint: hit.snippet,
          group: t("palette.notes"),
          action,
        };
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- group names must follow locale changes
    [locale],
  );

  /* ------------------------------ Settings · theme and shortcuts ------------------------------ */

  /**
   * Settings take effect and are saved immediately.
   *
   * Writing CSS variables and calling Autosave.setDelay both live here: the settings dialog
   * only updates state. Keeping side effects in one place avoids drift such as changing the
   * font size in the dialog while the export preview stays unchanged.
   */
  useLayoutEffect(() => {
    settingsRef.current = settings;
    // Write CSS variables during the layout phase: a frame later, a user with a saved 20px font would briefly see 16px
    applySettings(settings);
    applyCustomCss(document, settings.customCss);
    document.body.classList.toggle("number-headings", settings.headingNumbers);
    saveSettings(settings);
    autosaveRef.current?.setDelay(settings.autosaveMs);
  }, [settings]);

  useEffect(() => {
    // When following the system, track appearance changes; with a fixed light/dark theme this listener does nothing
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const sync = () => setSystemDark(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    document.body.dataset.t = theme;
  }, [theme]);

  useEffect(() => {
    document.body.classList.toggle("focus-mode", mode === "focus");
  }, [mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) {
        if (e.key === "Escape") {
          setPaletteOpen(false);
          editorRef.current?.closeFind();
        }
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "p") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (key === "f") {
        e.preventDefault();
        editorRef.current?.openFind();
      } else if (key === "z") {
        e.preventDefault();
        const ok = e.shiftKey
          ? editorRef.current?.redo()
          : editorRef.current?.undo();
        showToast(ok ? (e.shiftKey ? t("toast.redone") : t("toast.undone")) : t("toast.nothingToUndo"));
      } else if (key === "y") {
        e.preventDefault();
        showToast(editorRef.current?.redo() ? t("toast.redone") : t("toast.nothingToRedo"));
      } else if (key === "n") {
        e.preventDefault();
        void createDoc();
      } else if (key === "o") {
        e.preventDefault();
        if (e.shiftKey) void importDocs();
        else void switchFolder();
      } else if (key === "s") {
        e.preventDefault();
        if (e.shiftKey) {
          void runtimeRef.current?.runCommand("webdav.sync").then(({ ok, notified }) => {
            if (!notified) showToast(ok ? t("toast.syncDone") : t("toast.syncNeedConfig"));
          });
        } else {
          void saveNow();
        }
      } else if (key === "e") {
        e.preventDefault();
        openExport();
      } else if (key === "t" && e.shiftKey) {
        e.preventDefault();
        setTableOpen(true);
      } else if (key === ",") {
        // Platform convention: ⌘, opens Preferences
        e.preventDefault();
        setSettingsOpen((v) => !v);
      } else if (key === "u") {
        e.preventDefault();
        void updater.check(true);
      } else if (e.key === "1") {
        e.preventDefault();
        setEditorMode("source");
        showToast(t("toast.sourceMode"));
      } else if (e.key === "2") {
        e.preventDefault();
        setEditorMode("wysiwyg");
        showToast(t("toast.wysiwygMode"));
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showToast, locale, createDoc, importDocs, saveNow, switchFolder, openExport, updater]);

  const changeMode = (m: AppMode) => {
    setMode(m);
    const manage = m === "manage";
    setLeftOpen(manage);
    setRightOpen(manage);
    showToast(manage ? t("toast.manageMode") : t("toast.focusMode"));
  };

  const togglePlugin = async (id: string) => {
    const runtime = runtimeRef.current;
    const plugin = runtime?.get(id);
    if (!runtime || !plugin) return;
    const next = !plugin.enabled;
    await runtime.setEnabled(id, next);
    persistPluginEnabled(id, next);
    setPluginSummaries(runtime.list());
    showToast(t(next ? "toast.pluginEnabled" : "toast.pluginDisabled", { name: plugin.name }));
  };

  const runCommand = (cmd: CommandItem) => {
    /** Command labels/groups hold i18n keys; plugin command titles are passed through verbatim. */
    const label = cmd.label.includes(".") && !cmd.label.includes(" ") ? t(cmd.label) : cmd.label;
    // Library search hit: the last segment of the id is the offset (paths may contain colons)
    if (cmd.action.startsWith("note:")) {
      const rest = cmd.action.slice("note:".length);
      const lengthAt = rest.lastIndexOf(":");
      const offsetAt = rest.lastIndexOf(":", lengthAt - 1);
      if (offsetAt > 0) {
        openNoteHit(
          rest.slice(0, offsetAt),
          Number(rest.slice(offsetAt + 1, lengthAt)) || 0,
          Number(rest.slice(lengthAt + 1)) || 0,
        );
      }
      return;
    }
    if (cmd.action.startsWith("plugin:")) {
      const id = cmd.action.slice("plugin:".length);
      void runtimeRef.current?.runCommand(id).then(({ ok, notified }) => {
        if (!notified) showToast(ok ? t("toast.executed", { label }) : t("toast.executeFailed", { label }));
      });
      return;
    }
    switch (cmd.action) {
      case "source":
        setEditorMode((m) => (m === "wysiwyg" ? "source" : "wysiwyg"));
        showToast(
          editorMode === "wysiwyg" ? t("toast.sourceMode") : t("toast.wysiwygMode"),
        );
        break;
      case "new-doc":
        void createDoc();
        break;
      case "import":
        void importDocs();
        break;
      case "save":
        void saveNow();
        break;
      case "find":
        editorRef.current?.openFind();
        break;
      case "open-folder":
        void switchFolder();
        break;
      case "undo":
        showToast(editorRef.current?.undo() ? t("toast.undone") : t("toast.nothingToUndo"));
        break;
      case "redo":
        showToast(editorRef.current?.redo() ? t("toast.redone") : t("toast.nothingToRedo"));
        break;
      case "ai-continue":
        setActiveTab("ai");
        if (mode === "focus") changeMode("manage");
        showToast(t("toast.aiContinue"));
        break;
      case "sync":
        void runtimeRef.current?.runCommand("webdav.sync").then(({ ok, notified }) => {
          if (!notified) showToast(ok ? t("toast.syncDone") : t("toast.syncNeedConfig"));
        });
        break;
      case "check-update":
        void updater.check(true);
        break;
      case "export":
        openExport();
        break;
      case "insert-table":
        setTableOpen(true);
        break;
      case "settings":
        setSettingsOpen(true);
        break;
      default:
        showToast(label);
    }
  };

  /* ------------------------------ Render ------------------------------ */

  const activeSummary = activeId ? docs.find((doc) => doc.id === activeId) : undefined;
  const activeDoc = activeId ? workspaceRef.current?.get(activeId) : undefined;
  const docTitle = activeDoc?.title ?? "Vellink";
  const saveState: SaveState | "dirty" = (() => {
    if (!activeId) return "idle";
    const doc = workspaceRef.current?.get(activeId);
    if (saveStates[activeId] === "saving") return "saving";
    if (saveStates[activeId] === "error") return "error";
    return doc && doc.source !== doc.savedSource ? "dirty" : "idle";
  })();

  return (
    <div className={`app ${printSheet ? "has-print-sheet" : ""}`}>
      <IconSprite />
      <TitleBar
        mode={mode}
        theme={theme}
        leftOpen={mode === "manage" && leftOpen}
        rightOpen={mode === "manage" && rightOpen}
        docName={docTitle}
        onModeChange={changeMode}
        onThemeToggle={() => {
          // Clicking the sun/moon = an explicit light/dark choice; stop following the system (which is the user's intent)
          const next: Theme = theme === "dark" ? "light" : "dark";
          setSettings((prev) => ({ ...prev, theme: next }));
          showToast(next === "dark" ? t("toast.darkTheme") : t("toast.lightTheme"));
        }}
        onToggleLeft={() => setLeftOpen((v) => !v)}
        onToggleRight={() => setRightOpen((v) => !v)}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="body">
        <FileDrawer
          docs={docs.map((doc) => ({
            id: doc.id,
            uid: doc.uid,
            title: doc.title,
            dirty: doc.dirty,
            fileName: storage.kind === "files" ? baseName(doc.id) : undefined,
          }))}
          activeId={activeId}
          collapsed={mode === "focus" || !leftOpen}
          onSelect={selectDoc}
          onNew={() => void createDoc()}
          onImport={() => void importDocs()}
          onDelete={deleteDoc}
          onReorder={storage.kind === "browser" ? reorderDocs : undefined}
          workspaceDir={storage.root}
          onOpenFolder={() => void switchFolder()}
          onRevealFolder={() => void revealFolder()}
        />

        <Editor
          key={activeSummary?.uid ?? "empty"}
          ref={editorRef}
          store={active && active.id === activeId ? active.store : null}
          docId={activeId ?? ""}
          docUid={activeSummary?.uid ?? ""}
          docName={docTitle}
          mode={editorMode}
          onStats={handleStats}
          typewriter={settings.typewriter}
          focusLines={settings.focusLines}
          onNotify={showToast}
          onImages={(files) => void handleImages(files)}
        />

        <SideDrawer
          tab={activeTab}
          collapsed={mode === "focus" || !rightOpen}
          onTabChange={setActiveTab}
          outline={outline}
          onJump={jumpTo}
          plugins={plugins}
          pluginErrors={pluginErrors}
          onTogglePlugin={togglePlugin}
          runtime={runtimeReady}
          notify={showToast}
        />
      </div>

      <StatusBar
        pluginCount={plugins.filter((p) => p.enabled).length}
        stats={stats}
        saveState={saveState}
        savedAt={savedAt}
        docCount={docs.length}
        dirtyCount={docs.filter((doc) => doc.dirty).length}
        storageKind={storage.kind}
        storagePath={storage.root}
        liveWatch={liveWatch}
        version={updater.currentVersion}
        onCheckUpdate={() => void updater.check(true)}
      />

      <CommandPalette
        open={paletteOpen}
        commands={paletteCommands}
        onClose={() => setPaletteOpen(false)}
        onRun={runCommand}
        searchNotes={searchNotes}
      />

      <UpdateNotice updater={updater} />

      <ExportDialog
        open={exportOpen}
        title={docTitle}
        selection={exportSelection}
        busy={exporting}
        onClose={() => setExportOpen(false)}
        onExport={(format, scope) => void runExport(format, scope)}
      />

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onChange={setSettings}
        onClose={() => setSettingsOpen(false)}
      />

      <TableDialog
        open={tableOpen}
        onClose={() => setTableOpen(false)}
        onInsert={insertTable}
      />
      {printSheet && (
        <>
          {/* Print sheet styles are isolated from the app: every selector is scoped under .print-sheet */}
          <style>{docCss(".print-sheet", { dark: false })}</style>
          <div
            className="print-sheet"
            dangerouslySetInnerHTML={{ __html: printSheet.html }}
          />
        </>
      )}

      <div className={`hint ${toast ? "show" : ""}`}>{toast}</div>
    </div>
  );
}

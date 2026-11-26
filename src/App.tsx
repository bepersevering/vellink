import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocumentStore } from "./core/store";
import type { PluginRuntime, PluginSummary } from "./core/plugin/runtime";
import { createPluginRuntime, persistPluginEnabled } from "./plugins/loader";
import { createLocalCredentialStore } from "./core/vfs/credentials";
import { buildOutline, type OutlineEntry } from "./core/outline";
import { fallbackDocument, seedDocuments } from "./core/seed";
import { Workspace, type DocSummary, type ExternalFile } from "./core/workspace";
import { persistRoot, resolveWorkspaceEnv } from "./core/workspace-env";
import { desktopFs, isDesktop, onFsChanged, pickFolder } from "./core/desktop/bridge";
import type { FileWorkspaceBackend } from "./core/workspace-fs";
import { FileChangeDetector } from "./core/file-changes";
import { TitleRenamer } from "./core/title-rename";
import {
  Autosave,
  type SaveState,
  type WorkspaceBackend,
} from "./core/workspace-storage";
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
import { IconSprite } from "./ui/Icon";
import { commands as commandItems, type PluginInfo, type CommandItem } from "./ui/data";

/** Tauri 命令的错误是字符串；本地异常走 message。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 路径里的文件名（文件后端下 id 就是绝对路径）。 */
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
  });
  const [theme, setTheme] = useState<Theme>(() =>
    (localStorage.getItem("vellink-theme") as Theme) === "dark" ? "dark" : "light",
  );
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>("outline");
  const [pluginSummaries, setPluginSummaries] = useState<PluginSummary[]>([]);
  const [pluginErrors, setPluginErrors] = useState<string[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState("");

  /** 自动更新：启动后静默查一次，右下角版本号可手动查。 */
  const updater = useUpdater();

  // 工作区状态
  const [ready, setReady] = useState(false);
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<{ id: string; store: DocumentStore } | null>(null);
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /** 文档存在哪：本地文件夹 or 浏览器 localStorage。 */
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
  /** 标题跟随文件名：改完标题静一会儿就把磁盘文件也改名。 */
  const renamerRef = useRef<TitleRenamer | null>(null);
  /** 外部变更检测器，由下面的监听 effect 装配。 */
  const detectorRef = useRef<FileChangeDetector | null>(null);
  /**
   * 本地结构性改动（重命名、删除）的计数器。
   *
   * 扫描是异步的：如果扫描途中文件被改名，它拿到的快照就会「旧路径在、新路径
   * 不在」，照此执行会把刚改名的文档当成被外部删除。计数器一变就丢弃这一轮。
   */
  const mutationRef = useRef(0);
  const [liveWatch, setLiveWatch] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 1800);
  }, []);

  const handleStats = useCallback((next: DocStats) => setStats(next), []);

  /* ------------------------------ 工作区启动 ------------------------------ */

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => undefined as void;

    void (async () => {
      // 桌面端读写本地文件夹，浏览器退回 localStorage；后端三方法一致
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
            // 自己写盘也会触发监听事件：标记一下，别把它当成外部改动再读一遍
            detectorRef.current?.markOwn(id);
          },
          onError: () => showToast(t("toast.saveFailed")),
        },
        700,
      );
      autosaveRef.current = autosave;

      const stored = await env.backend.load();
      if (cancelled) return;

      // 空目录：首次使用给两篇种子，否则只放一篇空白起步（不反复播种）
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

      // 文件后端专属：标题变化即重命名对应文件
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

  // 当前文档 → 撤销权威实例
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

  // 有未保存改动就排队（防抖在 Autosave 内部）
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

  // 磁盘变化：文件系统事件为主，30 秒轮询只是兜底（网络盘 / 事件丢失时）
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
        // 扫描期间本地改过名 / 删过文件：这一份快照已经不可信
        if (generation !== mutationRef.current) {
          schedule();
          return;
        }
        const { candidates, present } = detector.diff(entries);
        const changed: ExternalFile[] = [];
        for (const candidate of candidates) {
          const doc = workspaceRef.current?.get(candidate.path);
          // 内存里有未保存改动：以内存为准，等用户自己保存
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
        // 目录被拔掉 / 权限变化：这一轮先跳过，下一轮再试
      }
    };

    const schedule = () => {
      if (stopped) return;
      if (debounce) window.clearTimeout(debounce);
      // 一次保存会连发好几条事件，合并成一个窗口再扫
      debounce = window.setTimeout(() => {
        debounce = null;
        void scan();
      }, 200);
    };

    let unlisten = () => undefined as void;
    void (async () => {
      // 先记一份基线，启动时不该把整库文档当外部改动重读一遍
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
        // 监听不可用就只靠轮询，功能不残
        console.warn("[vellink] 目录监听不可用，退回轮询", error);
      }
    })();

    const onVisible = () => {
      if (document.visibilityState === "visible") schedule();
    };
    // 合盖 / 切回来时 FSEvents 可能漏事件，重新扫一次
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

  // 标题变了就让文件名跟上（文件后端专属，防抖在 TitleRenamer 内部）
  useEffect(() => {
    const renamer = renamerRef.current;
    if (!renamer || !activeId) return;
    const summary = docs.find((doc) => doc.id === activeId);
    if (!summary) return;
    // 只有本地编辑才改名：外部工具改了 H1 不动它的文件名
    renamer.observe(summary.id, summary.uid, summary.title, summary.dirty);
  }, [docs, activeId]);

  // 大纲跟随当前文档，输入时防抖，避免每个字符都全量解析
  const activeSource = useMemo(
    () => (activeId ? (workspaceRef.current?.get(activeId)?.source ?? "") : ""),
    // docs 每次变更即代表正文变化（source 不在摘要里，借 updatedAt 触发）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeId, docs],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setOutline(buildOutline(activeSource)), 200);
    return () => window.clearTimeout(timer);
  }, [activeSource]);

  /* ------------------------------ 插件 ------------------------------ */

  useEffect(() => {
    let disposed = false;
    void createPluginRuntime({
      getStore: () => activeStoreRef.current,
      notify: showToast,
      credentialStore: createLocalCredentialStore(),
    }).then(({ runtime, errors }) => {
      // runtime 是应用级单例：StrictMode 的第一次 cleanup 不可销毁它，
      // 否则第二次挂载会拿到已 dispose 的实例。
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- locale 切换时重新解析文案
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- locale 切换时重新解析文案
    [pluginSummaries, locale],
  );

  /* ------------------------------ 文档操作 ------------------------------ */

  const createDoc = useCallback(async () => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const title = t("doc.untitled");
    // 文件后端：先定下磁盘路径（避开目录里已有同名文件），再建文档
    const id = filesRef.current ? await filesRef.current.newPath(title) : undefined;
    workspace.create(title, id);
    showToast(t("toast.docCreated"));
  }, [showToast]);

  /** 切换工作区目录：写盘后整页重载，工作区按新目录重建。 */
  const switchFolder = useCallback(async () => {
    if (!isDesktop()) {
      showToast(t("toast.desktopOnly"));
      return;
    }
    try {
      const picked = await pickFolder();
      if (!picked) return;
      // 换目录前把「待改的名」和没落盘的改动都写掉，避免丢在防抖窗口里
      await renamerRef.current?.flush();
      await autosaveRef.current?.flush();
      persistRoot(picked);
      window.location.reload();
    } catch (error) {
      showToast(t("toast.folderPickFailed", { message: errorMessage(error) }));
    }
  }, [showToast]);

  /** 在系统文件管理器里定位当前工作区目录。 */
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
      // 先撤掉待改的名与待写任务，再等飞行中的那次写完，最后才动文件：
      // 否则防抖计时器或进行中的写入会把刚删掉的文件又写回来
      renamerRef.current?.cancel(id);
      autosave?.cancel(id);
      await autosave?.settled(id);
      mutationRef.current += 1;
      void backendRef.current?.remove(id);
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
    // ⌘S 顺带落实待改的文件名：用户手动保存时，文件名也该当场对齐
    await renamerRef.current?.flush();
    showToast(t("toast.savedNow"));
  }, [showToast]);

  const selectDoc = useCallback((id: string) => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    workspace.setActive(id);
  }, []);

  const jumpTo = useCallback((offset: number) => {
    editorRef.current?.seek(offset);
  }, []);

  /* ------------------------------ 主题与快捷键 ------------------------------ */

  useEffect(() => {
    document.body.dataset.t = theme;
    localStorage.setItem("vellink-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.body.classList.toggle("focus-mode", mode === "focus");
  }, [mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) {
        if (e.key === "Escape") setPaletteOpen(false);
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "p") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
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
        void switchFolder();
      } else if (key === "s") {
        e.preventDefault();
        if (e.shiftKey) {
          void runtimeRef.current?.runCommand("webdav.sync").then(({ ok, notified }) => {
            if (!notified) showToast(ok ? t("toast.syncDone") : t("toast.syncNeedConfig"));
          });
        } else {
          void saveNow();
        }
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
  }, [showToast, locale, createDoc, saveNow, switchFolder]);

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
    /** 命令 label/group 存的是 i18n key；插件命令的标题原样透传。 */
    const label = cmd.label.includes(".") && !cmd.label.includes(" ") ? t(cmd.label) : cmd.label;
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
      case "save":
        void saveNow();
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
      default:
        showToast(label);
    }
  };

  /* ------------------------------ 渲染 ------------------------------ */

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
    <div className="app">
      <IconSprite />
      <TitleBar
        mode={mode}
        theme={theme}
        leftOpen={mode === "manage" && leftOpen}
        rightOpen={mode === "manage" && rightOpen}
        docName={docTitle}
        onModeChange={changeMode}
        onThemeToggle={() => {
          setTheme((prev) => {
            showToast(prev === "dark" ? t("toast.lightTheme") : t("toast.darkTheme"));
            return prev === "dark" ? "light" : "dark";
          });
        }}
        onToggleLeft={() => setLeftOpen((v) => !v)}
        onToggleRight={() => setRightOpen((v) => !v)}
        onOpenPalette={() => setPaletteOpen(true)}
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
          onDelete={deleteDoc}
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
      />

      <UpdateNotice updater={updater} />

      <div className={`hint ${toast ? "show" : ""}`}>{toast}</div>
    </div>
  );
}

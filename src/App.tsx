import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocumentStore } from "./core/store";
import type { PluginRuntime, PluginSummary } from "./core/plugin/runtime";
import { createPluginRuntime, persistPluginEnabled } from "./plugins/loader";
import { createLocalCredentialStore } from "./core/vfs/credentials";
import { buildOutline, type OutlineEntry } from "./core/outline";
import { seedDocuments } from "./core/seed";
import { Workspace, type DocSummary } from "./core/workspace";
import {
  Autosave,
  createLocalWorkspaceBackend,
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
import { CommandPalette } from "./ui/CommandPalette";
import { IconSprite } from "./ui/Icon";
import { commands as commandItems, type PluginInfo, type CommandItem } from "./ui/data";

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

  // 工作区状态
  const [ready, setReady] = useState(false);
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<{ id: string; store: DocumentStore } | null>(null);
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const toastTimer = useRef<number | null>(null);
  const editorRef = useRef<EditorHandle>(null);
  const workspaceRef = useRef<Workspace | null>(null);
  const backendRef = useRef<WorkspaceBackend | null>(null);
  const autosaveRef = useRef<Autosave | null>(null);
  const activeStoreRef = useRef<DocumentStore | null>(null);
  const runtimeRef = useRef<PluginRuntime | null>(null);
  const [runtimeReady, setRuntimeReady] = useState<PluginRuntime | null>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 1800);
  }, []);

  const handleStats = useCallback((next: DocStats) => setStats(next), []);

  /* ------------------------------ 工作区启动 ------------------------------ */

  useEffect(() => {
    let cancelled = false;
    const backend = createLocalWorkspaceBackend();
    backendRef.current = backend;

    const autosave = new Autosave(
      backend,
      {
        onState: (id, state) =>
          setSaveStates((prev) => (prev[id] === state ? prev : { ...prev, [id]: state })),
        onSaved: (id, source) => {
          workspaceRef.current?.markSaved(id, source);
          setSavedAt(Date.now());
        },
        onError: () => showToast(t("toast.saveFailed")),
      },
      700,
    );
    autosaveRef.current = autosave;

    let unsubscribe = () => undefined as void;
    void (async () => {
      const stored = await backend.load();
      if (cancelled) return;

      // 首次启动：写入种子文档并立即落盘，避免每次启动重新播种
      let initial = stored && stored.length > 0 ? stored : seedDocuments(Date.now());
      if (!stored || stored.length === 0) {
        for (const doc of initial) await backend.save(doc);
      }

      const workspace = new Workspace(initial);
      workspaceRef.current = workspace;
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
      autosave.dispose();
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

  const createDoc = useCallback(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    workspace.create(t("doc.untitled"));
    showToast(t("toast.docCreated"));
  }, [showToast]);

  const deleteDoc = useCallback(
    (id: string) => {
      const workspace = workspaceRef.current;
      if (!workspace) return;
      if (!workspace.remove(id)) {
        showToast(t("toast.cannotDeleteLast"));
        return;
      }
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
        createDoc();
      } else if (key === "s") {
        e.preventDefault();
        if (e.shiftKey) {
          void runtimeRef.current?.runCommand("webdav.sync").then(({ ok, notified }) => {
            if (!notified) showToast(ok ? t("toast.syncDone") : t("toast.syncNeedConfig"));
          });
        } else {
          void saveNow();
        }
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
  }, [showToast, locale, createDoc, saveNow]);

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
        createDoc();
        break;
      case "save":
        void saveNow();
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
      default:
        showToast(label);
    }
  };

  /* ------------------------------ 渲染 ------------------------------ */

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
          docs={docs.map((doc) => ({ id: doc.id, title: doc.title, dirty: doc.dirty }))}
          activeId={activeId}
          collapsed={mode === "focus" || !leftOpen}
          onSelect={selectDoc}
          onNew={createDoc}
          onDelete={deleteDoc}
        />

        <Editor
          key={activeId ?? "empty"}
          ref={editorRef}
          store={active && active.id === activeId ? active.store : null}
          docId={activeId ?? ""}
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
      />

      <CommandPalette
        open={paletteOpen}
        commands={paletteCommands}
        onClose={() => setPaletteOpen(false)}
        onRun={runCommand}
      />

      <div className={`hint ${toast ? "show" : ""}`}>{toast}</div>
    </div>
  );
}

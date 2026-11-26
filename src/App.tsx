import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocumentStore } from "./core/store";
import type { PluginRuntime, PluginSummary } from "./core/plugin/runtime";
import { createPluginRuntime, persistPluginEnabled } from "./plugins/loader";
import { createLocalCredentialStore } from "./core/vfs/credentials";
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
import {
  commands as commandItems,
  fileTree,
  outline,
  type PluginInfo,
  type TreeItem,
  type CommandItem,
} from "./ui/data";

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
  const [activeFile, setActiveFile] = useState<TreeItem>(fileTree[1]);
  const [activeTab, setActiveTab] = useState<PanelTab>("outline");
  const [pluginSummaries, setPluginSummaries] = useState<PluginSummary[]>([]);
  const [pluginErrors, setPluginErrors] = useState<string[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | null>(null);
  const editorRef = useRef<EditorHandle>(null);
  const storeRef = useRef<DocumentStore | null>(null);
  const runtimeRef = useRef<PluginRuntime | null>(null);
  const [runtimeReady, setRuntimeReady] = useState<PluginRuntime | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 1800);
  }, []);

  const handleStats = useCallback((next: DocStats) => setStats(next), []);
  const handleStoreReady = useCallback((store: DocumentStore | null) => {
    storeRef.current = store;
  }, []);

  // 发现并加载插件：坏 manifest / 入口缺失只记录错误，不影响编辑器启动。
  useEffect(() => {
    let disposed = false;
    void createPluginRuntime({
      getStore: () => storeRef.current,
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

  useEffect(() => {
    document.body.dataset.t = theme;
    localStorage.setItem("vellink-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.body.classList.toggle("focus-mode", mode === "focus");
  }, [mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        const ok = e.shiftKey
          ? editorRef.current?.redo()
          : editorRef.current?.undo();
        showToast(ok ? (e.shiftKey ? t("toast.redone") : t("toast.undone")) : t("toast.nothingToUndo"));
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        showToast(editorRef.current?.redo() ? t("toast.redone") : t("toast.nothingToRedo"));
      } else if ((e.metaKey || e.ctrlKey) && e.key === "1") {
        e.preventDefault();
        setEditorMode("source");
        showToast(t("toast.sourceMode"));
      } else if ((e.metaKey || e.ctrlKey) && e.key === "2") {
        e.preventDefault();
        setEditorMode("wysiwyg");
        showToast(t("toast.wysiwygMode"));
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showToast, locale]);

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
      case "open-current":
      case "open-secondbrain":
        showToast(t("toast.openedDoc", { label }));
        break;
      default:
        showToast(label);
    }
  };

  return (
    <div className="app">
      <IconSprite />
      <TitleBar
        mode={mode}
        theme={theme}
        leftOpen={mode === "manage" && leftOpen}
        rightOpen={mode === "manage" && rightOpen}
        docName={activeFile.label}
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
          items={fileTree}
          activeId={activeFile.id}
          collapsed={mode === "focus" || !leftOpen}
          onSelect={(item) => setActiveFile(item)}
        />

        <Editor
          ref={editorRef}
          docName={activeFile.label}
          mode={editorMode}
          onStats={handleStats}
          onStoreReady={handleStoreReady}
        />

        <SideDrawer
          tab={activeTab}
          collapsed={mode === "focus" || !rightOpen}
          onTabChange={setActiveTab}
          outline={outline}
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

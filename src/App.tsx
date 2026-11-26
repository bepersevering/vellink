import { useCallback, useEffect, useRef, useState } from "react";
import { TitleBar, type AppMode, type Theme } from "./ui/TitleBar";
import { FileDrawer } from "./ui/FileDrawer";
import { Editor } from "./ui/Editor";
import { SideDrawer, type PanelTab } from "./ui/SideDrawer";
import { StatusBar } from "./ui/StatusBar";
import { CommandPalette } from "./ui/CommandPalette";
import { IconSprite } from "./ui/Icon";
import {
  commands as commandItems,
  fileTree,
  outline,
  plugins as initialPlugins,
  type PluginInfo,
  type TreeItem,
  type CommandItem,
} from "./ui/data";

export default function App() {
  const [mode, setMode] = useState<AppMode>("focus");
  const [theme, setTheme] = useState<Theme>(() =>
    (localStorage.getItem("vellink-theme") as Theme) === "dark" ? "dark" : "light",
  );
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [activeFile, setActiveFile] = useState<TreeItem>(fileTree[1]);
  const [activeTab, setActiveTab] = useState<PanelTab>("outline");
  const [plugins, setPlugins] = useState<PluginInfo[]>(initialPlugins);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 1800);
  }, []);

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
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const changeMode = (m: AppMode) => {
    setMode(m);
    const manage = m === "manage";
    setLeftOpen(manage);
    setRightOpen(manage);
    showToast(manage ? "管理模式 · 抽屉已展开" : "写作模式 · 界面已隐形");
  };

  const togglePlugin = (id: string) =>
    setPlugins((ps) =>
      ps.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
    );

  const runCommand = (cmd: CommandItem) => {
    switch (cmd.action) {
      case "source":
        showToast("源码模式 · 将在 M2 接入 CodeMirror");
        break;
      case "ai-continue":
        setActiveTab("ai");
        if (mode === "focus") changeMode("manage");
        showToast("AI · 续写当前段落");
        break;
      case "sync":
        showToast("已触发同步（占位）");
        break;
      case "open-current":
      case "open-secondbrain":
        showToast(`打开文档：${cmd.label}`);
        break;
      default:
        showToast(cmd.label);
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
          setTheme((t) => {
            showToast(t === "dark" ? "已切换到亮色主题" : "已切换到暗色主题");
            return t === "dark" ? "light" : "dark";
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

        <Editor docName={activeFile.label} />

        <SideDrawer
          tab={activeTab}
          collapsed={mode === "focus" || !rightOpen}
          onTabChange={setActiveTab}
          outline={outline}
          plugins={plugins}
          onTogglePlugin={togglePlugin}
        />
      </div>

      <StatusBar pluginCount={plugins.filter((p) => p.enabled).length} />

      <CommandPalette
        open={paletteOpen}
        commands={commandItems}
        onClose={() => setPaletteOpen(false)}
        onRun={runCommand}
      />

      <div className={`hint ${toast ? "show" : ""}`}>{toast}</div>
    </div>
  );
}

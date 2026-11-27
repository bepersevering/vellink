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
import { printCurrentWindow, saveExportFile } from "./core/export/save";
import { docCss } from "./core/export/html";
import {
  ASSET_DIR,
  MAX_IMAGE_BYTES,
  assetName,
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
    sourceText: "",
  });
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 系统是否深色：只在设置选了「跟随系统」时参与决定。 */
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );
  const theme = resolveTheme(settings.theme, systemDark);
  /**
   * 只跑一次的启动 effect（工作区初始化）需要读最新设置。
   * 用 ref 而不是把 settings 放进依赖：那会让整个工作区被重新初始化一遍。
   */
  const settingsRef = useRef(settings);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>("outline");
  const [pluginSummaries, setPluginSummaries] = useState<PluginSummary[]>([]);
  const [pluginErrors, setPluginErrors] = useState<string[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState("");
  /** 导出面板与它打开那一刻的选区（选区一变就失效，所以开面板时快照）。 */
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSelection, setExportSelection] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  /** 待打印的正文：PDF 由系统打印面板渲染，不自己编码。 */
  const [printSheet, setPrintSheet] = useState<{
    html: string;
    title: string;
  } | null>(null);

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
        // 用 ref 读：这个 effect 只跑一次，直接闭包 settings 会拿到首帧旧值
        settingsRef.current.autosaveMs,
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

  /** 插入一张空表格：走 insertMarkdown 的块模式，当前行不被拆坏。 */
  const insertTable = useCallback((rows: number, cols: number) => {
    editorRef.current?.insertMarkdown(buildTable(rows, cols), { block: true });
    setTableOpen(false);
    showToast(t("table.inserted"));
  }, [showToast]);

  /**
   * 导入 Markdown 文件。
   *
   * 桌面端先把每篇写进当前工作区目录（拿 newPath 避开重名），再作为「已保存」
   * 的文档加入工作区；浏览器端没有真实文件，交给自动保存写 localStorage。
   * 选进来的文件已经自带完整 Markdown，不再套 newDocumentSource 的标题模板。
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
      // 写盘会触发监听；本批来源是用户主动导入，作废可能正在跑的陈旧扫描
      if (files) mutationRef.current += 1;
      const entries: { title: string; source: string; id?: string; saved?: boolean }[] = [];

      for (const item of plan.items) {
        if (files) {
          // 路径按原文件名推导，不用 H1 标题：标题里的符号 / 中文交给
          // 文件名 slug 逻辑处理，避免把 H1 原样塞进磁盘名。
          const path = await files.newPath(
            titleFromFileName(item.sourceName, t("doc.untitled")),
          );
          await desktopFs.write(path, item.text);
          // 自己写的文件不该被监听器当成外部改动再读一遍
          detectorRef.current?.markOwn(path);
          entries.push({ title: item.title, source: item.text, id: path, saved: true });
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

  /* ------------------------------ 图片资产 ------------------------------ */

  /** 粘贴 / 拖入的图片：桌面端落到工作区目录，浏览器里退回 data URI。 */
  const handleImages = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        if (!isImageType(file.type)) continue;
        if (file.size > MAX_IMAGE_BYTES) {
          showToast(t("toast.imageTooLarge"));
          continue;
        }
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
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

  /** 导出 HTML / PDF 前把本地图片读回来内嵌；Markdown 保留相对路径。 */
  const inlineImagesForExport = useCallback(async (source: string) => {
    const root = filesRef.current?.root;
    // 浏览器里粘进来的本来就是 data URI，没有本地路径要解析
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
        // 图片被外部删了：保留原路径，至少别把正文弄丢
        return null;
      }
    });
  }, []);

  /* ------------------------------ 导出 ------------------------------ */

  const openExport = useCallback(() => {
    // 打开那一刻快照选区：面板是模态的，之后不会有变化的可能
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
        // 导出的是「眼前的正文」：还没落盘的改动也照导，不等自动保存
        //
        // 选区在这一层先切好再内嵌图片：内嵌会把相对路径换成很长的 data URI，
        // 此后源码偏移全变了，不能再让 buildExport 按原区间切一刀。
        const requested = scope === "selection" ? clampRange(doc.source, exportSelection) : null;
        const picked = requested ? doc.source.slice(requested.from, requested.to) : null;
        const selected = picked && picked.trim() ? picked : null;
        const exportSource =
          format === "markdown"
            ? (selected ?? doc.source)
            : await inlineImagesForExport(selected ?? doc.source);
        const payload = buildExport({
          format,
          title: doc.title,
          source: exportSource,
          partial: Boolean(selected),
          selectionSuffix: t("export.fileSuffix.selection"),
          lang: locale,
        });

        if (format === "pdf") {
          // 先关面板再挂打印快照：面板本身不该出现在纸上
          setExportOpen(false);
          setPrintSheet({
            html: payload.contents,
            // 打印对话框的默认文件名取自 document.title
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
   * PDF：正文挂进打印面板 → 两帧后调起系统打印。
   *
   * 两帧不是玄学：第一帧 React 才把 DOM 提交上去，第二帧样式表与字体替换
   * 完成；少等一帧，打印面板可能拿到还没排版的空白页。
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
    // 少数平台不派发 afterprint：兜底清掉，别让打印面板一直挂在外层
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

  /** 全库搜索命中：切到那篇文档并定位到源码偏移。 */
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

  // 切文档会让编辑器整体重建：等它挂上新的 store 再定位，别赌单次 rAF
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

  /** 命令面板的全库搜索数据源。 */
  const searchNotes = useCallback(
    (query: string): CommandItem[] => {
      const workspace = workspaceRef.current;
      if (!workspace) return [];
      return workspace.search(query, { limit: 6 }).map((hit) => {
        // 末尾两段是偏移和长度；路径本身可能带冒号，所以从后往前切
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 切语言时分组名要跟着变
    [locale],
  );

  /* ------------------------------ 设置 · 主题与快捷键 ------------------------------ */

  /**
   * 设置改动立即生效、立即保存。
   *
   * 写 CSS 变量 + 调 Autosave.setDelay 都放在这里：设置面板只负责改 state，
   * 副作用集中在一处，避免「面板里改了字号，导出预览没跟着变」这类偏差。
   */
  useLayoutEffect(() => {
    settingsRef.current = settings;
    // 布局阶段写 CSS 变量：晚一帧的话，存的字号是 20px 的用户会先看到一眼 16px
    applySettings(settings);
    saveSettings(settings);
    autosaveRef.current?.setDelay(settings.autosaveMs);
  }, [settings]);

  useEffect(() => {
    // 跟随系统时，系统外观一变就跟着变；固定浅/深色时这个监听不起作用
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
        // 平台惯例：设置就是 ⌘,（Preferences）
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
    /** 命令 label/group 存的是 i18n key；插件命令的标题原样透传。 */
    const label = cmd.label.includes(".") && !cmd.label.includes(" ") ? t(cmd.label) : cmd.label;
    // 全库搜索命中：id 里最后一段是偏移（路径本身可能带冒号）
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
          // 点一下太阳/月亮 = 明确选择浅色或深色；不再跟随系统（这也是用户的意图）
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
          {/* 打印面板的样式与应用互不影响：所有选择器都挂在 .print-sheet 下 */}
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

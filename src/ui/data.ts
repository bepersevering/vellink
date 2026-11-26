/** UI 骨架阶段的示例数据。M3/M4 会被真实的文件服务 / 插件注册表替换。 */

export interface TreeItem {
  id: string;
  label: string;
  kind: "folder" | "file";
  indent?: 0 | 1 | 2;
  expanded?: boolean;
  active?: boolean;
}

export const fileTree: TreeItem[] = [
  { id: "f-writing", label: "写作", kind: "folder", expanded: true },
  {
    id: "doc-knowledge",
    label: "如何建立自己的知识体系",
    kind: "file",
    indent: 1,
    active: true,
  },
  { id: "doc-deepwork", label: "深度工作的四个条件", kind: "file", indent: 1 },
  { id: "doc-reading", label: "读书笔记方法论", kind: "file", indent: 1 },
  { id: "f-kb", label: "知识库", kind: "folder", expanded: true },
  { id: "doc-secondbrain", label: "第二大脑 · 总纲", kind: "file", indent: 1 },
  { id: "doc-zettel", label: "卡片盒笔记法", kind: "file", indent: 1 },
  { id: "doc-atomic", label: "原子化笔记", kind: "file", indent: 2 },
  { id: "f-archive", label: "归档", kind: "folder", expanded: false },
];

export interface OutlineItem {
  id: string;
  label: string;
  level: 1 | 2 | 3;
  current?: boolean;
  section?: "doc" | "related";
}

export const outline: OutlineItem[] = [
  {
    id: "o-0",
    label: "如何建立自己的知识体系",
    level: 1,
    current: true,
    section: "doc",
  },
  { id: "o-1", label: "从收集到连接", level: 2, section: "doc" },
  { id: "o-2", label: "一个最小可行流程", level: 2, section: "doc" },
  { id: "o-3", label: "写在最后", level: 3, section: "doc" },
  { id: "o-4", label: "相关笔记", level: 1, section: "related" },
  { id: "o-5", label: "第二大脑 · 总纲", level: 2, section: "related" },
  { id: "o-6", label: "卡片盒笔记法", level: 2, section: "related" },
];

export interface PluginInfo {
  id: string;
  name: string;
  desc: string;
  tag: string;
  icon: "folder" | "ai" | "chart";
  tone: "i1" | "i2" | "i3";
  enabled: boolean;
}

export const plugins: PluginInfo[] = [
  {
    id: "webdav",
    name: "WebDAV 同步",
    desc: "本地优先同步，离线编辑自动合并。上次同步：2 分钟前",
    tag: "官方 · 存储",
    icon: "folder",
    tone: "i1",
    enabled: true,
  },
  {
    id: "ai-kb",
    name: "AI 知识库",
    desc: "基于全文语义检索，回答时引用原文段落。已索引 128 篇",
    tag: "官方 · AI",
    icon: "ai",
    tone: "i2",
    enabled: true,
  },
  {
    id: "graph",
    name: "关系图谱",
    desc: "可视化 [[双向链接]] 与反向引用网络",
    tag: "官方 · 视图",
    icon: "chart",
    tone: "i3",
    enabled: true,
  },
];

export interface CommandItem {
  id: string;
  /** i18n key；显示文案经 t() 解析，运行时翻译。 */
  label: string;
  icon: "edit" | "ai" | "cloud" | "file";
  hint?: string;
  group: string;
  action: string;
}

export const commands: CommandItem[] = [
  {
    id: "c-source",
    label: "cmd.toggleSource",
    icon: "edit",
    hint: "⌘1",
    group: "group.recent",
    action: "source",
  },
  {
    id: "c-undo",
    label: "cmd.undo",
    icon: "edit",
    hint: "⌘Z",
    group: "group.recent",
    action: "undo",
  },
  {
    id: "c-redo",
    label: "cmd.redo",
    icon: "edit",
    hint: "⌘⇧Z",
    group: "group.recent",
    action: "redo",
  },
  {
    id: "c-continue",
    label: "cmd.aiContinue",
    icon: "ai",
    hint: "⌘J",
    group: "group.recent",
    action: "ai-continue",
  },
  {
    id: "c-sync",
    label: "cmd.syncAll",
    icon: "cloud",
    hint: "⌘S",
    group: "group.recent",
    action: "sync",
  },
  {
    id: "c-doc-current",
    label: "cmd.currentDoc",
    icon: "file",
    hint: "cmd.hint.current",
    group: "group.files",
    action: "open-current",
  },
  {
    id: "c-doc-secondbrain",
    label: "cmd.secondBrain",
    icon: "file",
    group: "group.files",
    action: "open-secondbrain",
  },
];

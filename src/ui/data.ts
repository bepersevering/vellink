/** 命令面板数据与插件卡片类型（真实文档列表由 Workspace 提供）。 */

export interface PluginInfo {
  id: string;
  name: string;
  desc: string;
  tag: string;
  icon: "folder" | "ai" | "chart";
  tone: "i1" | "i2" | "i3";
  enabled: boolean;
}

export interface CommandItem {
  id: string;
  /** i18n key；显示文案经 t() 解析，运行时翻译。 */
  label: string;
  icon: "edit" | "ai" | "cloud" | "file" | "folder" | "search";
  hint?: string;
  group: string;
  action: string;
}

export const commands: CommandItem[] = [
  {
    id: "c-find",
    label: "cmd.find",
    icon: "search",
    hint: "⌘F",
    group: "group.recent",
    action: "find",
  },
  {
    id: "c-source",
    label: "cmd.toggleSource",
    icon: "edit",
    hint: "⌘1",
    group: "group.recent",
    action: "source",
  },
  {
    id: "c-new",
    label: "cmd.newDoc",
    icon: "file",
    hint: "⌘N",
    group: "group.recent",
    action: "new-doc",
  },
  {
    id: "c-save",
    label: "cmd.save",
    icon: "cloud",
    hint: "⌘S",
    group: "group.recent",
    action: "save",
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
    id: "c-open-folder",
    label: "cmd.openFolder",
    icon: "folder",
    hint: "⌘O",
    group: "group.recent",
    action: "open-folder",
  },
  {
    id: "c-sync",
    label: "cmd.syncAll",
    icon: "cloud",
    hint: "⌘⇧S",
    group: "group.recent",
    action: "sync",
  },
  {
    id: "c-check-update",
    label: "cmd.checkUpdate",
    icon: "cloud",
    hint: "⌘U",
    group: "group.recent",
    action: "check-update",
  },
];

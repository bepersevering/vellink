/**
 * 命令注册表 — 命令面板、快捷键、插件贡献点的共同底座。
 */

export interface Command {
  id: string;
  title: string;
  /** 快捷键，如 "Mod+Shift+P"（M0 只登记，绑定在 UI 层做） */
  keybinding?: string;
  /** 命令是否在当前上下文可用 */
  enabled?: () => boolean;
  /** 返回 false 表示命令执行了但无可撤销内容等"无操作"情形 */
  run: () => boolean | void | Promise<boolean | void>;
}

export interface CommandRegistry {
  register(command: Command): () => void;
  get(id: string): Command | undefined;
  run(id: string): Promise<boolean>;
  list(): Command[];
  search(query: string): Command[];
  clear(): void;
}

export function createRegistry(): CommandRegistry {
  const commands = new Map<string, Command>();

  return {
    register(command) {
      if (commands.has(command.id))
        throw new Error(`Command already registered: ${command.id}`);
      commands.set(command.id, command);
      return () => commands.delete(command.id);
    },
    get(id) {
      return commands.get(id);
    },
    async run(id) {
      const cmd = commands.get(id);
      if (!cmd || (cmd.enabled && !cmd.enabled())) return false;
      const result = await cmd.run();
      return result === undefined ? true : result;
    },
    list() {
      return [...commands.values()];
    },
    search(query) {
      const q = query.toLowerCase().trim();
      if (!q) return this.list();
      return this.list().filter(
        (c) =>
          c.title.toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
      );
    },
    clear() {
      commands.clear();
    },
  };
}

/** 全局注册表（M0 单实例）。 */
export const commands = createRegistry();

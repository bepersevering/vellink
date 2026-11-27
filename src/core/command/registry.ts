/**
 * Command registry — the shared foundation for the command palette, keybindings, and plugin contributions.
 */

export interface Command {
  id: string;
  title: string;
  /** Keybinding, e.g. "Mod+Shift+P" (registered here in M0; bound in the UI layer) */
  keybinding?: string;
  /** Whether the command is available in the current context */
  enabled?: () => boolean;
  /** Returning false means the command ran but was a no-op (e.g. nothing to undo) */
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

/** Global registry (a single instance in M0). */
export const commands = createRegistry();

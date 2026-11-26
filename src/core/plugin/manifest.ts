/**
 * 插件 manifest — 插件与内核之间唯一的声明式契约。
 *
 * 设计原则：
 * 1. 校验发生在安装时，坏 manifest 绝不让宿主崩溃（返回带字段路径的错误）。
 * 2. 命令/视图 id 强制以插件 id 命名空间开头，杜绝插件之间撞名。
 * 3. 权限是显式白名单，运行时真的会门控 API，不做纸面声明。
 */

export const PLUGIN_PERMISSIONS = [
  "storage",
  "documents:read",
  "documents:write",
  "network",
  "ai",
  "shell",
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

export type ActivationEvent =
  | "onStartup"
  | `onCommand:${string}`
  | `onView:${string}`
  | `onLanguage:${string}`;

export interface ManifestCommand {
  command: string;
  title: string;
  keybinding?: string;
}

export interface ManifestView {
  id: string;
  title: string;
  location: "leftDrawer" | "rightDrawer" | "editor";
  icon?: string;
}

export interface ManifestContributes {
  commands?: ManifestCommand[];
  menus?: Array<{ location: "commandPalette" | "editorContext"; commands: string[] }>;
  views?: ManifestView[];
  blockRenderers?: Array<{ type: string; label?: string }>;
  syntax?: Array<{ id: string; extensions?: string[] }>;
  providers?: Array<{ kind: "storage" | "vfs" | "ai" | "vector"; id: string }>;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  license?: string;
  /** ESM 入口，相对插件目录；禁止绝对路径、路径穿越与远程 URL。 */
  entry: string;
  /** 兼容的应用版本范围，如 "^0.1.0"。 */
  engines?: { vellink?: string };
  activationEvents?: ActivationEvent[];
  permissions?: PluginPermission[];
  contributes?: ManifestContributes;
}

export class PluginManifestError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(`${field}: ${message}`);
    this.name = "PluginManifestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  required = true,
): string | undefined {
  const value = obj[key];
  if (value === undefined) {
    if (required) throw new PluginManifestError(path, "缺少必填字段");
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0)
    throw new PluginManifestError(path, "必须是非空字符串");
  return value.trim();
}

function readOptionalStringArray(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): string[] | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string"))
    throw new PluginManifestError(path, "必须是字符串数组");
  return value as string[];
}

/** 轻量 semver 解析：x.y.z[-prerelease]，够覆盖 engines 声明。 */
function parseVersion(input: string): [number, number, number, string | undefined] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(input);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4]];
}

type Version = NonNullable<ReturnType<typeof parseVersion>>;

function compare(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    const av = a[i] as number;
    const bv = b[i] as number;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  if (!a[3] && !b[3]) return 0;
  if (!a[3]) return 1; // 正式版 > 预发布版
  if (!b[3]) return -1;
  return a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0;
}

function matchesComparator(version: Version, part: string): boolean {
  if (part === "*" || part === "x") return true;
  const operators = [">=", "<=", ">", "<", "^", "~"] as const;
  const op = operators.find((candidate) => part.startsWith(candidate));
  const raw = op ? part.slice(op.length) : part;
  const base = parseVersion(raw);
  if (!base) throw new PluginManifestError("engines.vellink", `无法识别的版本范围: ${part}`);

  switch (op) {
    case ">=":
      return compare(version, base) >= 0;
    case "<=":
      return compare(version, base) <= 0;
    case ">":
      return compare(version, base) > 0;
    case "<":
      return compare(version, base) < 0;
    case "^": {
      // 0.x 锁定 minor，>=1 锁定 major
      const upper: Version =
        base[0] === 0
          ? base[1] === 0
            ? [0, 0, base[2] + 1, undefined]
            : [0, base[1] + 1, 0, undefined]
          : [base[0] + 1, 0, 0, undefined];
      return compare(version, base) >= 0 && compare(version, upper) < 0;
    }
    case "~": {
      const upper: Version = [base[0], base[1] + 1, 0, undefined];
      return compare(version, base) >= 0 && compare(version, upper) < 0;
    }
    default:
      return compare(version, base) === 0;
  }
}

/** 判断应用版本是否满足 engines.vellink；多个比较器用空格分隔表示 AND。 */
export function satisfiesVersion(version: string, range: string): boolean {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  const parts = range.trim().split(/\s+/).filter(Boolean);
  return parts.length > 0 && parts.every((part) => matchesComparator(parsed, part));
}

function validateActivationEvents(manifest: Record<string, unknown>): ActivationEvent[] {
  const raw = manifest.activationEvents;
  if (raw === undefined) return [];
  const values = readOptionalStringArray(manifest, "activationEvents", "activationEvents") ?? [];
  return values.map((value, index) => {
    const path = `activationEvents[${index}]`;
    if (
      value === "onStartup" ||
      /^onCommand:[a-z][a-z0-9.-]*$/.test(value) ||
      /^onView:[a-z][a-z0-9.-]*$/.test(value) ||
      /^onLanguage:[a-z][a-z0-9-]*$/.test(value)
    ) {
      return value as ActivationEvent;
    }
    throw new PluginManifestError(path, `无法识别的激活事件: ${value}`);
  });
}

/** 校验未知输入，返回规范化 manifest；任何问题都以 PluginManifestError 抛出。 */
export function validateManifest(input: unknown): PluginManifest {
  if (!isRecord(input)) throw new PluginManifestError("manifest", "必须是对象");

  const id = readString(input, "id", "id")!;
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(id))
    throw new PluginManifestError("id", "只能使用小写字母、数字与连字符，长度 2-64");

  const name = readString(input, "name", "name")!;
  const version = readString(input, "version", "version")!;
  if (!parseVersion(version)) throw new PluginManifestError("version", "必须是 x.y.z 语义化版本");

  const entry = readString(input, "entry", "entry")!;
  if (entry.startsWith("/") || entry.includes("..") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(entry))
    throw new PluginManifestError("entry", "必须是插件目录内的相对路径，禁止 .. 与远程 URL");

  const description = readString(input, "description", "description", false);
  const author = readString(input, "author", "author", false);
  const license = readString(input, "license", "license", false);

  let engines: PluginManifest["engines"];
  if (input.engines !== undefined) {
    if (!isRecord(input.engines))
      throw new PluginManifestError("engines", "必须是对象");
    const range = readString(input.engines, "vellink", "engines.vellink", false);
    if (range !== undefined) {
      // 立即解析一次，坏范围在安装期就报错
      satisfiesVersion("0.0.0", range);
      engines = { vellink: range };
    }
  }

  const activationEvents = validateActivationEvents(input);

  let permissions: PluginPermission[] | undefined;
  if (input.permissions !== undefined) {
    const values = readOptionalStringArray(input, "permissions", "permissions") ?? [];
    permissions = values.map((value, index) => {
      if (!(PLUGIN_PERMISSIONS as readonly string[]).includes(value))
        throw new PluginManifestError(`permissions[${index}]`, `未知权限: ${value}`);
      return value as PluginPermission;
    });
  }

  const contributes = validateContributes(input.contributes, id);

  return {
    id,
    name,
    version,
    entry,
    ...(description ? { description } : {}),
    ...(author ? { author } : {}),
    ...(license ? { license } : {}),
    ...(engines ? { engines } : {}),
    ...(activationEvents.length ? { activationEvents } : {}),
    ...(permissions ? { permissions } : {}),
    ...(contributes ? { contributes } : {}),
  };
}

function validateContributes(raw: unknown, pluginId: string): ManifestContributes | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw new PluginManifestError("contributes", "必须是对象");

  const ns = (value: string | undefined, path: string): string => {
    const v = readString({ value }, "value", path)!;
    if (!v.startsWith(`${pluginId}.`) || v.length <= pluginId.length + 1)
      throw new PluginManifestError(path, `必须以 ${pluginId}. 开头（插件命名空间）`);
    return v;
  };

  const result: ManifestContributes = {};

  if (raw.commands !== undefined) {
    if (!Array.isArray(raw.commands)) throw new PluginManifestError("contributes.commands", "必须是数组");
    result.commands = raw.commands.map((entry, index) => {
      const path = `contributes.commands[${index}]`;
      if (!isRecord(entry)) throw new PluginManifestError(path, "必须是对象");
      const command = ns(entry.command as string | undefined, `${path}.command`);
      const title = readString(entry, "title", `${path}.title`)!;
      const keybinding = readString(entry, "keybinding", `${path}.keybinding`, false);
      return { command, title, ...(keybinding ? { keybinding } : {}) };
    });
  }

  if (raw.menus !== undefined) {
    if (!Array.isArray(raw.menus)) throw new PluginManifestError("contributes.menus", "必须是数组");
    result.menus = raw.menus.map((entry, index) => {
      const path = `contributes.menus[${index}]`;
      if (!isRecord(entry)) throw new PluginManifestError(path, "必须是对象");
      const location = entry.location;
      if (location !== "commandPalette" && location !== "editorContext")
        throw new PluginManifestError(`${path}.location`, "必须是 commandPalette 或 editorContext");
      const commands = readOptionalStringArray(entry, "commands", `${path}.commands`) ?? [];
      commands.forEach((command, i) => ns(command, `${path}.commands[${i}]`));
      return { location, commands };
    });
  }

  if (raw.views !== undefined) {
    if (!Array.isArray(raw.views)) throw new PluginManifestError("contributes.views", "必须是数组");
    result.views = raw.views.map((entry, index) => {
      const path = `contributes.views[${index}]`;
      if (!isRecord(entry)) throw new PluginManifestError(path, "必须是对象");
      const id = ns(entry.id as string | undefined, `${path}.id`);
      const title = readString(entry, "title", `${path}.title`)!;
      const location = entry.location;
      if (location !== "leftDrawer" && location !== "rightDrawer" && location !== "editor")
        throw new PluginManifestError(`${path}.location`, "必须是 leftDrawer / rightDrawer / editor");
      const icon = readString(entry, "icon", `${path}.icon`, false);
      return { id, title, location, ...(icon ? { icon } : {}) };
    });
  }

  if (raw.blockRenderers !== undefined) {
    if (!Array.isArray(raw.blockRenderers))
      throw new PluginManifestError("contributes.blockRenderers", "必须是数组");
    result.blockRenderers = raw.blockRenderers.map((entry, index) => {
      const path = `contributes.blockRenderers[${index}]`;
      if (!isRecord(entry)) throw new PluginManifestError(path, "必须是对象");
      const type = readString(entry, "type", `${path}.type`)!;
      const label = readString(entry, "label", `${path}.label`, false);
      return { type, ...(label ? { label } : {}) };
    });
  }

  if (raw.syntax !== undefined) {
    if (!Array.isArray(raw.syntax)) throw new PluginManifestError("contributes.syntax", "必须是数组");
    result.syntax = raw.syntax.map((entry, index) => {
      const path = `contributes.syntax[${index}]`;
      if (!isRecord(entry)) throw new PluginManifestError(path, "必须是对象");
      const id = ns(entry.id as string | undefined, `${path}.id`);
      const extensions = readOptionalStringArray(entry, "extensions", `${path}.extensions`);
      return { id, ...(extensions ? { extensions } : {}) };
    });
  }

  if (raw.providers !== undefined) {
    if (!Array.isArray(raw.providers)) throw new PluginManifestError("contributes.providers", "必须是数组");
    result.providers = raw.providers.map((entry, index) => {
      const path = `contributes.providers[${index}]`;
      if (!isRecord(entry)) throw new PluginManifestError(path, "必须是对象");
      const kind = entry.kind;
      if (kind !== "storage" && kind !== "vfs" && kind !== "ai" && kind !== "vector")
        throw new PluginManifestError(`${path}.kind`, "未知 Provider 类型");
      const id = ns(entry.id as string | undefined, `${path}.id`);
      return { kind, id };
    });
  }

  return Object.keys(result).length ? result : undefined;
}

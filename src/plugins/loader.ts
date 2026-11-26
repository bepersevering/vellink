/**
 * 浏览器/Tauri 侧的插件发现与 ESM 动态加载。
 *
 * import.meta.glob 由 Vite 静态分析：开发时热更新、打包时按需分块。
 * 未来接社区插件目录时，只需把 glob 换成 VFS 枚举 + 动态 import URL，
 * 运行时（core/plugin/runtime.ts）不用改。
 */

import { validateManifest } from "../core/plugin/manifest";
import { PluginRuntime, type PluginModule, type PluginRuntimeOptions } from "../core/plugin/runtime";

type ManifestModule = { default?: unknown };
type EntryModule = { default?: PluginModule } & PluginModule;

const manifestModules = import.meta.glob<ManifestModule>("./*/manifest.json", { eager: true });
const entryModules = import.meta.glob<EntryModule>("./*/index.ts");

const enabledKey = (id: string) => `vellink:plugin:${id}:enabled`;

function readEnabled(id: string): boolean {
  try {
    return window.localStorage.getItem(enabledKey(id)) !== "0";
  } catch {
    return true;
  }
}

export function persistPluginEnabled(id: string, enabled: boolean): void {
  try {
    window.localStorage.setItem(enabledKey(id), enabled ? "1" : "0");
  } catch {
    // 无存储权限时仅影响本次会话
  }
}

export interface PluginLoadResult {
  runtime: PluginRuntime;
  /** manifest 校验失败 / 入口缺失 / 版本不兼容的插件，逐个记录不阻断启动。 */
  errors: Array<{ path: string; message: string }>;
}

export async function createPluginRuntime(
  options: PluginRuntimeOptions = {},
): Promise<PluginLoadResult> {
  const runtime = new PluginRuntime(options);
  const errors: PluginLoadResult["errors"] = [];

  for (const [manifestPath, manifestModule] of Object.entries(manifestModules)) {
    try {
      const manifest = validateManifest(manifestModule.default);
      const entryPath = manifestPath.replace(/manifest\.json$/, "index.ts");
      const loadEntry = entryModules[entryPath];
      if (!loadEntry) throw new Error(`插件入口缺失: ${entryPath}`);
      const module = await loadEntry();
      const plugin = module.default ?? module;
      runtime.install(manifest, plugin, readEnabled(manifest.id));
    } catch (error) {
      errors.push({
        path: manifestPath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await runtime.activateStartup();
  return { runtime, errors };
}

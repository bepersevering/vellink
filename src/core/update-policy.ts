/**
 * 更新策略：与平台无关的纯函数。
 *
 * 抽出来的原因很实际——「该不该在启动时检查」「进度条百分比怎么算」「版本谁更新」
 * 全是纯逻辑，可以脱离 Tauri 运行时单测；只有真正的下载安装才碰原生插件。
 */

/** 自动检查间隔：6 小时。太勤会烦人，太久又错过小版本。 */
export const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;

/**
 * 现在该不该后台检查更新。
 *
 * 时钟回拨（用户改过系统时间）时 lastCheck 会落到未来，此时按「该查」处理，
 * 否则一次误操作会把用户永久卡在不再检查的状态。
 */
export function shouldCheckForUpdate(
  lastCheckAt: number | null,
  now: number,
  interval = UPDATE_CHECK_INTERVAL,
): boolean {
  if (lastCheckAt === null || !Number.isFinite(lastCheckAt)) return true;
  if (lastCheckAt > now) return true;
  return now - lastCheckAt >= interval;
}

interface ParsedVersion {
  core: [number, number, number];
  pre: string[];
}

/** 解析 `1.2.3` / `v1.2.3` / `1.2.3-beta.2`。非法段一律按 0 处理，不抛错。 */
function parseVersion(version: string): ParsedVersion {
  const trimmed = version.trim().replace(/^v/i, "");
  const dash = trimmed.indexOf("-");
  const coreText = dash >= 0 ? trimmed.slice(0, dash) : trimmed;
  const preText = dash >= 0 ? trimmed.slice(dash + 1) : "";
  const parts = coreText.split(".");
  const core: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    const value = Number.parseInt(parts[i] ?? "", 10);
    core[i] = Number.isFinite(value) && value > 0 ? value : 0;
  }
  return { core, pre: preText ? preText.split(".") : [] };
}

function comparePrerelease(a: string[], b: string[]): number {
  // 正式版 > 预发布版：1.0.0 > 1.0.0-beta
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNum = /^\d+$/.test(left) ? Number.parseInt(left, 10) : null;
    const rightNum = /^\d+$/.test(right) ? Number.parseInt(right, 10) : null;
    if (leftNum !== null && rightNum !== null) {
      if (leftNum !== rightNum) return leftNum < rightNum ? -1 : 1;
    } else if (leftNum !== null) {
      // 数字标识符优先级低于字母标识符（semver 规则）
      return -1;
    } else if (rightNum !== null) {
      return 1;
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

/** 比较两个版本号：a 比 b 新返回 1，旧返回 -1，相同返回 0。 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) {
      return left.core[i] < right.core[i] ? -1 : 1;
    }
  }
  return comparePrerelease(left.pre, right.pre);
}

/**
 * 下载进度百分比。服务端没给总长度时返回 null（UI 显示不确定进度条）。
 */
export function progressPercent(downloaded: number, total: number | null): number | null {
  if (total === null || !Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(downloaded) || downloaded <= 0) return 0;
  return Math.min(100, Math.round((downloaded / total) * 100));
}

/** 人类可读体积，用于「已下载 12.4 MB」。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

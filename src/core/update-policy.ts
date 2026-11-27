/**
 * Update policy: platform-independent pure functions.
 *
 * The reason for extracting these is practical — "should we check on startup",
 * "how is the progress percentage computed", and "which version is newer" are all
 * pure logic that can be unit-tested without the Tauri runtime; only the actual
 * download and install touch the native plugin.
 */

/** Automatic check interval: 6 hours. Too often is annoying, too long misses minor releases. */
export const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;

/**
 * Whether a background update check should run now.
 *
 * If the clock was rolled back (the user changed the system time), lastCheck falls in
 * the future; treat that as "should check", otherwise a single mistake would leave the
 * user stuck never checking again.
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

/** Parse `1.2.3` / `v1.2.3` / `1.2.3-beta.2`. Invalid segments are treated as 0, never throws. */
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
  // A stable release > a prerelease: 1.0.0 > 1.0.0-beta
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
      // Numeric identifiers have lower precedence than alphanumeric ones (semver rule)
      return -1;
    } else if (rightNum !== null) {
      return 1;
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

/** Compare two versions: 1 if a is newer than b, -1 if older, 0 if equal. */
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
 * Download progress percentage. Returns null when the server provides no total length
 * (the UI then shows an indeterminate progress bar).
 */
export function progressPercent(downloaded: number, total: number | null): number | null {
  if (total === null || !Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(downloaded) || downloaded <= 0) return 0;
  return Math.min(100, Math.round((downloaded / total) * 100));
}

/** Human-readable byte size, e.g. "Downloaded 12.4 MB". */
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

import { describe, expect, it } from "vitest";
import {
  UPDATE_CHECK_INTERVAL,
  compareVersions,
  formatBytes,
  progressPercent,
  shouldCheckForUpdate,
} from "./update-policy";

describe("shouldCheckForUpdate", () => {
  const now = 1_700_000_000_000;

  it("checks on first run (no saved timestamp)", () => {
    expect(shouldCheckForUpdate(null, now)).toBe(true);
  });

  it("skips right after a check, then rechecks after the interval", () => {
    expect(shouldCheckForUpdate(now - 1000, now)).toBe(false);
    expect(shouldCheckForUpdate(now - UPDATE_CHECK_INTERVAL + 1, now)).toBe(false);
    expect(shouldCheckForUpdate(now - UPDATE_CHECK_INTERVAL, now)).toBe(true);
  });

  it("still checks when the clock is set far ahead, without getting stuck", () => {
    expect(shouldCheckForUpdate(now + 86_400_000, now)).toBe(true);
  });

  it("accepts an interval override", () => {
    expect(shouldCheckForUpdate(now - 5000, now, 1000)).toBe(true);
  });
});

describe("compareVersions", () => {
  it("compares major, minor, and patch numbers", () => {
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
    expect(compareVersions("1.3.0", "1.2.9")).toBe(1);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
  });

  it("ignores a leading v", () => {
    expect(compareVersions("v0.2.0", "0.1.0")).toBe(1);
  });

  it("ranks a stable release above its prereleases", () => {
    expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBe(1);
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
  });

  it("compares prerelease identifiers by numbers and letters separately", () => {
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBe(-1);
    expect(compareVersions("1.0.0-beta", "1.0.0-alpha")).toBe(1);
    expect(compareVersions("1.0.0-beta.1", "1.0.0-beta")).toBe(1);
  });

  it("doesn't throw on invalid version strings", () => {
    expect(compareVersions("", "0.0.0")).toBe(0);
    expect(compareVersions("abc", "1.0.0")).toBe(-1);
  });
});

describe("progressPercent", () => {
  it("converts normally and rounds the result", () => {
    expect(progressPercent(512, 1024)).toBe(50);
    expect(progressPercent(1, 3)).toBe(33);
  });

  it("returns null when there's no total length", () => {
    expect(progressPercent(100, null)).toBeNull();
    expect(progressPercent(100, 0)).toBeNull();
  });

  it("clamps to the valid range", () => {
    expect(progressPercent(2048, 1024)).toBe(100);
    expect(progressPercent(-5, 1024)).toBe(0);
  });
});

describe("formatBytes", () => {
  it("converts between units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024 * 12.34)).toBe("12.3 MB");
    expect(formatBytes(1024 * 1024 * 200)).toBe("200 MB");
  });

  it("returns 0 B for invalid input", () => {
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});

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

  it("首次运行（没有记录）应当检查", () => {
    expect(shouldCheckForUpdate(null, now)).toBe(true);
  });

  it("刚查过就不查，超过间隔再查", () => {
    expect(shouldCheckForUpdate(now - 1000, now)).toBe(false);
    expect(shouldCheckForUpdate(now - UPDATE_CHECK_INTERVAL + 1, now)).toBe(false);
    expect(shouldCheckForUpdate(now - UPDATE_CHECK_INTERVAL, now)).toBe(true);
  });

  it("时钟回拨到未来也照样检查，不会永久卡死", () => {
    expect(shouldCheckForUpdate(now + 86_400_000, now)).toBe(true);
  });

  it("可以覆盖间隔", () => {
    expect(shouldCheckForUpdate(now - 5000, now, 1000)).toBe(true);
  });
});

describe("compareVersions", () => {
  it("按主次修订号比较", () => {
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
    expect(compareVersions("1.3.0", "1.2.9")).toBe(1);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
  });

  it("忽略 v 前缀", () => {
    expect(compareVersions("v0.2.0", "0.1.0")).toBe(1);
  });

  it("正式版高于同号预发布版", () => {
    expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBe(1);
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
  });

  it("预发布标识符按数字与字母分别比较", () => {
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBe(-1);
    expect(compareVersions("1.0.0-beta", "1.0.0-alpha")).toBe(1);
    expect(compareVersions("1.0.0-beta.1", "1.0.0-beta")).toBe(1);
  });

  it("非法版本号不抛错", () => {
    expect(compareVersions("", "0.0.0")).toBe(0);
    expect(compareVersions("abc", "1.0.0")).toBe(-1);
  });
});

describe("progressPercent", () => {
  it("正常换算并四舍五入", () => {
    expect(progressPercent(512, 1024)).toBe(50);
    expect(progressPercent(1, 3)).toBe(33);
  });

  it("没有总长度时返回 null", () => {
    expect(progressPercent(100, null)).toBeNull();
    expect(progressPercent(100, 0)).toBeNull();
  });

  it("不越界", () => {
    expect(progressPercent(2048, 1024)).toBe(100);
    expect(progressPercent(-5, 1024)).toBe(0);
  });
});

describe("formatBytes", () => {
  it("按单位换算", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024 * 12.34)).toBe("12.3 MB");
    expect(formatBytes(1024 * 1024 * 200)).toBe("200 MB");
  });

  it("非法输入返回 0 B", () => {
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});

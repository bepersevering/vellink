/**
 * 图片缩放尺寸计算（纯函数）。
 *
 * 截图工具动辄输出 4K PNG，写进工作区既占空间又拖慢导出。
 * 只按最长边等比缩放，不放大小图；0 表示关闭压缩。
 */

export interface Size {
  width: number;
  height: number;
}

/** 返回缩放后的尺寸；不需要缩放时返回原尺寸。 */
export function fitWithin(size: Size, maxEdge: number): Size {
  const max = Math.max(size.width, size.height);
  if (!maxEdge || max <= maxEdge || max <= 0) return size;
  const scale = maxEdge / max;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/** 是否真的需要缩放。 */
export function needsResize(size: Size, maxEdge: number): boolean {
  const next = fitWithin(size, maxEdge);
  return next.width !== size.width || next.height !== size.height;
}

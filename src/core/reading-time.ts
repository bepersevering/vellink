/**
 * 阅读时长估算（纯函数）。
 *
 * 中文按 400 字/分钟，英文按 200 词/分钟；混排时取两者之和。
 * 少于 1 分钟按 1 分钟显示——「0 分钟」对一篇刚写的稿子没有意义。
 */

export function readingMinutes(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const words = (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length;
  const minutes = cjk / 400 + words / 200;
  return Math.max(1, Math.ceil(minutes));
}

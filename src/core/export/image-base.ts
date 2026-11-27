/**
 * 导出 HTML 时把相对图片路径解析到用户配置的根目录（纯函数）。
 *
 * 静态博客常把图片放在 /images/ 下，而笔记里写的是 ./shot.png；
 * 配置 base 后导出 HTML 里的 src 变成 /images/shot.png。
 * 只拼相对路径，http(s)/data/# 原样保留。
 */

export function resolveImageBase(src: string, base: string): string {
  const raw = src.trim();
  if (!base.trim()) return raw;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(raw)) return raw;
  const prefix = base.trim().replace(/\/+$/, "");
  return `${prefix}/${raw.replace(/^\.\//, "")}`;
}

/**
 * Resolve relative image paths against a user-configured base when exporting HTML (pure function).
 *
 * Static blogs often keep images under /images/ while a note writes ./shot.png;
 * once base is configured, the exported HTML src becomes /images/shot.png.
 * Only relative paths are joined; http(s)/data/# paths are left as-is.
 */

export function resolveImageBase(src: string, base: string): string {
  const raw = src.trim();
  if (!base.trim()) return raw;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(raw)) return raw;
  const prefix = base.trim().replace(/\/+$/, "");
  return `${prefix}/${raw.replace(/^\.\//, "")}`;
}

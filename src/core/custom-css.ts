/**
 * 自定义 CSS 主题：把用户样式注入页面 / 从页面移除。
 *
 * 只做最小沙箱：去掉 @import（防止偷偷拉外链）与 `url(http...)`（防止
 * 追踪请求），但允许 data URI 图片。不试图做完整 CSS 安全解析——样式表
 * 本身不能执行脚本，真正危险的是外链。
 */

const STYLE_ID = "vellink-user-css";

/** 去掉会发起网络请求的规则，保留 data URI 与相对路径。 */
export function sanitizeCss(css: string): string {
  return css
    .replace(/@import\s+[^;]+;/gi, "")
    .replace(/url\(\s*['"]?(?:https?:)?\/\/[^\s'")]+['"]?\s*\)/gi, "url(#)")
    .trim();
}

/** 注入或替换用户样式；空串移除。返回是否实际改动。 */
export function applyCustomCss(doc: Document, css: string): boolean {
  const clean = sanitizeCss(css);
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!clean) {
    if (style) {
      style.remove();
      return true;
    }
    return false;
  }
  if (!style) {
    style = doc.createElement("style");
    style.id = STYLE_ID;
    style.setAttribute("data-vellink-user-css", "1");
    doc.head.appendChild(style);
  }
  if (style.textContent === clean) return false;
  style.textContent = clean;
  return true;
}

/** 读当前注入的用户 CSS（设置面板回显用）。 */
export function currentCustomCss(doc: Document): string {
  return (doc.getElementById(STYLE_ID) as HTMLStyleElement | null)?.textContent ?? "";
}

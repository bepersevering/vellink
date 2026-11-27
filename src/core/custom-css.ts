/**
 * Custom CSS theme: inject user styles into the page / remove them from the page.
 *
 * Only a minimal sandbox: strip @import (to prevent silently pulling external
 * resources) and `url(http...)` (to prevent tracking requests), but allow data URI
 * images. No attempt at full CSS security parsing — stylesheets can't execute
 * scripts; the real danger is external links.
 */

const STYLE_ID = "vellink-user-css";

/** Strip rules that would fire network requests, keeping data URIs and relative paths. */
export function sanitizeCss(css: string): string {
  return css
    .replace(/@import\s+[^;]+;/gi, "")
    .replace(/url\(\s*['"]?(?:https?:)?\/\/[^\s'")]+['"]?\s*\)/gi, "url(#)")
    .trim();
}

/** Inject or replace user styles; an empty string removes them. Returns whether anything actually changed. */
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

/** Read the currently injected user CSS (for the settings panel to display). */
export function currentCustomCss(doc: Document): string {
  return (doc.getElementById(STYLE_ID) as HTMLStyleElement | null)?.textContent ?? "";
}

/**
 * Math rendering in the WYSIWYG view.
 *
 * The schema's toDOM only emits placeholders `<span data-math>` / `<div data-math-block>`;
 * here we replace those placeholders with KaTeX output after PM updates the DOM. Reasons:
 * 1. The schema stays pure data, so node unit tests need no DOM;
 * 2. KaTeX's HTML output contains many inline nodes, which don't belong in a PM document
 *    (they would be serialized);
 * 3. The source view still shows the original `$...$`, so cursor mapping is unaffected.
 *
 * We use htmlAndMathml: the HTML layer handles visual layout, the MathML layer handles
 * accessibility and copy/paste.
 */

import katex from "katex";

const RENDERED = "data-math-rendered";

/** Render all unprocessed math placeholders in a container. Idempotent: already-rendered ones are skipped. */
export function renderMath(host: HTMLElement): void {
  const inline = host.querySelectorAll<HTMLElement>("span[data-math]:not([" + RENDERED + "])");
  for (const el of Array.from(inline)) {
    const value = el.getAttribute("data-math") ?? "";
    el.setAttribute(RENDERED, "1");
    try {
      katex.render(value, el, {
        throwOnError: false,
        output: "htmlAndMathml",
        strict: "ignore",
      });
    } catch {
      el.textContent = `$${value}$`;
      el.classList.add("math-error");
    }
  }

  const blocks = host.querySelectorAll<HTMLElement>(
    "div[data-math-block]:not([" + RENDERED + "])",
  );
  for (const el of Array.from(blocks)) {
    const value = el.getAttribute("data-math-block") ?? "";
    el.setAttribute(RENDERED, "1");
    try {
      katex.render(value, el, {
        throwOnError: false,
        displayMode: true,
        output: "htmlAndMathml",
        strict: "ignore",
      });
    } catch {
      el.textContent = `$$${value}$$`;
      el.classList.add("math-error");
    }
  }
}

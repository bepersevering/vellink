/**
 * WYSIWYG 里的公式渲染。
 *
 * schema 的 toDOM 只输出占位 `<span data-math>` / `<div data-math-block>`，
 * 这里在 PM 更新 DOM 之后把占位节点替换成 KaTeX 输出。这样做的原因：
 * 1. schema 保持纯数据，node 单测不需要 DOM；
 * 2. KaTeX 的 HTML 输出带大量内联节点，不适合塞进 PM 文档（会被序列化）；
 * 3. 源码视图看到的仍是原始 `$...$`，光标映射完全不受影响。
 *
 * 用 htmlAndMathml：HTML 层给视觉排版，MathML 层给可访问性与复制粘贴。
 */

import katex from "katex";

const RENDERED = "data-math-rendered";

/** 在容器里渲染所有未处理的公式占位节点。幂等：渲染过的会被跳过。 */
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

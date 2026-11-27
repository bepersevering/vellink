/**
 * WYSIWYG 里的扩展语法渲染：把 `[TOC]` 占位 atom 展开为目录。
 *
 * TOC 是 atom（PM 不管内部文本），改它的 innerHTML 不会被 DOMObserver
 * 当成文档变化；和公式占位一样在 PM 更新后调用即可，幂等。
 * 点击目录项跳转到对应标题：heading 的 id 由 ext-syntax.headingAnchor 生成，
 * 这里给标题 DOM 补 id，再靠原生锚点/滚动定位。
 */

import { headingAnchor, tocEntries } from "../ext-syntax";

const DONE = "data-toc-rendered";

/** 把标题文字变成锚点 id（供 h1–h6 与目录链接共用）。 */
export { headingAnchor };

/** 在容器里展开目录并给标题补 id。幂等：已渲染的占位会被跳过。 */
export function renderExtSyntax(host: HTMLElement, markdownSource: string): void {
  const headings = tocEntries(markdownSource);

  const tocNodes = host.querySelectorAll<HTMLElement>(`div[data-toc]:not([${DONE}])`);
  for (const el of Array.from(tocNodes)) {
    el.setAttribute(DONE, "1");
    if (!headings.length) {
      el.textContent = "（文档还没有标题）";
      continue;
    }
    const list = document.createElement("ul");
    for (const h of headings) {
      const id = h.anchor;
      const li = document.createElement("li");
      li.className = `toc-l${h.depth}`;
      const a = document.createElement("a");
      a.href = `#${id}`;
      a.textContent = h.text;
      a.addEventListener("click", (event) => {
        event.preventDefault();
        host.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
      li.append(a);
      list.append(li);
    }
    el.replaceChildren(list);
  }
}

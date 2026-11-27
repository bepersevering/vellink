/**
 * DocumentIR → HTML。
 *
 * 为什么不拿现成的 markdown→HTML 转换器：
 * 1. IR 是唯一真源，导出必须与编辑器里看到的完全一致，不能另起一条解析链；
 * 2. 导出的文件要能直接发给别人——单文件、样式内联、零外部依赖。
 *
 * 样式刻意照抄 `.doc-body` 的字号/行距/间距（衬线正文、1.9 行高、20px 段距），
 * 这样「导出后打开」与「编辑器里」是同一份排版，不是另一个版本的文档。
 */

import type { BlockNode, DocumentIR, InlineNode } from "../ir/types";
import katex from "katex";
import { highlightHtml } from "../view/code-highlight";
import { headingAnchor } from "../ext-syntax";
import { sanitizeCss } from "../custom-css";
import { resolveImageBase } from "./image-base";

/** 公式渲染：MathML 输出是纯标记、零字体依赖，导出的单文件才能真正自包含。 */
function mathHtml(value: string, displayMode: boolean): string {
  try {
    return katex.renderToString(value, {
      throwOnError: false,
      output: "mathml",
      displayMode,
      strict: "ignore",
    });
  } catch {
    // 极端非法输入降级为可读源码，绝不因为公式把整篇导出搞崩
    return `<code>${escapeHtml(value)}</code>`;
  }
}

const FONT_DOC =
  'Georgia, "Songti SC", "Noto Serif SC", "Source Han Serif SC", serif';
const FONT_UI =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
const FONT_MONO = '"SF Mono", ui-monospace, Menlo, Consolas, monospace';

/** HTML 文本转义。属性值同样走这里（双引号已被转义，可直接放进 " " 里）。 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ------------------------------ URL ------------------------------ */

/**
 * 导出文件是发出去给别人双击打开的，链接点一下就执行脚本这件事必须堵住。
 *
 * 转义挡不住 `javascript:alert(1)`——里面既没有引号也没有尖括号，能原样进
 * 进 href。所以按协议白名单来：只放行 http(s)/mailto/tel/file，以及相对
 * 路径与锚点（没有协议头的都是站内相对引用，安全）。其余一律降到 `#`。
 */
export function safeUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return "#";
  // 没有 "scheme:" 前缀 → 相对路径、锚点、`www.x.com` 之类，原样保留
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return /^(?:https?|mailto|tel|file):/i.test(url) ? url : "#";
}

/** 图片额外容忍内联的 data:image/*（贴进来的截图常常就是这种）。 */
function safeImageUrl(raw: string): string {
  return /^data:image\//i.test(raw.trim()) ? raw.trim() : safeUrl(raw);
}

/* ------------------------------ 行内 ------------------------------ */

function renderInline(nodes: readonly InlineNode[], imageBase = ""): string {
  let out = "";
  for (const node of nodes) out += renderInlineNode(node, imageBase);
  return out;
}

function renderInlineNode(node: InlineNode, imageBase = ""): string {
  switch (node.type) {
    case "text": {
      // 段内换行在编辑器里就是空格（HTML 也会折叠）；整段只有换行的文本节点
      // 是 markdown 的硬换行（"  \n"），必须还原成 <br>，否则两行会粘成一行
      if (node.value.trim() === "" && node.value.includes("\n")) return "<br>";
      return escapeHtml(node.value);
    }
    case "emphasis":
      return `<em>${renderInline(node.children, imageBase)}</em>`;
    case "strong":
      return `<strong>${renderInline(node.children, imageBase)}</strong>`;
    case "inlineCode":
      return `<code>${escapeHtml(node.value)}</code>`;
    case "link": {
      const title = node.title ? ` title="${escapeHtml(node.title)}"` : "";
      return `<a href="${escapeHtml(safeUrl(node.url))}"${title} rel="noopener">${renderInline(node.children, imageBase)}</a>`;
    }
    case "wikiLink":
      // 双链指向的是工作区里的另一篇笔记，导出后未必在身边：
      // 保留可读文本 + 一条下划线，不生成会 404 的链接
      return `<span class="wl">${escapeHtml(node.target)}</span>`;
    case "image": {
      const title = node.title ? ` title="${escapeHtml(node.title)}"` : "";
      const size =
        node.width && node.height
          ? ` width="${Number(node.width)}" height="${Number(node.height)}"`
          : "";
      return `<img src="${escapeHtml(safeImageUrl(resolveImageBase(node.url, imageBase)))}" alt="${escapeHtml(node.alt)}"${title}${size} loading="lazy">`;
    }
    case "inlineMath":
      return mathHtml(node.value, false);
    case "footnoteRef":
      return `<sup class="fn-ref"><a href="#fn-${escapeHtml(node.label)}">${escapeHtml(node.label)}</a></sup>`;
    default:
      return "";
  }
}

/* ------------------------------ 块级 ------------------------------ */

function renderBlocks(
  nodes: readonly BlockNode[],
  toc: { depth: number; text: string; anchor: string }[] = [],
  imageBase = "",
): string {
  return nodes
    .map((node) => renderBlock(node, toc, imageBase))
    .filter((html) => html.length > 0)
    .join("\n");
}

function renderBlock(node: BlockNode, toc: { depth: number; text: string; anchor: string }[] = [], imageBase = ""): string {
  switch (node.type) {
    case "paragraph": {
      const inner = renderInline(node.children, imageBase);
      // 空段落就是编辑器里的一行留白：给个 <br> 才不会被浏览器折没
      return inner ? `<p>${inner}</p>` : "<p><br></p>";
    }
    case "heading": {
      const level = Math.min(6, Math.max(1, node.depth));
      const anchor = headingAnchor(inlinePlain(node.children));
      return `<h${level} id="${escapeHtml(anchor)}">${renderInline(node.children, imageBase)}</h${level}>`;
    }
    case "code": {
      // Mermaid 是图表源码，导出里保留可读源码（浏览器里 WYSIWYG 已渲染成图）；
      // 内联 SVG 需要异步渲染，与当前同步导出链冲突，见功能差距清单 A2.9。
      if ((node.lang ?? "").toLowerCase() === "mermaid") {
        return `<pre class="mermaid-source"><code>${escapeHtml(node.value)}</code></pre>`;
      }
      const lang = node.lang ? ` class="language-${escapeHtml(node.lang)}"` : "";
      // 着色只套 span，不改语义；highlightHtml 已做所有文本转义
      // 无语言标记也用通用关键字表着色，代码块不必是单色
      const body = highlightHtml(node.value, node.lang ?? "");
      return `<pre><code${lang}>${body}</code></pre>`;
    }
    case "mathBlock":
      return `<div class="math-block">${mathHtml(node.value, true)}</div>`;
    case "frontmatter": {
      // 属性卡：逐行 `key: value` 渲染成定义列表，不解析复杂 YAML 结构
      const rows = node.value
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          const colon = line.indexOf(":");
          const key = colon === -1 ? line : line.slice(0, colon).trim();
          const value = colon === -1 ? "" : line.slice(colon + 1).trim();
          return `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`;
        })
        .join("");
      return `<dl class="frontmatter">${rows}</dl>`;
    }
    case "footnoteDef":
      return ""; // 定义统一收集到文末脚注区
    case "toc": {
      if (!toc.length) return "";
      const items = toc
        .map(
          (h) =>
            `<li class="toc-l${h.depth}"><a href="#${escapeHtml(headingAnchor(h.text))}">${escapeHtml(h.text)}</a></li>`,
        )
        .join("\n");
      return `<nav class="toc"><ul>${items}</ul></nav>`;
    }
    case "blockquote":
      return `<blockquote>\n${renderBlocks(node.children)}\n</blockquote>`;
    case "list": {
      const tag = node.ordered ? "ol" : "ul";
      const start =
        node.ordered && node.start && node.start !== 1 ? ` start="${node.start}"` : "";
      const items = node.children
        .map((item) => {
          const task = item.checked;
          const box =
            task === undefined
              ? ""
              : `<input type="checkbox" disabled${task ? " checked" : ""}> `;
          // 单项单段：不要包一层 <p>，否则列表项之间凭空多出段距
          const compact =
            item.children.length === 1 && item.children[0].type === "paragraph"
              ? renderInline(item.children[0].children, imageBase)
              : renderBlocks(item.children);
          const cls = task === undefined ? "" : ' class="task"';
          return `<li${cls}>${box}${compact}</li>`;
        })
        .join("\n");
      return `<${tag}${start}>\n${items}\n</${tag}>`;
    }
    case "table": {
      const rows = node.children;
      if (rows.length === 0) return "";
      const alignOf = (index: number) => node.align[index] ?? null;
      const cell = (
        tag: "th" | "td",
        index: number,
        children: readonly InlineNode[],
      ) => {
        const align = alignOf(index);
        const style = align ? ` style="text-align:${align}"` : "";
        return `<${tag}${style}>${renderInline(children)}</${tag}>`;
      };
      const head = `<thead><tr>${rows[0].children
        .map((cell_, index) => cell("th", index, cell_.children))
        .join("")}</tr></thead>`;
      const body = rows
        .slice(1)
        .map(
          (row) =>
            `<tr>${row.children
              .map((cell_, index) => cell("td", index, cell_.children))
              .join("")}</tr>`,
        )
        .join("\n");
      return `<table>${head}${body ? `\n<tbody>${body}</tbody>` : ""}</table>`;
    }
    case "thematicBreak":
      return "<hr>";
    default:
      return "";
  }
}

/** 只渲染正文片段（打印面板直接塞进 DOM，不需要 <html> 外壳）。 */
export function renderBody(
  ir: DocumentIR | readonly BlockNode[],
  imageBase = "",
): string {
  const blocks: readonly BlockNode[] = "children" in ir ? ir.children : ir;
  // [TOC] 要展开整篇的标题，先扫一遍；heading 节点加锚点供站内链接跳转
  const toc = blocks
    .filter((b): b is Extract<BlockNode, { type: "heading" }> => b.type === "heading")
    .map((h) => ({ depth: h.depth, text: inlinePlain(h.children), anchor: headingAnchor(inlinePlain(h.children)) }));
  const body = renderBlocks(blocks, toc, imageBase);
  const defs = blocks.filter(
    (b): b is Extract<BlockNode, { type: "footnoteDef" }> => b.type === "footnoteDef",
  );
  if (!defs.length) return body;
  const items = defs
    .map(
      (d) =>
        `<li id="fn-${escapeHtml(d.label)}">${escapeHtml(d.label)}. ${escapeHtml(d.text)}</li>`,
    )
    .join("\n");
  return `${body}\n<section class="footnotes"><ol>${items}</ol></section>`;
}

/** 行内节点的纯文本（用于标题锚点与 TOC 文字）。 */
function inlinePlain(nodes: readonly InlineNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") out += node.value;
    else if ("children" in node) out += inlinePlain(node.children as InlineNode[]);
    else if (node.type === "inlineMath") out += `$${node.value}$`;
  }
  return out;
}

/* ------------------------------ 样式 ------------------------------ */

/**
 * 导出样式表。
 *
 * `root` 是根选择器：独立文件用 `body`，应用内的打印面板用 `.print-sheet`——
 * 同一份排版规则，两处生效，不会出现「导出的样子」和「打印的样子」不一致。
 */
export function docCss(root: string, options: { dark?: boolean } = {}): string {
  const dark = options.dark !== false;
  return `__R__ {
  font-family: ${FONT_DOC};
  font-size: 16px;
  line-height: 1.9;
  color: #373734;
  background: #fff;
  max-width: 46rem;
  margin: 0 auto;
  padding: 56px 28px 96px;
  -webkit-font-smoothing: antialiased;
  overflow-wrap: break-word;
}
__R__ p { margin: 0 0 20px; }
__R__ h1, __R__ h2, __R__ h3, __R__ h4, __R__ h5, __R__ h6 {
  font-family: ${FONT_DOC};
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.35;
  margin: 40px 0 16px;
}
__R__ h1 { font-size: 34px; margin-top: 0; margin-bottom: 12px; }
__R__ h2 { font-size: 22px; }
__R__ h3 { font-size: 18px; margin-top: 30px; margin-bottom: 12px; }
__R__ h4 { font-size: 16px; margin-top: 26px; margin-bottom: 10px; }
__R__ h5, __R__ h6 { font-size: 15px; margin-top: 22px; margin-bottom: 8px; color: #6a6a66; }
__R__ > :first-child { margin-top: 0; }
__R__ a { color: #4554a8; text-decoration: none; border-bottom: 1px solid rgba(69, 84, 168, 0.3); }
__R__ strong { font-weight: 600; color: #2d2d2b; }
__R__ em { font-style: italic; }
__R__ code {
  font-family: ${FONT_MONO};
  font-size: 0.86em;
  background: #ececea;
  color: #4554a8;
  padding: 2px 6px;
  border-radius: 4px;
}
__R__ pre {
  font-family: ${FONT_MONO};
  font-size: 12.5px;
  line-height: 1.7;
  background: #f7f7f5;
  border: 1px solid #e8e8e4;
  border-radius: 9px;
  padding: 16px 18px;
  margin: 22px 0;
  overflow-x: auto;
  color: #4a4a55;
}
__R__ pre code { background: none; padding: 0; color: inherit; font-size: inherit; }
__R__ pre .cm { color: #9a9a95; }
__R__ pre .kw { color: #8250df; }
__R__ pre .st { color: #22863a; }
__R__ pre .nu { color: #b8860b; }
__R__ blockquote {
  border-left: 3px solid #5b6ec9;
  padding: 2px 0 2px 20px;
  margin: 24px 0;
  color: #7a7a75;
  font-style: italic;
}
__R__ blockquote > :last-child { margin-bottom: 0; }
__R__ ul, __R__ ol { margin: 0 0 20px; padding-left: 26px; }
__R__ li { margin-bottom: 8px; }
__R__ li > ul, __R__ li > ol { margin: 8px 0 0; }
__R__ li.task { list-style: none; margin-left: -22px; }
__R__ li.task input { margin-right: 8px; vertical-align: 1px; }
__R__ li.task > p { display: inline; }
__R__ .footnotes {
  margin-top: 48px;
  padding-top: 18px;
  border-top: 1px solid #e8e8e4;
  font-family: ${FONT_UI};
  font-size: 12px;
  color: #6a6a66;
}
__R__ .footnotes li { margin-bottom: 6px; }
__R__ .fn-ref a { text-decoration: none; }

__R__ .frontmatter {
  margin: 0 0 28px;
  padding: 14px 18px;
  background: #f7f7f5;
  border: 1px solid #e8e8e4;
  border-radius: 9px;
  font-family: ${FONT_UI};
  font-size: 13px;
}
__R__ .frontmatter dt {
  display: inline-block;
  min-width: 76px;
  font-weight: 600;
  color: #6a6a66;
}
__R__ .frontmatter dd { display: inline; margin: 0 0 4px; }
__R__ .toc {
  margin: 0 0 28px;
  padding: 14px 18px;
  background: #f7f7f5;
  border: 1px solid #e8e8e4;
  border-radius: 9px;
  font-family: ${FONT_UI};
  font-size: 13px;
}
__R__ .toc ul { margin: 0; padding-left: 20px; }
__R__ .toc li { margin-bottom: 4px; }
__R__ .toc .toc-l2 { padding-left: 14px; }
__R__ .toc .toc-l3 { padding-left: 28px; }

__R__ .math-block {
  margin: 24px 0;
  overflow-x: auto;
}
__R__ .katex-display { margin: 0; }

__R__ table {
  border-collapse: collapse;
  width: 100%;
  font-family: ${FONT_UI};
  font-size: 13px;
  margin: 22px 0;
}
__R__ th, __R__ td { border: 1px solid #e8e8e4; padding: 9px 12px; text-align: left; }
__R__ th { background: #f7f7f5; font-weight: 500; color: #7a7a75; }
__R__ hr { border: 0; border-top: 1px solid #e8e8e4; margin: 36px 0; }
__R__ img { max-width: 100%; height: auto; border-radius: 6px; }
__R__ .wl { color: #8a6fc9; border-bottom: 1px dashed rgba(138, 111, 201, 0.45); }
${
  dark
    ? `@media screen and (prefers-color-scheme: dark) {
  html { background: #15171a; }
  __R__ { color: #dcdcd8; background: #15171a; }
  __R__ strong { color: #f0f0ec; }
  __R__ code { background: #23262b; color: #a7b4ee; }
  __R__ pre { background: #1b1e22; border-color: #2a2e34; color: #b6babf; }
  __R__ blockquote { border-left-color: #5b6ec9; color: #9a9a95; }
  __R__ th { background: #1e2126; color: #9a9a95; }
  __R__ th, __R__ td { border-color: #2a2e34; }
  __R__ hr { border-top-color: #2a2e34; }
  __R__ h5, __R__ h6 { color: #9a9a95; }
  __R__ a { color: #a7b4ee; border-bottom-color: rgba(167, 180, 238, 0.35); }
  __R__ .wl { color: #b9a6f0; border-bottom-color: rgba(185, 166, 240, 0.4); }
}
`
    : ""
}@media print {
  @page { margin: 18mm 16mm; }
  /* 打印机只有白纸：屏幕上的深色偏好一律不带到纸上 */
  __R__ {
    max-width: none;
    padding: 0;
    font-size: 11.5pt;
    line-height: 1.75;
    color: #000;
    background: #fff;
  }
  __R__ p { margin-bottom: 0.85em; }
  __R__ h1 { font-size: 22pt; page-break-after: avoid; }
  __R__ h2 { font-size: 15pt; page-break-after: avoid; }
  __R__ h3, __R__ h4 { page-break-after: avoid; }
  __R__ pre, __R__ blockquote, __R__ table, __R__ img { page-break-inside: avoid; }
  __R__ pre { background: #f6f6f4; border-color: #dcdcd8; }
  __R__ blockquote { color: #444; border-left-color: #999; }
  __R__ a { color: #000; border-bottom: none; }
  __R__ code { background: #f0f0ee; color: #222; }
  __R__ th { background: #f4f4f2; color: #333; }
  __R__ th, __R__ td { border-color: #bbb; }
  __R__ .wl { color: #333; border-bottom: 1px dashed #aaa; }
}`.replaceAll("__R__", root);
}

/* ------------------------------ 完整文档 ------------------------------ */

export interface HtmlDocumentOptions {
  /** <title> 与文件名用的标题。 */
  title: string;
  /** <html lang>，默认 zh-CN。 */
  lang?: string;
  /** 是否带上跟随系统深浅色的样式（独立文件要，打印面板不要）。 */
  dark?: boolean;
  /** 用户自定义 CSS，经过清洗后内联在文档末尾。 */
  extraCss?: string;
  /** 相对图片路径的根目录，用于静态博客场景。 */
  imageBase?: string;
}

/**
 * 生成可直接发给别人的独立 HTML：无外链、无脚本、无远程字体。
 */
export function renderHtmlDocument(
  ir: DocumentIR,
  options: HtmlDocumentOptions,
): string {
  const title = escapeHtml(options.title || "Untitled");
  const lang = escapeHtml(options.lang || "zh-CN");
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Vellink">
<title>${title}</title>
<style>
${docCss("body", { dark: options.dark !== false })}
${options.extraCss ? `
/* 用户自定义样式 */
${sanitizeCss(options.extraCss)}` : ""}
</style>
</head>
<body>
${renderBody(ir, options.imageBase)}
</body>
</html>
`;
}

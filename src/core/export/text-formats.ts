/**
 * LaTeX / MediaWiki 导出（纯函数）。
 *
 * 两种都是文本格式，直接从 IR 映射，不经过 HTML。目标是「导出的源码能
 * 继续编辑/编译」，不是像素级还原：不认识的节点降级为文本而不是丢掉。
 */

import type { BlockNode, DocumentIR, InlineNode } from "../ir/types";

/* ------------------------------ LaTeX ------------------------------ */

function texEscape(text: string): string {
  return text
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function texInline(nodes: readonly InlineNode[]): string {
  let out = "";
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        out += texEscape(n.value);
        break;
      case "strong":
        out += `\\textbf{${texInline(n.children)}}`;
        break;
      case "emphasis":
        out += `\\emph{${texInline(n.children)}}`;
        break;
      case "inlineCode":
        out += `\\texttt{${texEscape(n.value)}}`;
        break;
      case "link":
        out += `\\href{${n.url.replace(/ /g, "%20")}}{${texInline(n.children)}}`;
        break;
      case "wikiLink":
        out += texEscape(n.target);
        break;
      case "image":
        out += `\\includegraphics{${n.url}}`;
        break;
      case "inlineMath":
        out += `$${n.value}$`;
        break;
      case "footnoteRef":
        out += `\\footnote{${texEscape(n.label)}}`;
        break;
    }
  }
  return out;
}

function texBlocks(nodes: readonly BlockNode[]): string {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "heading": {
        const env = ["chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"][
          Math.min(5, Math.max(0, node.depth - 1))
        ];
        out += `\\${env}{${texInline(node.children)}}\n`;
        break;
      }
      case "paragraph":
        out += `${texInline(node.children)}\n\n`;
        break;
      case "code":
        out += `\\begin{verbatim}\n${node.value}\n\\end{verbatim}\n\n`;
        break;
      case "mathBlock":
        out += `\\[${node.value}\\]\n\n`;
        break;
      case "blockquote":
        out += `\\begin{quote}\n${texBlocks(node.children)}\\end{quote}\n\n`;
        break;
      case "list": {
        out += `\\begin{${node.ordered ? "enumerate" : "itemize"}}\n`;
        for (const item of node.children) {
          const text = item.children
            .filter((b) => b.type === "paragraph")
            .map((b) => (b.type === "paragraph" ? texInline(b.children) : ""))
            .join("");
          const mark = item.checked === undefined ? "" : item.checked ? "[x] " : "[ ] ";
          out += `\\item ${mark}${text}\n`;
        }
        out += `\\end{${node.ordered ? "enumerate" : "itemize"}}\n\n`;
        break;
      }
      case "table": {
        const rows = node.children;
        if (!rows.length) break;
        const cols = rows[0].children.length;
        const align = (node.align ?? [])
          .map((a) => (a === "left" ? "l" : a === "right" ? "r" : a === "center" ? "c" : "l"))
          .join("");
        out += `\\begin{tabular}{${align || "l".repeat(cols)}}\n\\hline\n`;
        for (const row of rows) {
          out += `${row.children.map((c) => texInline(c.children)).join(" & ")} \\\\\n`;
        }
        out += `\\hline\n\\end{tabular}\n\n`;
        break;
      }
      case "thematicBreak":
        out += "\\hrulefill\n\n";
        break;
      case "frontmatter":
      case "toc":
      case "footnoteDef":
        break;
    }
  }
  return out;
}

/** IR → 可编译的 LaTeX 源（带中文支持的文档模板）。 */
export function renderLatex(ir: DocumentIR | readonly BlockNode[], title = "Untitled"): string {
  const nodes: readonly BlockNode[] = "children" in ir ? ir.children : ir;
  return `\\documentclass{article}
\\usepackage{ctex}
\\usepackage{graphicx}
\\usepackage{hyperref}
\\title{${texEscape(title)}}
\\begin{document}
\\maketitle
${texBlocks(nodes)}\\end{document}
`;
}

/* ------------------------------ MediaWiki ------------------------------ */

function wikiInline(nodes: readonly InlineNode[]): string {
  let out = "";
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        out += n.value;
        break;
      case "strong":
        out += `'''${wikiInline(n.children)}'''`;
        break;
      case "emphasis":
        out += `''${wikiInline(n.children)}''`;
        break;
      case "inlineCode":
        out += `<code>${n.value}</code>`;
        break;
      case "link":
        out += `[${n.url} ${wikiInline(n.children)}]`;
        break;
      case "wikiLink":
        out += `[[${n.target}]]`;
        break;
      case "image":
        out += `[[File:${n.url}|${n.alt}]]`;
        break;
      case "inlineMath":
        out += `<math>${n.value}</math>`;
        break;
      case "footnoteRef":
        out += `<ref>${n.label}</ref>`;
        break;
    }
  }
  return out;
}

function wikiBlocks(nodes: readonly BlockNode[]): string {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "heading":
        out += `${"=".repeat(Math.min(6, Math.max(1, node.depth)))} ${wikiInline(node.children)} ${"=".repeat(Math.min(6, Math.max(1, node.depth)))}\n\n`;
        break;
      case "paragraph":
        out += `${wikiInline(node.children)}\n\n`;
        break;
      case "code":
        out += `<syntaxhighlight lang="${node.lang ?? "text"}">\n${node.value}\n</syntaxhighlight>\n\n`;
        break;
      case "mathBlock":
        out += `<math display="block">${node.value}</math>\n\n`;
        break;
      case "blockquote":
        out += `<blockquote>${wikiBlocks(node.children)}</blockquote>\n\n`;
        break;
      case "list":
        for (const item of node.children) {
          const marker = node.ordered ? "#" : "*";
          const text = item.children
            .filter((b) => b.type === "paragraph")
            .map((b) => (b.type === "paragraph" ? wikiInline(b.children) : ""))
            .join("");
          out += `${marker} ${text}\n`;
        }
        out += "\n";
        break;
      case "table": {
        if (!node.children.length) break;
        out += `{| class="wikitable"\n`;
        for (const [i, row] of node.children.entries()) {
          out += i === 0 ? "|-\n! " : "|-\n| ";
          out += `${row.children.map((c) => wikiInline(c.children)).join("\n! ")}\n`;
        }
        out += "|}\n\n";
        break;
      }
      case "thematicBreak":
        out += "----\n\n";
        break;
      case "frontmatter":
      case "toc":
      case "footnoteDef":
        break;
    }
  }
  return out;
}

/** IR → MediaWiki 源码。 */
export function renderMediaWiki(ir: DocumentIR | readonly BlockNode[]): string {
  const nodes: readonly BlockNode[] = "children" in ir ? ir.children : ir;
  return wikiBlocks(nodes);
}

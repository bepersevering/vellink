/**
 * 网页复制 → Markdown。
 *
 * 从剪贴板拿 text/html，用 DOM 解析（浏览器原生 / 测试里 linkedom），
 * 递归把常见标签映射成 Markdown。目标是「粘贴进来能继续写」，不是像素级
 * 还原网页：不认识的标签只取文本，样式/class/script 全部丢弃。
 *
 * 依赖注入 Document 而不是直接用全局 document，方便在 node 测试里验证。
 */

const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "header", "footer", "main", "aside",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "pre", "ul", "ol", "li", "table", "tr", "tbody", "thead",
  "hr", "br", "figure", "figcaption", "dl", "dt", "dd",
]);

const SKIP_TAGS = new Set(["script", "style", "noscript", "iframe", "svg", "canvas", "form", "button"]);

interface Ctx {
  doc: Document;
  /** 图片链接收集：网页图片多半是外链，转换后保留 URL 由调用方决定落地方式。 */
  images: string[];
}

function textOf(node: Node): string {
  return node.textContent ?? "";
}

/** 把一段文本转义掉会被误认成 Markdown 语法的字符。 */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/([*_`\[\]])/g, "\\$1")
    .replace(/^(\s*)([-+>]|\d+\.)/gm, "$1\\$2");
}

function isBlock(node: Node): boolean {
  return node.nodeType === 1 && BLOCK_TAGS.has((node as Element).tagName.toLowerCase());
}

/** 行内递归：返回 Markdown 行内文本。 */
function inline(node: Node, ctx: Ctx): string {
  if (node.nodeType === 3) return escapeText(textOf(node));
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return "";

  const inner = () => Array.from(el.childNodes).map((c) => inline(c, ctx)).join("");
  switch (tag) {
    case "br":
      return "  \n";
    case "strong":
    case "b": {
      const s = inner().trim();
      return s ? `**${s}**` : "";
    }
    case "em":
    case "i": {
      const s = inner().trim();
      return s ? `*${s}*` : "";
    }
    case "del":
    case "s":
    case "strike": {
      const s = inner().trim();
      return s ? `~~${s}~~` : "";
    }
    case "code": {
      // 行内代码里的 Markdown 符号不能再转义，直接取原文
      const s = textOf(el).replace(/\n/g, " ");
      return s ? `\`${s}\`` : "";
    }
    case "a": {
      const href = el.getAttribute("href") ?? "";
      const label = inner().trim() || href;
      if (!href || href.startsWith("javascript:")) return label;
      return `[${label}](${href})`;
    }
    case "img": {
      const src = el.getAttribute("src") ?? "";
      if (!src || src.startsWith("data:")) return "";
      ctx.images.push(src);
      return `![${el.getAttribute("alt") ?? ""}](${src})`;
    }
    case "sub":
      return `~${inner()}~`;
    case "sup":
      return `^${inner()}^`;
    default:
      return inner();
  }
}

/** 块级递归：返回若干行（可能含空行）。 */
function block(node: Node, ctx: Ctx): string[] {
  if (node.nodeType === 3) {
    const t = textOf(node).trim();
    return t ? [escapeText(t)] : [];
  }
  if (node.nodeType !== 1) return [];
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return [];

  const children = Array.from(el.childNodes);
  const inlineOnly = () => children.map((c) => inline(c, ctx)).join("").trim();

  switch (tag) {
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
      const s = inlineOnly();
      return s ? [`${"#".repeat(Number(tag[1]))} ${s}`, ""] : [];
    }
    case "hr":
      return ["---", ""];
    case "p": {
      const s = inlineOnly();
      return s ? [s, ""] : [];
    }
    case "blockquote": {
      const lines = children.flatMap((c) => block(c, ctx));
      return lines.length ? [...lines.map((l) => (l ? `> ${l}` : ">")), ""] : [];
    }
    case "pre": {
      const code = el.querySelector("code") ?? el;
      const raw = textOf(code).replace(/\n$/, "");
      if (!raw.trim()) return [];
      const cls = (code as Element).className ?? "";
      const lang = /(?:^|\s)language-([\w-]+)/.exec(String(cls))?.[1] ?? "";
      return [`\`\`\`${lang}`, raw, "\`\`\`", ""];
    }
    case "ul": case "ol": {
      const out: string[] = [];
      let index = 1;
      for (const li of Array.from(el.children).filter((c) => c.tagName.toLowerCase() === "li")) {
        // 列表项里的嵌套块（子列表）单独递归，第一行用标记
        const parts = Array.from(li.childNodes).flatMap((c) =>
          isBlock(c) && c.nodeName.toLowerCase() !== "ul" && c.nodeName.toLowerCase() !== "ol"
            ? block(c, ctx)
            : [inline(c, ctx)],
        ).filter((s) => s.trim());
        if (!parts.length) continue;
        const marker = tag === "ol" ? `${index++}. ` : "- ";
        out.push(marker + parts[0]);
        for (const rest of parts.slice(1)) out.push(`  ${rest}`);
      }
      return [...out, ""];
    }
    case "table": {
      const rows = Array.from(el.querySelectorAll("tr"));
      if (!rows.length) return [];
      const cells = (row: Element) =>
        Array.from(row.children)
          .filter((c) => /^(td|th)$/i.test(c.tagName))
          .map((c) => inline(c, ctx).replace(/\|/g, "\\|").trim());
      const head = cells(rows[0]);
      if (!head.length) return [];
      const lines = [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`];
      for (const row of rows.slice(1)) {
        const cs = cells(row);
        if (cs.length) lines.push(`| ${cs.join(" | ")} |`);
      }
      return [...lines, ""];
    }
    case "div": case "section": case "article": case "main": {
      // 容器：有块级子元素就递归；否则当一段文字
      if (children.some(isBlock)) return children.flatMap((c) => block(c, ctx));
      const s = inlineOnly();
      return s ? [s, ""] : [];
    }
    default: {
      if (children.some(isBlock)) return children.flatMap((c) => block(c, ctx));
      const s = inlineOnly();
      return s ? [s, ""] : [];
    }
  }
}

/** HTML 字符串 → Markdown。 */
export function htmlToMarkdown(html: string, doc: Document): { markdown: string; images: string[] } {
  const holder = doc.createElement("div");
  holder.innerHTML = html;
  const ctx: Ctx = { doc, images: [] };
  const lines = Array.from(holder.childNodes).flatMap((n) => block(n, ctx));
  // 压缩连续空行，保留段间一个空行
  const out: string[] = [];
  for (const line of lines) {
    if (line === "" && out[out.length - 1] === "") continue;
    out.push(line);
  }
  return { markdown: out.join("\n").replace(/\n+$/, ""), images: ctx.images };
}

/**
 * 从 ClipboardEvent 里取 HTML；没有 text/html 时返回 null（纯文本走原生路径）。
 */
export function clipboardHtml(event: ClipboardEvent): string | null {
  const html = event.clipboardData?.getData("text/html");
  if (!html || !html.trim()) return null;
  // 只有真 HTML 标签才转换；有些站点会把纯文本塞进 text/html
  if (!/<[a-z][\s\S]*>/i.test(html)) return null;
  return html;
}

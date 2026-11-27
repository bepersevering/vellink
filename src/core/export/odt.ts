/**
 * DocumentIR → ODT (OpenDocument Text).
 *
 * Like EPUB, reuses the ZIP writer. ODT body content is expressed in content.xml using
 * office:text / text:h / text:p / text:list / table:table,
 * reusing the IR traversal rather than routing back through HTML — ensuring the same
 * semantic mapping as DOCX export.
 */

import type { BlockNode, DocumentIR, InlineNode } from "../ir/types";
import { createZip, textEntry } from "./zip";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(nodes: readonly InlineNode[]): string {
  let out = "";
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        out += esc(n.value);
        break;
      case "strong":
        out += `<text:span text:style-name="Bold">${inline(n.children)}</text:span>`;
        break;
      case "emphasis":
        out += `<text:span text:style-name="Italic">${inline(n.children)}</text:span>`;
        break;
      case "inlineCode":
        out += `<text:span text:style-name="Code">${esc(n.value)}</text:span>`;
        break;
      case "link":
        out += `<text:a xlink:href="${esc(n.url)}">${inline(n.children)}</text:a>`;
        break;
      case "wikiLink":
        out += `[[${esc(n.target)}]]`;
        break;
      case "footnoteRef":
      case "inlineMath":
        out += esc(n.type === "footnoteRef" ? `[${n.label}]` : `$${n.value}$`);
        break;
      case "image":
        out += `[${esc(n.alt)}]`;
        break;
    }
  }
  return out;
}

function blocks(nodes: readonly BlockNode[]): string {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "heading":
        out += `<text:h text:outline-level="${Math.min(6, Math.max(1, node.depth))}">${inline(node.children)}</text:h>`;
        break;
      case "paragraph":
        out += `<text:p>${inline(node.children)}</text:p>`;
        break;
      case "code":
        out += `<text:p text:style-name="Code">${esc(node.value.replace(/\n/g, " ⏎ "))}</text:p>`;
        break;
      case "blockquote":
        out += `<text:p text:style-name="Quote">${blocks(node.children).replace(/<text:p>|<\/text:p>/g, "")}</text:p>`;
        break;
      case "list": {
        out += `<text:list>${node.children
          .map((item) => {
            const text = item.children
              .filter((b) => b.type === "paragraph")
              .map((b) => (b.type === "paragraph" ? inline(b.children) : ""))
              .join("");
            return `<text:list-item><text:p>${item.checked === undefined ? "" : item.checked ? "[x] " : "[ ] "}${text}</text:p></text:list-item>`;
          })
          .join("")}</text:list>`;
        break;
      }
      case "table": {
        const rows = node.children;
        if (!rows.length) break;
        out += `<table:table>${rows
          .map(
            (row) =>
              `<table:table-row>${row.children
                .map((cell) => `<table:table-cell><text:p>${inline(cell.children)}</text:p></table:table-cell>`)
                .join("")}</table:table-row>`,
          )
          .join("")}</table:table>`;
        break;
      }
      case "mathBlock":
        out += `<text:p>[Formula] ${esc(node.value)}</text:p>`;
        break;
      case "thematicBreak":
        out += "<text:p>────────</text:p>";
        break;
      case "frontmatter":
      case "toc":
      case "footnoteDef":
        break;
    }
  }
  return out;
}

const MIMETYPE = "application/vnd.oasis.opendocument.text";

const MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
<manifest:file-entry manifest:full-path="/" manifest:media-type="${MIMETYPE}"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"><office:styles>
<style:style xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" style:name="Code" style:family="paragraph"/>
<style:style xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" style:name="Quote" style:family="paragraph"/>
</office:styles></office:document-styles>`;

/** Generate the ODT binary. */
export async function renderOdt(ir: DocumentIR | readonly BlockNode[]): Promise<Uint8Array> {
  const nodes: readonly BlockNode[] = "children" in ir ? ir.children : ir;
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink">
<office:automatic-styles>
<style:style style:name="Bold" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="Italic" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
<style:style style:name="Code" style:family="text"><style:text-properties style:font-name="Liberation Mono"/></style:style>
</office:automatic-styles>
<office:body><office:text>${blocks(nodes)}</office:text></office:body>
</office:document-content>`;
  return createZip([
    textEntry("mimetype", MIMETYPE),
    textEntry("META-INF/manifest.xml", MANIFEST),
    textEntry("content.xml", content),
    textEntry("styles.xml", STYLES),
    textEntry("meta.xml", `<?xml version="1.0" encoding="UTF-8"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"><office:meta/></office:document-meta>`),
  ]);
}

/**
 * DocumentIR → DOCX（OOXML）。
 *
 * 只写 Word 打开必需的最小结构： [Content_Types].xml / _rels/.rels /
 * word/document.xml / word/_rels/document.xml.rels / word/styles.xml。
 * 图片作为独立 media 条目写入，document.xml 里用 rId 引用。
 */

import type { BlockNode, DocumentIR, InlineNode } from "../ir/types";
import { createZip, textEntry, type ZipEntry } from "./zip";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface Ctx {
  images: { id: string; data: Uint8Array; ext: string }[];
}

function inline(nodes: readonly InlineNode[], ctx: Ctx): string {
  let out = "";
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        out += `<w:r><w:t xml:space="preserve">${esc(n.value)}</w:t></w:r>`;
        break;
      case "strong":
      case "emphasis": {
        const mark = n.type === "strong" ? "<w:b/>" : "<w:i/>";
        out += `<w:r>${mark}${inline(n.children, ctx)
          .replace(/<w:r>/g, "")
          .replace(/<\/w:r>/g, "")}</w:r>`;
        break;
      }
      case "inlineCode":
        out += `<w:r><w:rFonts w:ascii="Consolas" w:eastAsia="Consolas"/><w:t xml:space="preserve">${esc(n.value)}</w:t></w:r>`;
        break;
      case "link":
        out += inline(n.children, ctx);
        break;
      case "footnoteRef":
        out += `<w:r><w:vertAlign w:val="superscript"/><w:t>[${esc(n.label)}]</w:t></w:r>`;
        break;
      case "wikiLink":
        out += `<w:r><w:t>[[${esc(n.target)}]]</w:t></w:r>`;
        break;
      case "inlineMath":
        out += `<w:r><w:t>${esc(`$${n.value}$`)}</w:t></w:r>`;
        break;
      case "image": {
        const id = `rId${ctx.images.length + 1}`;
        const match = /^data:image\/(png|jpeg|gif|webp);base64,(.+)$/s.exec(n.url);
        if (match) {
          const bin = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
          ctx.images.push({ id, data: bin, ext: match[1] === "jpeg" ? "jpeg" : match[1] });
        } else {
          ctx.images.push({ id, data: new Uint8Array(), ext: "png" });
        }
        out += `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="3810000" cy="2540000"/><wp:docPr id="${ctx.images.length}" name="image${ctx.images.length}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="image"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3810000" cy="2540000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
        break;
      }
    }
  }
  return out;
}

function paragraph(text: string, style?: string): string {
  return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

function blocks(nodes: readonly BlockNode[], ctx: Ctx): string {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "heading": {
        const level = Math.min(6, Math.max(1, node.depth));
        out += `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr>${inline(node.children, ctx)}</w:p>`;
        break;
      }
      case "paragraph":
        out += `<w:p>${inline(node.children, ctx)}</w:p>`;
        break;
      case "code":
        for (const line of node.value.split("\n")) {
          out += `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rFonts w:ascii="Consolas" w:eastAsia="Consolas"/><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`;
        }
        break;
      case "blockquote":
        out += blocks(node.children, ctx);
        break;
      case "list": {
        for (const item of node.children) {
          const text = item.children
            .filter((b) => b.type === "paragraph")
            .map((b) => (b.type === "paragraph" ? inline(b.children, ctx) : ""))
            .join("");
          const marker = item.checked === undefined ? "" : item.checked ? "[x] " : "[ ] ";
          out += `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${node.ordered ? 2 : 1}"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${marker}</w:t></w:r>${text}</w:p>`;
        }
        break;
      }
      case "table": {
        const rows = node.children;
        if (!rows.length) break;
        out += "<w:tbl><w:tblPr><w:tblBorders><w:top w:val=\"single\"/><w:left w:val=\"single\"/><w:bottom w:val=\"single\"/><w:right w:val=\"single\"/><w:insideH w:val=\"single\"/><w:insideV w:val=\"single\"/></w:tblBorders></w:tblPr>";
        for (const row of rows) {
          out += "<w:tr>";
          for (const cell of row.children) {
            out += `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p>${inline(cell.children, ctx)}</w:p></w:tc>`;
          }
          out += "</w:tr>";
        }
        out += "</w:tbl>";
        break;
      }
      case "mathBlock":
        out += paragraph(`[公式] ${node.value}`);
        break;
      case "frontmatter":
      case "toc":
      case "footnoteDef":
        break;
      case "thematicBreak":
        out += paragraph("────────");
        break;
    }
  }
  return out;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Default Extension="gif" ContentType="image/gif"/>
<Default Extension="webp" ContentType="image/webp"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
${[1, 2, 3, 4, 5, 6]
  .map(
    (n) =>
      `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="${Math.max(24, 40 - n * 2)}"/></w:rPr></w:style>`,
  )
  .join("\n")}
</w:styles>`;

/** 生成 DOCX 二进制。 */
export async function renderDocx(ir: DocumentIR | readonly BlockNode[]): Promise<Uint8Array> {
  const nodes: readonly BlockNode[] = "children" in ir ? ir.children : ir;
  const ctx: Ctx = { images: [] };
  const body = blocks(nodes, ctx);

  const rels = ctx.images
    .map(
      (img) =>
        `<Relationship Id="${img.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${img.id.slice(3)}.${img.ext}"/>`,
    )
    .join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>${body}<w:sectPr/></w:body></w:document>`;

  const entries: ZipEntry[] = [
    textEntry("[Content_Types].xml", CONTENT_TYPES),
    textEntry("_rels/.rels", ROOT_RELS),
    textEntry("word/document.xml", document),
    textEntry("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`),
    textEntry("word/styles.xml", STYLES),
    ...ctx.images.map((img) => ({
      name: `word/media/image${img.id.slice(3)}.${img.ext}`,
      data: img.data,
    })),
  ];
  return createZip(entries);
}

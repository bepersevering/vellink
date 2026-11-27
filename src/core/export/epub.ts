/**
 * DocumentIR → EPUB 3.
 *
 * Uses the same ZIP writer as DOCX (store mode). The structure follows the minimal
 * EPUB 3 spec: mimetype must be the first entry, uncompressed, with no extra fields;
 * the rest are container.xml / content.opf / nav.xhtml / the body xhtml. The body reuses
 * the HTML renderer, ensuring the same layout semantics as the editor and HTML export.
 */

import type { BlockNode, DocumentIR } from "../ir/types";
import { renderBody } from "./html";
import { createZip, textEntry } from "./zip";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

function opf(title: string, lang: string): string {
  const id = new Date().toISOString().replace(/[-:.TZ]/g, "");
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">urn:uuid:vellink-${id}</dc:identifier>
<dc:title>${escapeXml(title)}</dc:title>
<dc:language>${escapeXml(lang || "zh-CN")}</dc:language>
<meta property="dcterms:modified">${new Date().toISOString().slice(0, 19)}Z</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="doc" href="document.xhtml" media-type="application/xhtml+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
</manifest>
<spine><itemref idref="doc"/></spine>
</package>`;
}

function xhtml(title: string, lang: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(lang || "zh-CN")}" lang="${escapeXml(lang || "zh-CN")}">
<head><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>${body}</body>
</html>`;
}

/** Generate the nav from body headings (top-level entries, second level indented). */
function nav(ir: DocumentIR | readonly BlockNode[]): string {
  const blocks: readonly BlockNode[] = "children" in ir ? ir.children : ir;
  const items = blocks
    .filter((b): b is Extract<BlockNode, { type: "heading" }> => b.type === "heading")
    .map((h) => {
      const text = h.children
        .map((c) => ("value" in c ? String(c.value) : ""))
        .join("");
      return `<li><a href="document.xhtml#h${h.depth}-${escapeXml(text)}">${escapeXml(text)}</a></li>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Table of Contents</title></head>
<body><nav epub:type="toc"><ol>${items}</ol></nav></body>
</html>`;
}

/** Generate the EPUB 3 binary. */
export async function renderEpub(
  ir: DocumentIR | readonly BlockNode[],
  options: { title: string; lang?: string } = { title: "Untitled" },
): Promise<Uint8Array> {
  const title = options.title || "Untitled";
  const lang = options.lang ?? "zh-CN";
  const body = renderBody(ir);
  return createZip([
    // The EPUB spec requires mimetype to be the first entry and uncompressed (our store mode satisfies this)
    textEntry("mimetype", "application/epub+zip"),
    textEntry("META-INF/container.xml", CONTAINER),
    textEntry("OEBPS/content.opf", opf(title, lang)),
    textEntry("OEBPS/nav.xhtml", nav(ir)),
    textEntry("OEBPS/document.xhtml", xhtml(title, lang, body)),
    textEntry("OEBPS/style.css", "body{font-family:serif;line-height:1.8}pre{white-space:pre-wrap}"),
  ]);
}

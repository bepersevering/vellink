import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../parser/markdown";
import { buildExport } from ".";
import { renderEpub } from "./epub";
import { renderOdt } from "./odt";

const decoder = new TextDecoder();
function decode(bytes: Uint8Array): string { return decoder.decode(bytes); }

/** 与 docx.test 相同的 ZIP 反解，用来验证生成物是合法包。 */
function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error("no EOCD");
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const nameLen = view.getUint16(at + 28, true);
    const name = decode(bytes.slice(at + 46, at + 46 + nameLen));
    const size = view.getUint32(at + 24, true);
    const local = view.getUint32(at + 42, true);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    out.set(name, bytes.slice(start, start + size));
    at += 46 + nameLen + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return out;
}

const SOURCE = "# 第一章\n\n正文 **粗体**。\n\n- 甲\n- 乙\n\n| A | B |\n|---|---|\n| 1 | 2 |\n";

describe("EPUB 导出", () => {
  it("mimetype 是第一个条目且内容正确", async () => {
    const zip = await renderEpub(parseMarkdown({ source: SOURCE }).ir, { title: "书" });
    const entries = readZip(zip);
    const names = [...entries.keys()];
    expect(names[0]).toBe("mimetype");
    expect(decode(entries.get("mimetype")!)).toBe("application/epub+zip");
    expect(new DataView(zip.buffer).getUint32(0, true)).toBe(0x04034b50);
  });

  it("含 OPF / 导航 / 正文，正文由 HTML 渲染器产出", async () => {
    const entries = readZip(await renderEpub(parseMarkdown({ source: SOURCE }).ir, { title: "书" }));
    expect(entries.has("META-INF/container.xml")).toBe(true);
    const opf = decode(entries.get("OEBPS/content.opf")!);
    expect(opf).toContain("<dc:title>书</dc:title>");
    expect(opf).toContain('properties="nav"');
    const nav = decode(entries.get("OEBPS/nav.xhtml")!);
    expect(nav).toContain("第一章");
    const doc = decode(entries.get("OEBPS/document.xhtml")!);
    expect(doc).toContain("<strong>粗体</strong>");
    expect(doc).toContain("<table>");
  });

  it("标题里的 XML 特殊字符被转义", async () => {
    const entries = readZip(
      await renderEpub(parseMarkdown({ source: SOURCE }).ir, { title: "A & B" }),
    );
    expect(decode(entries.get("OEBPS/content.opf")!)).toContain("A &amp; B");
  });
});

describe("ODT 导出", () => {
  it("含 ODF 必需条目与正确 mimetype", async () => {
    const entries = readZip(await renderOdt(parseMarkdown({ source: SOURCE }).ir));
    expect(decode(entries.get("mimetype")!)).toBe(
      "application/vnd.oasis.opendocument.text",
    );
    expect(entries.has("content.xml")).toBe(true);
    expect(entries.has("META-INF/manifest.xml")).toBe(true);
    expect(entries.has("styles.xml")).toBe(true);
  });

  it("标题 / 粗体 / 列表 / 表格映射为 ODF 元素", async () => {
    const entries = readZip(await renderOdt(parseMarkdown({ source: SOURCE }).ir));
    const xml = decode(entries.get("content.xml")!);
    expect(xml).toContain('text:h text:outline-level="1"');
    expect(xml).toContain('text:style-name="Bold"');
    expect(xml).toContain("<text:list>");
    expect(xml).toContain("<table:table>");
  });
});

describe("导出格式注册", () => {
  it("buildExport 返回正确的扩展名与 MIME", async () => {
    for (const [format, ext, mime] of [
      ["epub", "epub", "application/epub+zip"],
      ["odt", "odt", "application/vnd.oasis.opendocument.text"],
    ] as const) {
      const payload = await buildExport({
        format,
        title: "标题",
        source: SOURCE,
      });
      expect(payload.extension).toBe(ext);
      expect(payload.mime).toBe(mime);
      expect(payload.fileName.endsWith(`.${ext}`)).toBe(true);
      expect(payload.contents).toBeInstanceOf(Uint8Array);
    }
  });
});

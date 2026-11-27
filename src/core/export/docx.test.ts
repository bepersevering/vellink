import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../parser/markdown";
import { renderDocx } from "./docx";
import { createZip, textEntry } from "./zip";

const decoder = new TextDecoder();
function decode(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** 最小 ZIP 读取：从 central directory 找条目名与数据区间。 */
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
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const name = decode(bytes.slice(at + 46, at + 46 + nameLen));
    const size = view.getUint32(at + 24, true);
    const local = view.getUint32(at + 42, true);
    const localNameLen = view.getUint16(local + 26, true);
    const localExtraLen = view.getUint16(local + 28, true);
    const start = local + 30 + localNameLen + localExtraLen;
    out.set(name, bytes.slice(start, start + size));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe("最小 ZIP 写出器", () => {
  it("写出可被反解的条目，CRC 与大小正确", async () => {
    const zip = await createZip([
      textEntry("a.txt", "hello"),
      textEntry("dir/b.txt", "世界"),
    ]);
    expect(new DataView(zip.buffer).getUint32(0, true)).toBe(0x04034b50);
    const entries = readZip(zip);
    expect([...entries.keys()]).toEqual(["a.txt", "dir/b.txt"]);
    expect(decode(entries.get("a.txt")!)).toBe("hello");
    expect(decode(entries.get("dir/b.txt")!)).toBe("世界");
  });

  it("空包也合法", async () => {
    const zip = await createZip([]);
    expect(readZip(zip).size).toBe(0);
  });
});

describe("DOCX 生成", () => {
  async function docxOf(source: string) {
    const { ir } = parseMarkdown({ source });
    return readZip(await renderDocx(ir));
  }

  it("产出 OOXML 必需条目", async () => {
    const files = await docxOf("# 标题\n\n正文");
    expect(files.has("[Content_Types].xml")).toBe(true);
    expect(files.has("_rels/.rels")).toBe(true);
    expect(files.has("word/document.xml")).toBe(true);
    expect(files.has("word/styles.xml")).toBe(true);
  });

  it("标题映射为 Heading1 样式，正文是段落", async () => {
    const files = await docxOf("# 标题\n\n正文");
    const xml = decode(files.get("word/document.xml")!);
    expect(xml).toContain('w:pStyle w:val="Heading1"');
    expect(xml).toContain("<w:t xml:space=\"preserve\">标题</w:t>");
    expect(xml).toContain("<w:t xml:space=\"preserve\">正文</w:t>");
  });

  it("粗体 / 行内代码 / 链接 / 表格都产出节点", async () => {
    const files = await docxOf(
      "**粗** `码` [链接](https://e.com)\n\n| A | B |\n|---|---|\n| 1 | 2 |\n",
    );
    const xml = decode(files.get("word/document.xml")!);
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain("Consolas");
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("链接");
  });

  it("data URI 图片写进 media 并在 rels 里引用", async () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
    const files = await docxOf(`![图](data:image/png;base64,${png})`);
    const media = [...files.keys()].filter((n) => n.startsWith("word/media/"));
    expect(media).toHaveLength(1);
    const rels = decode(files.get("word/_rels/document.xml.rels")!);
    expect(rels).toContain("image");
    expect(files.get(media[0])!.length).toBeGreaterThan(0);
  });

  it("特殊字符被转义，不会破坏 XML", async () => {
    const files = await docxOf("正文 <tag> & \"引号\"");
    const xml = decode(files.get("word/document.xml")!);
    expect(xml).toContain("&lt;tag&gt;");
    expect(xml).toContain("&amp;");
    expect(xml).not.toContain("<tag>");
  });
});

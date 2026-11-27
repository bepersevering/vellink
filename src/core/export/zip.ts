/**
 * 最小 ZIP 写出器（store 模式，不压缩）。
 *
 * DOCX / EPUB / ODT 都是 ZIP 包着 XML。为了不引入第三方依赖，这里实现
 * 最简 ZIP：local file header + central directory + EOCD，全部用 store
 * （compression method 0）。XML 文本本身已高度冗余但文件通常很小，不压缩
 * 完全可接受，而且换来零依赖、可单测、无原生模块。
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const encoder = new TextEncoder();

/** CRC-32（IEEE 802.3）。表在首次调用时生成。 */
let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS 日期时间：ZIP 只需要一个合法值，不追求精确。 */
function dosDateTime(date: Date): { time: number; day: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

class Writer {
  private parts: Uint8Array[] = [];
  length = 0;

  write(bytes: Uint8Array): void {
    this.parts.push(bytes);
    this.length += bytes.length;
  }

  u16(value: number): void {
    this.write(Uint8Array.of(value & 0xff, (value >>> 8) & 0xff));
  }

  u32(value: number): void {
    this.write(
      Uint8Array.of(
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff,
      ),
    );
  }

  async bytes(): Promise<Uint8Array> {
    const blob = new Blob(this.parts as BlobPart[], { type: "application/zip" });
    return new Uint8Array(await blob.arrayBuffer());
  }
}

/** 把若干条目打包成 ZIP（store 模式）。 */
export async function createZip(entries: ZipEntry[], now = new Date()): Promise<Uint8Array> {
  const out = new Writer();
  const central: { entry: ZipEntry; crc: number; offset: number; name: Uint8Array }[] = [];
  const { time, day } = dosDateTime(now);

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const offset = out.length;
    out.u32(0x04034b50); // local file header signature
    out.u16(20); // version needed
    out.u16(0); // flags
    out.u16(0); // method: store
    out.u16(time);
    out.u16(day);
    out.u32(crc);
    out.u32(entry.data.length);
    out.u32(entry.data.length);
    out.u16(name.length);
    out.u16(0); // extra length
    out.write(name);
    out.write(entry.data);
    central.push({ entry, crc, offset, name });
  }

  const centralStart = out.length;
  for (const item of central) {
    out.u32(0x02014b50); // central directory signature
    out.u16(20); // version made by
    out.u16(20); // version needed
    out.u16(0);
    out.u16(0); // store
    out.u16(time);
    out.u16(day);
    out.u32(item.crc);
    out.u32(item.entry.data.length);
    out.u32(item.entry.data.length);
    out.u16(item.name.length);
    out.u16(0); // extra
    out.u16(0); // comment
    out.u16(0); // disk number
    out.u16(0); // internal attrs
    out.u32(0); // external attrs
    out.u32(item.offset);
    out.write(item.name);
  }

  const centralSize = out.length - centralStart;
  out.u32(0x06054b50); // EOCD signature
  out.u16(0);
  out.u16(0);
  out.u16(central.length);
  out.u16(central.length);
  out.u32(centralSize);
  out.u32(centralStart);
  out.u16(0); // comment length

  return out.bytes();
}

/** 文本条目快捷构造。 */
export function textEntry(name: string, text: string): ZipEntry {
  return { name, data: encoder.encode(text) };
}

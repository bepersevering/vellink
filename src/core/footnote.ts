/**
 * Footnote recognition (pure functions).
 *
 * Lezer doesn't recognize `[^1]` or `[^1]: content`. Same strategy as math formulas: recognize at the
 * source level, inline references become atoms, end-of-document definition lines become footnote blocks.
 * The two pair up by label.
 *
 * Rules:
 * - Definitions must start at the beginning of a line (indentation ≤3 allowed), format `[^label]: content`;
 * - References are inline `[^label]`, without a colon;
 * - Labels allow only letters, digits, Chinese characters, `-` and `_`, to avoid confusion with link syntax.
 */

export interface FootnoteRef {
  start: number;
  end: number;
  label: string;
}

export interface FootnoteDef {
  start: number;
  end: number;
  label: string;
  /** Content after the colon (excluding the trailing newline). */
  text: string;
}

export interface Footnotes {
  refs: FootnoteRef[];
  defs: FootnoteDef[];
}

const LABEL = "[\\w\\u4e00-\\u9fff-]+";

/** Scan the whole text for footnote references and definitions. */
export function findFootnotes(source: string): Footnotes {
  const refs: FootnoteRef[] = [];
  const defs: FootnoteDef[] = [];
  const re = new RegExp(`\\[\\^(${LABEL})\\](:?)`, "g");
  let m: RegExpExecArray | null;

  // First mark line ranges of fenced code blocks to avoid treating [^1] inside them as footnotes
  const fenced = new Array<boolean>(source.length).fill(false);
  let inFence = false;
  let lineStart = 0;
  while (lineStart <= source.length) {
    const lineEnd = source.indexOf("\n", lineStart);
    const stop = lineEnd === -1 ? source.length : lineEnd;
    const line = source.slice(lineStart, stop);
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
    } else if (inFence) {
      fenced.fill(true, lineStart, stop + 1);
    }
    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
  }

  while ((m = re.exec(source)) !== null) {
    const start = m.index;
    if (fenced[start]) continue;
    // An escaped \[ doesn't count
    if (source[start - 1] === "\\") continue;

    const end = start + m[0].length;
    if (m[2] === ":") {
      // A definition must start at the beginning of a line (at most 3 spaces)
      const bol = source.lastIndexOf("\n", start - 1) + 1;
      if (source.slice(bol, start).trim() !== "") continue;
      const lineEnd = source.indexOf("\n", end);
      const stop = lineEnd === -1 ? source.length : lineEnd;
      defs.push({ start, end: stop, label: m[1], text: source.slice(end, stop).trim() });
    } else {
      refs.push({ start, end, label: m[1] });
    }
  }
  return { refs, defs };
}

/** Split a span of text into text / ref chunks by footnote references (absolute offsets). */
export type FootnoteChunk =
  | { kind: "text"; start: number; end: number; value: string }
  | { kind: "ref"; start: number; end: number; label: string };

export function splitFootnoteRefs(
  source: string,
  from: number,
  to: number,
  refs: readonly FootnoteRef[],
): FootnoteChunk[] {
  const hits = refs.filter((r) => r.start >= from && r.end <= to);
  if (!hits.length) return [{ kind: "text", start: from, end: to, value: source.slice(from, to) }];
  const out: FootnoteChunk[] = [];
  let cursor = from;
  for (const hit of hits) {
    if (hit.start > cursor) {
      out.push({
        kind: "text",
        start: cursor,
        end: hit.start,
        value: source.slice(cursor, hit.start),
      });
    }
    out.push({ kind: "ref", start: hit.start, end: hit.end, label: hit.label });
    cursor = hit.end;
  }
  if (cursor < to) out.push({ kind: "text", start: cursor, end: to, value: source.slice(cursor, to) });
  return out;
}

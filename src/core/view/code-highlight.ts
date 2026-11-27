/**
 * Lightweight syntax highlighting for WYSIWYG code blocks.
 *
 * Why not highlight.js / Shiki:
 * - PM's codeBlock is atom-like content (text*, no marks), so highlighting can only touch
 *   the DOM, not the document; cramming a thousands-of-lines language pack into every
 *   repaint isn't worth it.
 * - The goal here is "code blocks aren't monochrome", not an IDE-grade syntax tree. A
 *   tokenizer of a few dozen lines covering keywords / strings / comments / numbers for
 *   common languages is enough, has zero dependencies, and can be asserted directly in
 *   node unit tests.
 *
 * The emitted span classes correspond to the existing .cm/.kw/.st/.nu in styles.css.
 */

export type TokenKind = "plain" | "comment" | "keyword" | "string" | "number";

export interface Token {
  kind: TokenKind;
  text: string;
}

/** Keywords for common languages (enough for everyday code blocks, not exhaustive). */
const KEYWORDS = new Set(
  (
    "const let var function return if else for while do break continue class extends new " +
    "import export from default async await try catch finally throw typeof instanceof " +
    "this super switch case delete in of yield static get set " +
    "def self None True False elif lambda pass raise with as global nonlocal not and or is " +
    "fn pub struct enum impl trait match use mod crate mut ref where type " +
    "public private protected final abstract interface implements package override " +
    "int long double float char bool void string null true false nil undefined " +
    "select insert update delete create table from where join group by order limit " +
    "if then else fi end begin function procedure dim print echo require include"
  ).split(/\s+/),
);

const LINE_COMMENT: Record<string, string> = {
  js: "//", javascript: "//", ts: "//", typescript: "//", jsx: "//", tsx: "//",
  java: "//", c: "//", cpp: "//", "c++": "//", cs: "//", csharp: "//", go: "//",
  rust: "//", rs: "//", swift: "//", kotlin: "//", php: "//", scala: "//",
  python: "#", py: "#", ruby: "#", rb: "#", bash: "#", sh: "#", shell: "#",
  yaml: "#", yml: "#", toml: "#", makefile: "#", dockerfile: "#",
  sql: "--", lua: "--", haskell: "--", hs: "--",
};

const BLOCK_COMMENT: Record<string, [string, string]> = {
  js: ["/*", "*/"], javascript: ["/*", "*/"], ts: ["/*", "*/"], typescript: ["/*", "*/"],
  jsx: ["/*", "*/"], tsx: ["/*", "*/"], java: ["/*", "*/"], c: ["/*", "*/"],
  cpp: ["/*", "*/"], "c++": ["/*", "*/"], cs: ["/*", "*/"], csharp: ["/*", "*/"],
  go: ["/*", "*/"], rust: ["/*", "*/"], rs: ["/*", "*/"], swift: ["/*", "*/"],
  kotlin: ["/*", "*/"], php: ["/*", "*/"], scala: ["/*", "*/"], css: ["/*", "*/"],
  sql: ["/*", "*/"],
};

function isWord(ch: string): boolean {
  return /[A-Za-z_$]/.test(ch) || ch.charCodeAt(0) > 127;
}

function isWordPart(ch: string): boolean {
  return isWord(ch) || /[0-9]/.test(ch);
}

/**
 * Split a piece of code into typed tokens. Scans character by character, ensuring every
 * character belongs to some token so no content is lost — highlighting only changes the
 * DOM, the source remains the original text in PM.
 */
export function tokenize(code: string, lang = ""): Token[] {
  const key = lang.trim().toLowerCase();
  const lineComment = LINE_COMMENT[key];
  const blockComment = BLOCK_COMMENT[key];
  const out: Token[] = [];
  let i = 0;

  const push = (kind: TokenKind, text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };

  while (i < code.length) {
    const rest = code.slice(i);

    // Block comment (may span lines)
    if (blockComment && rest.startsWith(blockComment[0])) {
      const end = code.indexOf(blockComment[1], i + blockComment[0].length);
      const stop = end === -1 ? code.length : end + blockComment[1].length;
      push("comment", code.slice(i, stop));
      i = stop;
      continue;
    }
    // Line comment
    if (lineComment && rest.startsWith(lineComment)) {
      const nl = code.indexOf("\n", i);
      const stop = nl === -1 ? code.length : nl;
      push("comment", code.slice(i, stop));
      i = stop;
      continue;
    }
    // Strings: single / double / backtick quotes, with backslash escaping handled
    const quote = code[i];
    if (quote === '"' || quote === "'" || quote === "`") {
      let j = i + 1;
      while (j < code.length) {
        if (code[j] === "\\") {
          j += 2;
          continue;
        }
        if (code[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      push("string", code.slice(i, j));
      i = j;
      continue;
    }
    // Numbers (including decimals / hex / underscores)
    if (/[0-9]/.test(code[i])) {
      let j = i + 1;
      while (j < code.length && /[0-9a-fA-FxX._]/.test(code[j])) j++;
      push("number", code.slice(i, j));
      i = j;
      continue;
    }
    // Identifiers / keywords
    if (isWord(code[i])) {
      let j = i + 1;
      while (j < code.length && isWordPart(code[j])) j++;
      const word = code.slice(i, j);
      push(KEYWORDS.has(word.toLowerCase()) ? "keyword" : "plain", word);
      i = j;
      continue;
    }
    push("plain", code[i]);
    i += 1;
  }
  return out;
}

/** Build a safe HTML fragment from tokens (only used to wrap existing text nodes in spans; never enters the IR). */
export function highlightHtml(code: string, lang: string): string {
  const cls: Record<TokenKind, string> = {
    plain: "",
    comment: "cm",
    keyword: "kw",
    string: "st",
    number: "nu",
  };
  return tokenize(code, lang)
    .map((t) => {
      const text = t.text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return cls[t.kind] ? `<span class="${cls[t.kind]}">${text}</span>` : text;
    })
    .join("");
}

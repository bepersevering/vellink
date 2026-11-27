/**
 * WYSIWYG 代码块的轻量语法着色。
 *
 * 为什么不用 highlight.js / Shiki：
 * - PM 的 codeBlock 是 atom 式内容（text*，marks 为空），着色只能改 DOM，
 *   不能进文档；把几千行的语言包塞进每一次重绘不划算。
 * - 这里的目标是「代码块不再是单色」，不是 IDE 级语法树。一个几十行的
 *   分词器覆盖常见语言的关键字 / 字符串 / 注释 / 数字就够，且零依赖、
 *   可在 node 单测里直接断言。
 *
 * 输出的 span class 与 styles.css 里既有的 .cm/.kw/.st/.nu 对应。
 */

export type TokenKind = "plain" | "comment" | "keyword" | "string" | "number";

export interface Token {
  kind: TokenKind;
  text: string;
}

/** 常见语言关键字（够覆盖日常代码块，不追求完整）。 */
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
 * 把一段代码切成带类型的 token。逐字符扫描，保证所有字符都归属某个 token，
 * 不会丢内容——着色只改 DOM，源码仍是 PM 里的原文。
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

    // 块注释（可跨行）
    if (blockComment && rest.startsWith(blockComment[0])) {
      const end = code.indexOf(blockComment[1], i + blockComment[0].length);
      const stop = end === -1 ? code.length : end + blockComment[1].length;
      push("comment", code.slice(i, stop));
      i = stop;
      continue;
    }
    // 行注释
    if (lineComment && rest.startsWith(lineComment)) {
      const nl = code.indexOf("\n", i);
      const stop = nl === -1 ? code.length : nl;
      push("comment", code.slice(i, stop));
      i = stop;
      continue;
    }
    // 字符串：单引号 / 双引号 / 反引号，处理反斜杠转义
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
    // 数字（含小数 / 十六进制 / 下划线）
    if (/[0-9]/.test(code[i])) {
      let j = i + 1;
      while (j < code.length && /[0-9a-fA-FxX._]/.test(code[j])) j++;
      push("number", code.slice(i, j));
      i = j;
      continue;
    }
    // 标识符 / 关键字
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

/** 按 token 生成安全的 HTML 片段（只用于给已有文本节点套 span，不进 IR）。 */
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

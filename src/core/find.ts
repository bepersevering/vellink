/**
 * 查找替换的纯逻辑：在一段文本里找命中、算替换结果。
 *
 * 刻意不依赖 DOM、不依赖编辑器：两种视图（PM / CodeMirror）与命令面板的
 * 全库搜索都复用这一份规则，否则「网页版能搜到、桌面版搜不到」这种偏差
 * 迟早会出现。
 *
 * 边界约定：
 * - 空查询不返回命中，也不算错误。
 * - 正则写错只返回 error，不抛异常（输入框里每敲一个字符都可能是半截正则）。
 * - 命中数有上限：一篇十万字的文档搜单个字母，高亮几千段会把主线程卡死。
 * - 零宽命中（如 `^`、`\b`）也要向前推进，否则 lastIndex 不前进会死循环。
 */

export interface FindOptions {
  /** 区分大小写，默认否。 */
  caseSensitive?: boolean;
  /** 把查询串当正则，默认否。 */
  regex?: boolean;
  /** 只命中完整单词（ASCII 词边界），默认否。 */
  wholeWord?: boolean;
  /** 命中上限，默认 2000。 */
  limit?: number;
}

/** 一处命中。`from`/`to` 是文本偏移（左闭右开）。 */
export interface FindMatch {
  from: number;
  to: number;
  /** 命中的原文，替换时 `$&` 用它。 */
  text: string;
  /** 正则捕获组，替换时 `$1`…`$9` 用它们。 */
  groups: readonly string[];
}

export interface FindResult {
  matches: FindMatch[];
  /** 命中被上限截断（提示用户缩小范围，而不是假装只有这些）。 */
  truncated: boolean;
  /** 正则语法错误。 */
  error: "regex" | null;
}

const DEFAULT_LIMIT = 2000;

/** 把一个普通字符串变成可安全嵌入正则的字面量。 */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** ASCII 词字符；中日韩文字不做词边界判断。 */
function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[0-9A-Za-z_]/.test(char);
}

function boundaryOk(text: string, from: number, to: number): boolean {
  // 命中本身不是词（如正则 `\d+` 命中的是数字）时，词边界没有意义
  if (!isWordChar(text[from]) && !isWordChar(text[to - 1])) return true;
  return !isWordChar(text[from - 1]) && !isWordChar(text[to]);
}

/**
 * 在文本里找全部命中。
 *
 * 字面量搜索也走正则（先转义）：这样大小写折叠由引擎负责，
 * 不会出现 `toLowerCase()` 改变长度（如 `İ`）导致偏移错位的问题。
 */
export function findMatches(
  text: string,
  query: string,
  options: FindOptions = {},
): FindResult {
  const empty: FindResult = { matches: [], truncated: false, error: null };
  if (!query) return empty;

  const limit = options.limit ?? DEFAULT_LIMIT;
  // 空正则（如 `()`）也能匹配，但空查询已经在上面挡掉了
  const flags = `g${options.caseSensitive ? "" : "i"}${options.regex ? "" : ""}`;
  const pattern = options.regex ? query : escapeRegExp(query);

  let re: RegExp;
  try {
    re = new RegExp(pattern, flags);
  } catch {
    return { matches: [], truncated: false, error: "regex" };
  }

  const matches: FindMatch[] = [];
  let truncated = false;
  for (;;) {
    const hit = re.exec(text);
    if (!hit) break;
    const from = hit.index;
    const to = from + hit[0].length;

    if (options.wholeWord && !boundaryOk(text, from, to)) {
      // 不满足边界也不能原地打转
      re.lastIndex = to > from ? to : from + 1;
      continue;
    }

    if (matches.length >= limit) {
      truncated = true;
      break;
    }
    matches.push({
      from,
      to,
      text: hit[0],
      groups: hit.slice(1).map((group) => group ?? ""),
    });

    // 零宽命中：手工推进一格，否则 exec 永远停在同一位置
    if (to === from) re.lastIndex = from + 1;
  }

  return { matches, truncated, error: null };
}

/**
 * 展开替换串里的 `$$`、`$&`、`$1`…`$9`。
 *
 * 不认识的就原样保留（用户写 `$10` 时不该被吞成 `$1` + `0`）。
 */
export function expandReplacement(
  replacement: string,
  match: Pick<FindMatch, "text" | "groups">,
): string {
  return replacement.replace(/\$(\$|&|\d{1,2})/g, (whole, token: string) => {
    if (token === "$") return "$";
    if (token === "&") return match.text;
    const index = Number(token);
    if (index === 0) return match.text;
    const group = match.groups[index - 1];
    return group === undefined ? whole : group;
  });
}

/**
 * 按命中把文本整体替换掉。
 *
 * 从后往前改，前面的偏移就不会失效；这也让「全量替换」天然只需要一次拼接。
 */
export function replaceMatches(
  text: string,
  matches: readonly FindMatch[],
  replacement: string,
): string {
  let next = text;
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const match = matches[i];
    next =
      next.slice(0, match.from) +
      expandReplacement(replacement, match) +
      next.slice(match.to);
  }
  return next;
}

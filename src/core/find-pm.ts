/**
 * WYSIWYG 视图里的「可见文本」投影。
 *
 * 搜索要搜用户看得见的字，而 ProseMirror 的坐标里夹着节点边界（段落、列表、
 * 表格），跟文本偏移不是一回事。这里把整篇 doc 拍平成一串文本，同时记下
 * 每段文本在 PM 里的起点，命中就能换算回可高亮、可替换的区间。
 *
 * 块与块之间补一个 `\n`：既让「跨段落拼出来的假命中」不可能存在，
 * 也让命中位置的行号看起来正常。跨分隔符的命中在 `locateInPM` 里被拒绝
 * （高亮一个跨越两段的范围在 PM 里没有意义）。
 */

import type { Node as PMNode } from "prosemirror-model";

/** 一段连续文本（一个 text 节点）在两套坐标里的位置。 */
export interface PMTextSegment {
  /** 拍平文本里的起点。 */
  from: number;
  /** 拍平文本里的终点（不含）。 */
  to: number;
  /** PM 文档里的起点：第一个字符之前的位置。 */
  pmFrom: number;
  pmTo: number;
}

export interface PMTextMap {
  text: string;
  segments: PMTextSegment[];
}

/** 把一篇 PM 文档拍平成可搜索文本 + 位置映射。 */
export function buildPMTextMap(doc: PMNode): PMTextMap {
  const segments: PMTextSegment[] = [];
  let text = "";

  const breakBlock = () => {
    if (text.length === 0 || text.endsWith("\n")) return;
    text += "\n";
  };

  doc.descendants((node, pos) => {
    if (node.isBlock) {
      breakBlock();
      return;
    }
    if (!node.isText) return;
    const value = node.text ?? "";
    if (value.length === 0) return;
    const from = text.length;
    text += value;
    segments.push({ from, to: text.length, pmFrom: pos, pmTo: pos + value.length });
  });

  // 收尾的换行没有意义，去掉免得影响末尾命中的判断
  if (text.endsWith("\n")) text = text.slice(0, -1);

  return { text, segments };
}

/** 二分找到包含 `offset` 的段（`from <= offset < to`）。 */
function segmentAt(
  segments: readonly PMTextSegment[],
  offset: number,
): PMTextSegment | null {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const seg = segments[mid];
    if (offset < seg.from) high = mid - 1;
    else if (offset >= seg.to) low = mid + 1;
    else return seg;
  }
  return null;
}

/**
 * 文本偏移区间 → PM 区间。
 *
 * 返回 null 表示这段命中没法在 WYSIWYG 里表示（跨块、或落在补出来的换行上）。
 * 调用方应当把它从高亮/替换列表里剔除，而不是硬塞一个近似位置——
 * 近似位置会让「替换」改到相邻的字，那是最难查的一类 bug。
 */
export function locateInPM(
  map: PMTextMap,
  from: number,
  to: number,
): { from: number; to: number } | null {
  if (to <= from) return null;
  const start = segmentAt(map.segments, from);
  const end = segmentAt(map.segments, to - 1);
  if (!start || !end) return null;

  const pmFrom = start.pmFrom + (from - start.from);
  const pmTo = end.pmFrom + (to - end.from);
  // PM 跨度比文本长度短，说明中间有分隔符（或段落边界），这属于跨块命中
  if (pmTo - pmFrom !== to - from) return null;
  return { from: pmFrom, to: pmTo };
}

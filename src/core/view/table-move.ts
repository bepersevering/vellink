/**
 * 表格行 / 列移动（PM 命令）。
 *
 * Markdown 表格没有「列宽」概念，所以把清单里的「拖拽调整列宽 / 行顺序」
 * 落成可持久化的「移动行 / 移动列」：两者都改单元格顺序，序列化后就是
 * 新的 Markdown 表格。用键盘 ⌘⇧方向键触发，比拖拽更精确、可访问。
 */

import type { Node as PMNode } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { vellinkSchema as S } from "./schema";

type Direction = -1 | 1;

interface Location {
  table: PMNode;
  tablePos: number;
  rowIndex: number;
  colIndex: number;
}

/** 定位光标所在的表格、行、列。表头行索引 0 也允许移动。 */
export function tableLocation(doc: PMNode, pos: number): Location | null {
  let result: Location | null = null;
  doc.descendants((node, nodePos) => {
    if (node.type !== S.nodes.table) return;
    if (pos < nodePos || pos > nodePos + node.nodeSize) return;
    node.forEach((row, rowOffset) => {
      if (result) return;
      const rowPos = nodePos + 1 + rowOffset;
      if (pos < rowPos || pos > rowPos + row.nodeSize) return;
      // PM 的 forEach 第二个参数是节点 offset（含大小累加），不是序号；
      // 这里用显式计数器拿列索引，再按真实 offset 定位单元格。
      let colIndex = 0;
      let cellPos = rowPos + 1;
      row.forEach((cell) => {
        if (result) return;
        if (pos >= cellPos && pos <= cellPos + cell.nodeSize) {
          result = { table: node, tablePos: nodePos, rowIndex: rowOffset, colIndex };
        }
        cellPos += cell.nodeSize;
        colIndex += 1;
      });
    });
  });
  return result;
}

/** 建一张只替换了某一行顺序的新 table 节点。 */
export function moveRow(table: PMNode, from: number, direction: Direction): PMNode | null {
  const to = from + direction;
  if (to < 0 || to >= table.childCount) return null;
  const rows: PMNode[] = [];
  table.forEach((row) => rows.push(row));
  const [moved] = rows.splice(from, 1);
  rows.splice(to, 0, moved);
  return S.nodes.table.create({ align: table.attrs.align }, rows);
}

/** 建一张每个单元格在指定列上交换过的新 table 节点。 */
export function moveColumn(table: PMNode, from: number, direction: Direction): PMNode | null {
  const to = from + direction;
  if (to < 0) return null;
  const rows: PMNode[] = [];
  table.forEach((row) => {
    if (to >= row.childCount) {
      rows.push(row);
      return;
    }
    const cells: PMNode[] = [];
    row.forEach((cell) => cells.push(cell));
    const [moved] = cells.splice(from, 1);
    if (!moved) {
      rows.push(row);
      return;
    }
    cells.splice(to, 0, moved);
    rows.push(S.nodes.tableRow.create(null, cells));
  });
  if (rows.every((row, i) => row === table.child(i))) return null;
  return S.nodes.table.create({ align: table.attrs.align }, rows);
}

/** 生成移动行 / 列的 PM 命令。 */
export function moveTableCell(axis: "row" | "column", direction: Direction): Command {
  return (state, dispatch) => {
    const loc = tableLocation(state.doc, state.selection.from);
    if (!loc || !dispatch) return false;
    const next =
      axis === "row"
        ? moveRow(loc.table, loc.rowIndex, direction)
        : moveColumn(loc.table, loc.colIndex, direction);
    if (!next) return false;
    dispatch(state.tr.replaceWith(loc.tablePos, loc.tablePos + loc.table.nodeSize, next));
    return true;
  };
}

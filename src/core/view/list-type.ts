/**
 * 列表类型转换：无序 / 有序 / 任务列表互转。
 *
 * PM 里这三种是不同节点（bulletList / orderedList + listItem.checked），
 * 光标可能停在任意深层列表项里。命令找到光标所在的**最外层**列表，
 * 按目标类型重建，保留每个 listItem 的完整内容与顺序。
 */

import type { Node as PMNode, NodeType } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { vellinkSchema as S } from "./schema";

export type ListKind = "bullet" | "ordered" | "task";

/** 光标所在的最外层列表节点及其位置。 */
export function enclosingList(doc: PMNode, pos: number): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null;
  doc.descendants((node, nodePos) => {
    if (node.type !== S.nodes.bulletList && node.type !== S.nodes.orderedList) return;
    if (nodePos <= pos && pos <= nodePos + node.nodeSize) found = { node, pos: nodePos };
  });
  return found;
}

/** 当前列表属于哪种类型。 */
export function listKind(node: PMNode): ListKind | null {
  if (node.type === S.nodes.orderedList) return "ordered";
  if (node.type !== S.nodes.bulletList) return null;
  const items: PMNode[] = [];
  node.forEach((item) => items.push(item));
  return items.length > 0 && items.every((item) => item.attrs.checked !== null)
    ? "task"
    : "bullet";
}

/** 按目标类型重建列表；checked 状态只在 task 列表里保留。 */
export function convertList(node: PMNode, target: ListKind): PMNode {
  const items: PMNode[] = [];
  node.forEach((item) => items.push(item));

  const converted = items.map((item) => {
    const checked = target === "task" ? (item.attrs.checked ?? false) : null;
    return S.nodes.listItem.create({ checked }, item.content);
  });

  if (target === "ordered") {
    // 保留原 start（有序列表从 3 开始的情况不能丢）
    const start = node.type === S.nodes.orderedList ? Number(node.attrs.start) || 1 : 1;
    return S.nodes.orderedList.create({ start }, converted);
  }
  return S.nodes.bulletList.create(null, converted);
}

/** 生成一个把当前列表转成 target 的 PM Command。 */
export function convertListCommand(target: ListKind): Command {
  return (state, dispatch) => {
    const found = enclosingList(state.doc, state.selection.from);
    if (!found || !dispatch) return false;
    if (listKind(found.node) === target) return false;
    const replacement = convertList(found.node, target);
    const tr = state.tr.replaceWith(found.pos, found.pos + found.node.nodeSize, replacement);
    dispatch(tr);
    return true;
  };
}

/** schema 里的列表类型（测试与调用方共用，避免各自硬编码）。 */
export const LIST_TYPES: Record<ListKind, NodeType> = {
  bullet: S.nodes.bulletList,
  ordered: S.nodes.orderedList,
  task: S.nodes.bulletList,
};

/**
 * 块级复用正确性：确保"跳过映射"不会导致内容错误或 ID 串位。
 * 这是性能优化的安全网——复用判断错了，用户会看到内容不更新。
 */
import { describe, expect, it } from "vitest";
import { parseMarkdown, unshiftOffset, type Change } from "./markdown";
import { validateSpans } from "./sourcemap";
import { walkBlocks } from "../ir/types";

const DOC = `# 标题

第一段内容。

第二段内容。

第三段内容。

\`\`\`js
const a = 1;
\`\`\`
`;

/** 在旧 source 的 pos 处插入 text，返回新 source 和 change。 */
function insert(pos: number, text: string) {
  return {
    source: DOC.slice(0, pos) + text + DOC.slice(pos),
    change: { fromA: pos, toA: pos, fromB: pos, toB: pos + text.length } as Change,
  };
}

function ids(ir: ReturnType<typeof parseMarkdown>["ir"]): string[] {
  const out: string[] = [];
  walkBlocks(ir.children, (b) => out.push(b.id));
  return out;
}

describe("块级复用正确性", () => {
  it("offset 反向映射：插入区返回 null，区外正确平移", () => {
    const c: Change = { fromA: 10, toA: 10, fromB: 10, toB: 15 };
    expect(unshiftOffset(5, [c])).toBe(5);
    expect(unshiftOffset(12, [c])).toBeNull(); // 插入区
    expect(unshiftOffset(20, [c])).toBe(15);
  });

  it("文档末尾插入：所有旧块复用，ID 与内容完全一致", () => {
    const first = parseMarkdown({ source: DOC });
    const { source, change } = insert(DOC.length, "\n新增段落。");
    const second = parseMarkdown({
      source,
      fragments: first.fragments,
      changes: [change],
      previous: first.ir,
    });

    // 新增了一个段落，但原有块应完整复用
    expect(second.ir.children).toHaveLength(first.ir.children.length + 1);
    expect(ids(second.ir).slice(0, first.ir.children.length)).toEqual(
      ids(first.ir),
    );
    expect(validateSpans(second.ir)).toEqual([]);
  });

  it("块间插入：后续块 span 平移但 ID 保持", () => {
    const first = parseMarkdown({ source: DOC });
    const at = DOC.indexOf("第二段内容");
    // 插到第二段前的空行处（第一段结束之后）
    const { source, change } = insert(at - 1, "插入的段落。\n\n");
    const second = parseMarkdown({
      source,
      fragments: first.fragments,
      changes: [change],
      previous: first.ir,
    });

    expect(validateSpans(second.ir)).toEqual([]);
    const secondOld = first.ir.children.find((b) => b.type === "paragraph" && b.span.start === at)!;
    const secondNew = second.ir.children.find(
      (b) => b.type === "paragraph" && source.slice(b.span.start, b.span.end).includes("第二段内容"),
    )!;
    expect(secondNew.id).toBe(secondOld.id);
    expect(secondNew.span.start).toBe(secondOld.span.start + change.toB - change.fromB);
  });

  it("块内修改：该块 ID 变化，其他块不受影响", () => {
    const first = parseMarkdown({ source: DOC });
    const at = DOC.indexOf("第二段") + 1;
    const newSource = DOC.slice(0, at) + "新" + DOC.slice(at + 1);
    const change: Change = { fromA: at, toA: at + 1, fromB: at, toB: at + 1 };
    const second = parseMarkdown({
      source: newSource,
      fragments: first.fragments,
      changes: [change],
      previous: first.ir,
    });

    const oldIds = ids(first.ir);
    const newIds = ids(second.ir);
    expect(newIds).toHaveLength(oldIds.length);
    // 只有第 2 个块（paragraph "新二段内容。"）的 ID 变了
    const changed = newIds.filter((id, i) => id !== oldIds[i]);
    expect(changed).toHaveLength(1);
    expect(validateSpans(second.ir)).toEqual([]);
  });

  it("多次连续编辑后 IR 仍与全量解析一致", () => {
    let state = parseMarkdown({ source: DOC });
    let source = DOC;

    for (const [pos, text] of [
      [DOC.indexOf("第一段") + 2, "修改一"],
      [DOC.indexOf("const") + 6, "X"],
      [DOC.length, "\n尾部。"],
    ] as const) {
      const newSource = source.slice(0, pos) + text + source.slice(pos + 1);
      state = parseMarkdown({
        source: newSource,
        fragments: state.fragments,
        changes: [{ fromA: pos, toA: pos + 1, fromB: pos, toB: pos + text.length }],
        previous: state.ir,
      });
      source = newSource;
    }

    const full = parseMarkdown({ source });
    expect(state.ir.children.map((b) => b.type)).toEqual(
      full.ir.children.map((b) => b.type),
    );
    // 每个块 slice 出的源文本必须一致（语义内容不丢失）
    for (let i = 0; i < state.ir.children.length; i++) {
      const a = state.ir.children[i];
      const b = full.ir.children[i];
      expect(source.slice(a.span.start, a.span.end)).toBe(
        source.slice(b.span.start, b.span.end),
      );
    }
    expect(validateSpans(state.ir)).toEqual([]);
  });
});

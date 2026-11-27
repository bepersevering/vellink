import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { parseMarkdown } from "../parser/markdown";
import { buildPMView } from "./mapping";
import { convertList, convertListCommand, enclosingList, listKind } from "./list-type";
import { vellinkSchema as S } from "./schema";

function listDoc(source: string) {
  const ir = parseMarkdown({ source }).ir;
  return buildPMView(ir).doc;
}

function withCaret(doc: ReturnType<typeof listDoc>, pos: number) {
  return EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
}

describe("列表类型识别", () => {
  it("区分无序 / 有序 / 任务", () => {
    expect(listKind(listDoc("- 甲\n- 乙\n").firstChild!)).toBe("bullet");
    expect(listKind(listDoc("1. 甲\n2. 乙\n").firstChild!)).toBe("ordered");
    expect(listKind(listDoc("- [x] 甲\n- [ ] 乙\n").firstChild!)).toBe("task");
  });

  it("光标在最外层列表内时找到它", () => {
    const doc = listDoc("- 甲\n- 乙\n");
    const found = enclosingList(doc, 3);
    expect(found).not.toBeNull();
    expect(found!.node.type).toBe(S.nodes.bulletList);
  });
});

describe("列表类型转换", () => {
  it("无序 → 有序保留内容", () => {
    const original = listDoc("- 甲\n- 乙\n").firstChild!;
    const converted = convertList(original, "ordered");
    expect(converted.type).toBe(S.nodes.orderedList);
    expect(converted.textContent).toBe(original.textContent);
  });

  it("无序 → 任务，默认未完成", () => {
    const original = listDoc("- 甲\n- 乙\n").firstChild!;
    const converted = convertList(original, "task");
    expect(listKind(converted)).toBe("task");
    const states: unknown[] = [];
    converted.forEach((item) => states.push(item.attrs.checked));
    expect(states).toEqual([false, false]);
  });

  it("任务 → 无序清掉 checked", () => {
    const original = listDoc("- [x] 甲\n- [ ] 乙\n").firstChild!;
    const converted = convertList(original, "bullet");
    converted.forEach((item) => expect(item.attrs.checked).toBeNull());
  });

  it("有序 → 无序丢弃 start（无序没有序号起点）", () => {
    const original = listDoc("3. 甲\n4. 乙\n").firstChild!;
    expect(original.attrs.start).toBe(3);
    expect(convertList(original, "bullet").type).toBe(S.nodes.bulletList);
  });

  it("命令在光标所在列表上生效，重复转换返回 false", () => {
    const doc = listDoc("- 甲\n- 乙\n");
    const state = withCaret(doc, 3);
    let result: unknown = null;
    const ok = convertListCommand("ordered")(state, (tr) => { result = tr; });
    expect(ok).toBe(true);
    expect(result).not.toBeNull();

    const done = state.apply(result as never);
    expect(convertListCommand("ordered")(done, () => {})).toBe(false);
  });
});

/**
 * ViewBridge 验收：UI 挂载前的双视图同步逻辑。
 * 不依赖 DOM，直接模拟 PM 事务与源码输入，验证源码、IR、光标三者始终一致。
 */
import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { parseMarkdown } from "../parser/markdown";
import { vellinkSchema } from "./schema";
import { ViewBridge } from "./sync";

const DOC = `# 标题

第一段 **粗体** 和 \`代码\`。

- 列表项
`;

function stateOf(bridge: ViewBridge): EditorState {
  return EditorState.create({ doc: bridge.doc, schema: vellinkSchema });
}

describe("ViewBridge · 双视图同步", () => {
  it("初始化：源码、IR、PM 文档同源，光标双向映射精确", () => {
    const bridge = new ViewBridge(DOC);
    expect(bridge.source).toBe(DOC);
    expect(bridge.ir.children[0].type).toBe("heading");
    expect(bridge.doc.textContent).toContain("粗体");

    const offset = DOC.indexOf("粗体");
    const pm = bridge.sourceToPM(offset);
    expect(pm).toBeGreaterThan(0);
    expect(bridge.pmToSource(pm)).toBe(offset);
  });

  it("PM 编辑：反向序列化写回源码，并重映射光标", () => {
    const bridge = new ViewBridge(DOC);
    const state = stateOf(bridge);
    const insertAt = DOC.indexOf("第一段") + 3;
    const pmPos = bridge.sourceToPM(insertAt);

    const tr = state.tr.insertText("新增", pmPos);
    tr.setSelection(TextSelection.create(tr.doc, pmPos + 2));
    const next = state.apply(tr);

    const snap = bridge.fromPM(next, true);
    expect(snap.source).toContain("第一段新增");
    expect(snap.source).not.toBe(DOC);
    expect(bridge.source).toBe(snap.source);
    expect(snap.cursor.source).toBe(snap.source.indexOf("新增") + 2);
    expect(bridge.pmToSource(snap.cursor.pm)).toBe(snap.cursor.source);
  });

  it("纯选区变化：不重写源码，只更新光标", () => {
    const bridge = new ViewBridge(DOC);
    const state = stateOf(bridge);
    const target = DOC.indexOf("列表项");
    const next = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, bridge.sourceToPM(target)),
      ),
    );

    const snap = bridge.fromPM(next, false);
    expect(snap.source).toBe(DOC);
    expect(snap.cursor.source).toBe(target);
  });

  it("源码编辑：重建 PM 文档与映射，光标落到正确 PM 位置", () => {
    const bridge = new ViewBridge(DOC);
    const nextSource = DOC.replace("第一段", "第一段扩展");
    const caret = nextSource.indexOf("扩展") + 2;

    const { doc, snapshot } = bridge.fromSource(nextSource, caret);
    expect(doc.textContent).toContain("第一段扩展");
    expect(snapshot.source).toBe(nextSource);
    expect(snapshot.cursor.source).toBe(caret);
    expect(bridge.pmToSource(snapshot.cursor.pm)).toBe(caret);
    expect(bridge.sourceToPM(caret)).toBe(snapshot.cursor.pm);
  });

  it("reset：撤销回灌旧 IR 后，PM 文档与映射同步回退", () => {
    const bridge = new ViewBridge(DOC);
    const edited = DOC.replace("第一段", "第一段扩展");
    bridge.fromSource(edited, edited.indexOf("扩展"));

    // 撤销栈回灌的是之前保存的 IR
    const oldIR = parseMarkdown({ source: DOC }).ir;
    bridge.reset(oldIR);

    expect(bridge.source).toBe(DOC);
    expect(bridge.doc.textContent).not.toContain("扩展");
    const offset = DOC.indexOf("粗体");
    expect(bridge.pmToSource(bridge.sourceToPM(offset))).toBe(offset);
  });

  it("源码 → PM → 源码：往返后语义内容不丢", () => {
    const bridge = new ViewBridge(DOC);
    const edited = DOC.replace("- 列表项", "- [x] 列表项");
    const { doc } = bridge.fromSource(edited, edited.length);
    const state = EditorState.create({ doc, schema: vellinkSchema });
    const snap = bridge.fromPM(state, true);

    expect(snap.source).toContain("- [x] 列表项");
    expect(snap.ir.children.some((b) => b.type === "list")).toBe(true);
  });
});

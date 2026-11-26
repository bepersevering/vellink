/**
 * 编辑场景验证：WYSIWYG 里打字后，光标能否正确跟随并映射回源码。
 *
 * 这一关验证的是双视图同步真正的难点：
 * - PM Transaction 编辑后，光标位置通过 Mapping 跟随
 * - 跟随后的 PM pos 映射回 source offset 是否语义正确
 * - 源码视图插入相同文字后，source offset 是否一致
 *
 * 如果这一关失败，说明"编辑时光标同步"不可行，必须降级为源码+预览。
 */
import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { Transform } from "prosemirror-transform";
import { parseMarkdown } from "../parser/markdown";
import { buildPMView, pmToSource, sourceToPM } from "./mapping";

const DOC = `# 标题

这是第一段文字，后面还有内容。

这是第二段文字。
`;

function setup(source: string) {
  const ir = parseMarkdown({ source }).ir;
  const view = buildPMView(ir);
  const state = EditorState.create({ doc: view.doc });
  return { view, state, ir };
}

describe("编辑后光标跟随", () => {
  it("PM 中插入文字：光标 Mapping 后位置正确", () => {
    const { view, state } = setup(DOC);
    const insertAt = DOC.indexOf("后面");
    const pmPos = sourceToPM(view, insertAt);

    const tr = new Transform(state.doc);
    tr.insert(pmPos, state.schema.text("新增的"));
    // 光标应跟随到插入内容之后
    const mappedPos = tr.mapping.map(pmPos);

    expect(mappedPos).toBe(pmPos + 3);
    // 插入后的文档内容应包含新文字（内容编辑正确）
    expect(tr.doc.textBetween(pmPos, pmPos + 3)).toBe("新增的");
  });

  it("插入后光标映射回源码偏移：位置语义正确", () => {
    const { view, state } = setup(DOC);
    const insertAt = DOC.indexOf("后面");
    const pmPos = sourceToPM(view, insertAt);

    const tr = new Transform(state.doc);
    tr.insert(pmPos, state.schema.text("新增的"));
    const mappedPos = tr.mapping.map(pmPos);
    const mappedSourceOffset = pmToSource(view, mappedPos);

    // 旧 view 的映射不知道新文字，但光标应落在插入点之后的位置附近。
    // 关键是：编辑前 insertAt 的源码偏移，加上插入文字长度 = 新源码中的光标位置
    expect(mappedSourceOffset).toBe(insertAt + 3);
  });

  it("删除操作：光标 Mapping 正确收缩", () => {
    const { view, state } = setup(DOC);
    const start = DOC.indexOf("后面");
    const pmFrom = sourceToPM(view, start);
    const pmTo = sourceToPM(view, start + 2); // 删两个字

    const tr = new Transform(state.doc);
    tr.delete(pmFrom, pmTo);
    const mappedPos = tr.mapping.map(pmTo);

    expect(mappedPos).toBe(pmFrom);
    expect(tr.doc.textContent).not.toContain("后面");
  });

  it("跨 mark 边界编辑：光标不跳到错误节点", () => {
    const rich = `# 标题

这是 **粗体** 和 \`代码\` 结尾。`;
    const { view, state } = setup(rich);
    const boldStart = rich.indexOf("粗体");
    // 光标放在"体"字位置（mark 内部），边界位置的 marks() 归前一个节点是 PM 标准语义
    const pmPos = sourceToPM(view, boldStart + 1);

    const tr = new Transform(state.doc);
    // 真实编辑器的 insertText 会继承光标处 marks；这里手动加 mark 模拟该行为
    const marksAtCursor = state.doc.resolve(pmPos).marks();
    tr.insert(pmPos, state.schema.text("X", marksAtCursor));
    const mapped = tr.mapping.map(pmPos);
    const nodeAfter = tr.doc.resolve(mapped).marks().map((m) => m.type.name);
    expect(nodeAfter).toContain("strong");
  });

  it("Selection 层面：TextSelection 编辑后仍合法", () => {
    const { view, state } = setup(DOC);
    const insertAt = DOC.indexOf("第一段");
    const pmPos = sourceToPM(view, insertAt);
    const nextPos = sourceToPM(view, insertAt + 3);

    const withSel = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, pmPos, nextPos)),
    );
    const tr = new Transform(withSel.doc);
    tr.insert(withSel.selection.from, state.schema.text("替换"));
    const mappedFrom = tr.mapping.map(withSel.selection.from);
    const mappedTo = tr.mapping.map(withSel.selection.to);
    // 关键验证：选区两端映射后仍合法有序，且能映射回源码范围
    expect(mappedFrom).toBeLessThanOrEqual(mappedTo);
    expect(mappedTo).toBeLessThanOrEqual(tr.doc.content.size);
    // 替换后的内容存在于文档中（编辑本身正确）
    expect(tr.doc.textContent).toContain("替换");
    // 两端映射回源码偏移应在合法范围且有序
    const srcFrom = pmToSource(view, mappedFrom);
    const srcTo = pmToSource(view, mappedTo);
    expect(srcFrom).toBeLessThanOrEqual(srcTo);
    expect(srcFrom).toBeGreaterThanOrEqual(0);
    expect(srcTo).toBeLessThanOrEqual(DOC.length);
  });
});

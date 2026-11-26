/**
 * 光标同步可行性核心验证：source offset ↔ PM pos 往返一致性。
 *
 * 判定标准：
 * - 可见文本区（锚点覆盖的字符）：往返必须 100% 精确
 * - 标记字符区（#、**、反引号等）：允许吸附，但吸附必须稳定（往返两次结果相同）
 * - 任一可见字符往返出错 → 双视图同步不可用，按预案砍 WYSIWYG
 */
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../parser/markdown";
import {
  buildPMView,
  pmToSource,
  sourceToPM,
  validateAnchors,
  type PMView,
} from "./mapping";

const DOC = `# 标题一

这是第一段，包含 **粗体**、*斜体*、\`行内代码\`、[链接](https://example.com) 和 [[双链]]。

## 标题二

- 列表项一
- [x] 已完成任务

> 引用块

\`\`\`ts
const x = 1;
\`\`\`

| A | B |
|---|---|
| 1 | 2 |
`;

/** 锚点覆盖的源码字符集合（可见文本区）。 */
function visibleOffsets(view: PMView): Set<number> {
  const set = new Set<number>();
  for (const a of view.anchors)
    for (let i = a.sourceFrom; i < a.sourceFrom + a.length; i++) set.add(i);
  return set;
}

describe("光标往返一致性", () => {
  const ir = parseMarkdown({ source: DOC }).ir;
  const view = buildPMView(ir);

  it("文本锚点与源文本逐字对应", () => {
    const errors = validateAnchors(view, DOC);
    if (errors.length) console.log("锚点错误:\n" + errors.slice(0, 20).join("\n"));
    expect(errors).toEqual([]);
  });

  it("可见文本区：每个字符 offset → pmPos → offset 精确往返", () => {
    const visible = visibleOffsets(view);
    const errors: string[] = [];
    for (const offset of visible) {
      const pm = sourceToPM(view, offset);
      const back = pmToSource(view, pm);
      if (back !== offset) {
        errors.push(
          `offset ${offset} (${JSON.stringify(DOC[offset])}) → pm ${pm} → ${back}`,
        );
      }
    }
    if (errors.length)
      console.log(`往返失败 ${errors.length}/${visible.size}:\n` + errors.slice(0, 20).join("\n"));
    expect(errors).toEqual([]);
    console.log(`可见文本字符 ${visible.size} 个，全部精确往返 ✓`);
  });

  it("标记字符区：吸附结果稳定（往返两次不变）", () => {
    const visible = visibleOffsets(view);
    const unstable: string[] = [];
    for (let offset = 0; offset < DOC.length; offset++) {
      if (visible.has(offset)) continue;
      const pm1 = sourceToPM(view, offset);
      const back = pmToSource(view, pm1);
      const pm2 = sourceToPM(view, back);
      if (pm1 !== pm2) unstable.push(`offset ${offset}: pm ${pm1} → src ${back} → pm ${pm2}`);
    }
    if (unstable.length)
      console.log(`吸附不稳定 ${unstable.length} 处:\n` + unstable.slice(0, 20).join("\n"));
    expect(unstable).toEqual([]);
  });

  it("行内标记边界：粗体/斜体/代码/链接内部光标不跳位", () => {
    const probes = ["粗体", "斜体", "行内代码", "链接", "双链", "标题一", "const x"];
    for (const word of probes) {
      const start = DOC.indexOf(word);
      expect(start).toBeGreaterThanOrEqual(0);
      for (let i = 0; i < word.length; i++) {
        const offset = start + i;
        const pm = sourceToPM(view, offset);
        expect(pmToSource(view, pm)).toBe(offset);
      }
    }
  });

  it("块边界：各块首字符光标精确，标记字符稳定吸附", () => {
    // 块首的可见文本字符必须精确往返
    const visibleFirst = [
      DOC.indexOf("标题一"),
      DOC.indexOf("标题二"),
      DOC.indexOf("列表项一"),
      DOC.indexOf("引用块"),
      DOC.indexOf("const x"),
      DOC.indexOf("| A | B") + 2, // 表格首单元格的 A
    ];
    for (const offset of visibleFirst) {
      expect(offset).toBeGreaterThanOrEqual(0);
      const pm = sourceToPM(view, offset);
      expect(pm).toBeGreaterThanOrEqual(1);
      expect(pm).toBeLessThanOrEqual(view.doc.content.size);
      expect(pmToSource(view, pm)).toBe(offset);
    }

    // 标记字符（如 ##、-、>）没有对应 PM 光标位，只要求吸附后落在合法范围
    for (const marker of [DOC.indexOf("## 标题二"), DOC.indexOf("- 列表"), DOC.indexOf("> 引用")]) {
      const pm = sourceToPM(view, marker);
      expect(pm).toBeGreaterThanOrEqual(1);
      expect(pm).toBeLessThanOrEqual(view.doc.content.size);
    }
  });

  it("PM 端所有文本位置都能映射回合法 source 范围", () => {
    for (let pos = 1; pos <= view.doc.content.size; pos++) {
      const src = pmToSource(view, pos);
      expect(src).toBeGreaterThanOrEqual(0);
      expect(src).toBeLessThanOrEqual(DOC.length);
    }
  });
});

/**
 * WYSIWYG 里的 Mermaid 渲染。
 *
 * mermaid 包只在遇到图表时才动态 import（主包不被拖大），渲染结果塞进
 * PM 的 atom 占位 div —— PM 不管理 atom 内部 DOM，所以不会被 DOMObserver
 * 当成外部改动。渲染过的节点靠 data-mermaid-state 跳过，幂等。
 */

const PENDING = "pending";
const READY = "ready";
const FAILED = "failed";

let rendering = false;

/** 在容器里渲染所有未处理的 mermaid 占位节点。 */
export async function renderMermaid(host: HTMLElement): Promise<void> {
  if (rendering) return;
  const nodes = Array.from(
    host.querySelectorAll<HTMLElement>(`div[data-mermaid][data-mermaid-state="${PENDING}"]`),
  );
  if (!nodes.length) return;
  rendering = true;
  try {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "neutral",
      fontFamily: "var(--font-ui)",
    });
    let index = 0;
    for (const el of nodes) {
      const code = el.getAttribute("data-mermaid") ?? "";
      el.setAttribute("data-mermaid-state", "ready");
      index += 1;
      try {
        const { svg } = await mermaid.render(`vellink-mermaid-${Date.now()}-${index}`, code);
        el.innerHTML = svg;
        el.setAttribute("data-mermaid-state", READY);
      } catch (error) {
        el.textContent = `图表语法错误：${error instanceof Error ? error.message : String(error)}`;
        el.classList.add("mermaid-error");
        el.setAttribute("data-mermaid-state", FAILED);
      }
    }
  } catch {
    // mermaid 加载失败：降级为源码文本，不阻塞写作
    for (const el of nodes) {
      el.textContent = el.getAttribute("data-mermaid") ?? "";
      el.setAttribute("data-mermaid-state", FAILED);
    }
  } finally {
    rendering = false;
  }
}

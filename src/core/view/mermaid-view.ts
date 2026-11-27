/**
 * Mermaid rendering in the WYSIWYG view.
 *
 * The mermaid package is imported dynamically only when a diagram is encountered (so the main
 * bundle stays small); the result is inserted into a PM atom placeholder div — PM doesn't manage
 * DOM inside atoms, so DOMObserver won't treat it as an external change. Rendered nodes are
 * skipped via data-mermaid-state, making this idempotent.
 */

const PENDING = "pending";
const READY = "ready";
const FAILED = "failed";

let rendering = false;

/** Render all unprocessed Mermaid placeholders in a container. */
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
        el.textContent = `Diagram syntax error: ${error instanceof Error ? error.message : String(error)}`;
        el.classList.add("mermaid-error");
        el.setAttribute("data-mermaid-state", FAILED);
      }
    }
  } catch {
    // Failed to load mermaid: fall back to source text, never block writing
    for (const el of nodes) {
      el.textContent = el.getAttribute("data-mermaid") ?? "";
      el.setAttribute("data-mermaid-state", FAILED);
    }
  } finally {
    rendering = false;
  }
}

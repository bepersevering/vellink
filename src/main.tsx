import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { isDesktop } from "./core/desktop/bridge";
// KaTeX's htmlAndMathml output relies on its CSS to hide the MathML layer (for screen readers only);
// without it, the HTML layer and the MathML annotation stack up and render the formula twice.
import "katex/dist/katex.min.css";
import "./styles.css";

/**
 * On desktop the window controls are provided by the OS, so the app shouldn't draw a second set.
 *
 * Set the flag before the first frame so CSS can hide our own three dots in one pass;
 * adding it inside a component would flash one frame with "two sets of buttons".
 *
 * Two cases: mac / other. macOS uses an overlay title bar, with the native buttons sitting
 * over the left of the app title bar, so reserve the same amount of space; on Windows / Linux
 * the buttons are on the right, so leave no space on the left.
 */
if (isDesktop()) {
  document.body.dataset.desktop = /Mac/i.test(navigator.userAgent) ? "mac" : "other";
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

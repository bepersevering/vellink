import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { isDesktop } from "./core/desktop/bridge";
// KaTeX 的 htmlAndMathml 输出靠它的 CSS 把 MathML 层藏起来（只给读屏器），
// 不引入的话屏幕会把 HTML 层和 MathML 注解叠在一起显示成两遍公式。
import "katex/dist/katex.min.css";
import "./styles.css";

/**
 * 桌面端的窗口按钮由系统提供，应用不该再画一份。
 *
 * 在首帧之前打标记，CSS 才能一次性隐藏自己画的那三个点；
 * 放到组件里加就会先闪一帧「两套按钮」。
 *
 * 分 mac / other 两种：macOS 用 overlay 标题栏，原生按钮压在应用标题栏左侧，
 * 需要留出同样的空档；Windows / Linux 的按钮在右边，左侧干脆不留空。
 */
if (isDesktop()) {
  document.body.dataset.desktop = /Mac/i.test(navigator.userAgent) ? "mac" : "other";
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

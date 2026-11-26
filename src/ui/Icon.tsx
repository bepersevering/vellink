/**
 * 图标集：从 ui-prototype.html 的 SVG sprite 完整移植。
 * 用 <use href="#i-xxx"> 引用，symbol 定义在 IconSprite 里，App 挂载一次即可。
 */
export type IconName =
  | "cmd"
  | "left"
  | "right"
  | "moon"
  | "sun"
  | "set"
  | "plus"
  | "folder"
  | "file"
  | "ai"
  | "chart"
  | "search"
  | "edit"
  | "cloud"
  | "plug"
  | "check"
  | "code"
  | "eye"
  | "chevron"
  | "close"
  | "lang"
  | "external"
  | "down";

export function Icon({
  name,
  className,
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

/** 在应用根节点挂载一次，提供所有 symbol 定义。 */
export function IconSprite() {
  return (
    <svg style={{ display: "none" }} aria-hidden="true">
      <symbol id="i-cmd" viewBox="0 0 24 24">
        <path d="M18 6a3 3 0 1 0-3 3h6M6 6a3 3 0 1 1 3 3H3M18 18a3 3 0 1 1-3-3h6M6 18a3 3 0 1 0 3-3H3M9 9h6v6H9z" />
      </symbol>
      <symbol id="i-left" viewBox="0 0 24 24">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 3v18" />
      </symbol>
      <symbol id="i-right" viewBox="0 0 24 24">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M15 3v18" />
      </symbol>
      <symbol id="i-moon" viewBox="0 0 24 24">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </symbol>
      <symbol id="i-sun" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </symbol>
      <symbol id="i-set" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.01A1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </symbol>
      <symbol id="i-plus" viewBox="0 0 24 24">
        <path d="M12 5v14M5 12h14" />
      </symbol>
      <symbol id="i-folder" viewBox="0 0 24 24">
        <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
      </symbol>
      <symbol id="i-file" viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </symbol>
      <symbol id="i-ai" viewBox="0 0 24 24">
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
        <path d="M19 17l.6 1.4L21 19l-1.4.6L19 21l-.6-1.4L17 19l1.4-.6L19 17z" />
      </symbol>
      <symbol id="i-chart" viewBox="0 0 24 24">
        <circle cx="5" cy="6" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="12" cy="18" r="2" />
        <path d="M6.8 7.3 10.5 16M17.2 7.3 13.5 16M7 6h9" />
      </symbol>
      <symbol id="i-search" viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </symbol>
      <symbol id="i-edit" viewBox="0 0 24 24">
        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </symbol>
      <symbol id="i-cloud" viewBox="0 0 24 24">
        <path d="M17.5 19a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6-1.7A4 4 0 0 0 6.5 19z" />
      </symbol>
      <symbol id="i-plug" viewBox="0 0 24 24">
        <rect x="4" y="4" width="6" height="6" rx="1" />
        <rect x="14" y="4" width="6" height="6" rx="1" />
        <rect x="4" y="14" width="6" height="6" rx="1" />
        <rect x="14" y="14" width="6" height="6" rx="1" />
      </symbol>
      <symbol id="i-check" viewBox="0 0 24 24">
        <path d="m5 12 5 5L20 7" />
      </symbol>
      <symbol id="i-code" viewBox="0 0 24 24">
        <path d="m8 8-4 4 4 4M16 8l4 4-4 4" />
      </symbol>
      <symbol id="i-eye" viewBox="0 0 24 24">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
        <circle cx="12" cy="12" r="3" />
      </symbol>
      <symbol id="i-chevron" viewBox="0 0 24 24">
        <path d="m9 18 6-6-6-6" />
      </symbol>
      <symbol id="i-close" viewBox="0 0 24 24">
        <path d="M6 6l12 12M18 6L6 18" />
      </symbol>
      <symbol id="i-lang" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
      </symbol>
      <symbol id="i-external" viewBox="0 0 24 24">
        <path d="M14 3h7v7M21 3l-9 9" />
        <path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
      </symbol>
      <symbol id="i-down" viewBox="0 0 24 24">
        <path d="M12 3v11M7 10l5 5 5-5M4 20h16" />
      </symbol>
    </svg>
  );
}

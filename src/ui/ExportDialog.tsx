/**
 * 导出面板。
 *
 * 只负责「选格式 + 选范围」，实际产出在 `core/export`：
 * UI 不碰文件系统、不拼 HTML，这样格式增多时这里不用改。
 */
import { useEffect, useRef, useState } from "react";
import type { ExportFormat } from "../core/export";
import { t } from "../i18n";
import { Icon } from "./Icon";

export type ExportScope = "all" | "selection";

const FORMAT_STORAGE_KEY = "vellink-export-format";

const FORMATS: ReadonlyArray<{
  id: ExportFormat;
  label: string;
  hint: string;
}> = [
  { id: "markdown", label: "export.format.markdown", hint: "export.format.markdownHint" },
  { id: "html", label: "export.format.html", hint: "export.format.htmlHint" },
  { id: "pdf", label: "export.format.pdf", hint: "export.format.pdfHint" },
  { id: "docx", label: "export.format.docx", hint: "export.format.docxHint" },
  { id: "epub", label: "export.format.epub", hint: "export.format.epubHint" },
  { id: "odt", label: "export.format.odt", hint: "export.format.odtHint" },
];

function initialFormat(): ExportFormat {
  try {
    const saved = localStorage.getItem(FORMAT_STORAGE_KEY);
    if (saved === "markdown" || saved === "html" || saved === "pdf" || saved === "docx" || saved === "epub" || saved === "odt") return saved;
  } catch {
    /* 隐私模式下 localStorage 可能不可用 */
  }
  return "html";
}

interface Props {
  open: boolean;
  /** 当前文档标题，用作文件名预览。 */
  title: string;
  /** 选区（源码偏移）；没有选区时「选中」不可选。 */
  selection: { from: number; to: number } | null;
  /** 导出进行中：按钮禁用，避免连点开两个保存对话框。 */
  busy: boolean;
  onClose: () => void;
  onExport: (format: ExportFormat, scope: ExportScope) => void;
}

export function ExportDialog({
  open,
  title,
  selection,
  busy,
  onClose,
  onExport,
}: Props) {
  const [format, setFormat] = useState<ExportFormat>(initialFormat);
  const [scope, setScope] = useState<ExportScope>("all");
  const dialogRef = useRef<HTMLDivElement>(null);

  const hasSelection = Boolean(selection && selection.to > selection.from);
  const selectedChars = hasSelection ? (selection?.to ?? 0) - (selection?.from ?? 0) : 0;

  // 每次打开都回到「整篇」：上一次选了半段就导半段，是最糟的默认值
  useEffect(() => {
    if (!open) return;
    setScope("all");
    setFormat(initialFormat());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const pick = (next: ExportFormat) => {
    setFormat(next);
    try {
      localStorage.setItem(FORMAT_STORAGE_KEY, next);
    } catch {
      /* 存不下就只记在内存里 */
    }
  };

  return (
    <div className="export-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("export.title")}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="export-head">
          <div className="export-heading">
            <strong>{t("export.title")}</strong>
            <span className="export-sub">{title || t("doc.untitled")}</span>
          </div>
          <button
            className="export-close"
            onClick={onClose}
            aria-label={t("export.cancel")}
            title={t("export.cancel")}
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="export-formats" role="radiogroup" aria-label={t("export.formatLabel")}>
          {FORMATS.map((item) => (
            <button
              key={item.id}
              role="radio"
              aria-checked={format === item.id}
              className={`export-format ${format === item.id ? "on" : ""}`}
              onClick={() => pick(item.id)}
            >
              <span className="export-format-name">{t(item.label)}</span>
              <span className="export-format-hint">{t(item.hint)}</span>
            </button>
          ))}
        </div>

        <div className="export-scope" role="radiogroup" aria-label={t("export.scopeLabel")}>
          <button
            role="radio"
            aria-checked={scope === "all"}
            className={`export-scope-btn ${scope === "all" ? "on" : ""}`}
            onClick={() => setScope("all")}
          >
            {t("export.scope.all")}
          </button>
          <button
            role="radio"
            aria-checked={scope === "selection"}
            className={`export-scope-btn ${scope === "selection" ? "on" : ""}`}
            onClick={() => setScope("selection")}
            disabled={!hasSelection}
            title={hasSelection ? undefined : t("export.scope.none")}
          >
            {hasSelection
              ? t("export.scope.selection", { count: selectedChars })
              : t("export.scope.none")}
          </button>
        </div>

        <p className="export-note">
          {format === "pdf" ? t("export.note.pdf") : t("export.note.save")}
        </p>

        <footer className="export-actions">
          <button className="service-btn" onClick={onClose}>
            {t("export.cancel")}
          </button>
          <button
            className="service-btn primary"
            onClick={() => onExport(format, scope)}
            disabled={busy}
          >
            {busy ? t("export.busy") : t("export.confirm")}
          </button>
        </footer>
      </div>
    </div>
  );
}

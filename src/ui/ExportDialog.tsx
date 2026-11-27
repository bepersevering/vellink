/**
 * Export dialog.
 *
 * Only handles "pick a format + pick a scope"; actual output lives in `core/export`:
 * the UI never touches the filesystem or builds HTML, so new formats don't require changes here.
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
  group: "exchange" | "publish" | "archive";
}> = [
  { id: "markdown", label: "export.format.markdown", hint: "export.format.markdownHint", group: "exchange" },
  { id: "html", label: "export.format.html", hint: "export.format.htmlHint", group: "publish" },
  { id: "pdf", label: "export.format.pdf", hint: "export.format.pdfHint", group: "publish" },
  { id: "docx", label: "export.format.docx", hint: "export.format.docxHint", group: "exchange" },
  { id: "epub", label: "export.format.epub", hint: "export.format.epubHint", group: "publish" },
  { id: "odt", label: "export.format.odt", hint: "export.format.odtHint", group: "exchange" },
  { id: "latex", label: "export.format.latex", hint: "export.format.latexHint", group: "archive" },
  { id: "mediawiki", label: "export.format.mediawiki", hint: "export.format.mediawikiHint", group: "archive" },
];

function initialFormat(): ExportFormat {
  try {
    const saved = localStorage.getItem(FORMAT_STORAGE_KEY);
    if (saved === "markdown" || saved === "html" || saved === "pdf" || saved === "docx" || saved === "epub" || saved === "odt" || saved === "latex" || saved === "mediawiki") return saved;
  } catch {
    /* localStorage may be unavailable in private mode */
  }
  return "html";
}

interface Props {
  open: boolean;
  /** Current document title, used as a filename preview. */
  title: string;
  /** Selection (source offsets); "Selection" is disabled when there is none. */
  selection: { from: number; to: number } | null;
  /** Export in progress: disable the button to avoid opening two save dialogs with double clicks. */
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

  // Always reset to "whole document" on open: defaulting to the last partial selection is the worst choice
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
      /* If it can't be saved, keep it in memory only */
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
          {(["exchange", "publish", "archive"] as const).map((group) => (
            <div className="export-format-group" key={group}>
              <div className="export-group-label">{t(`export.group.${group}`)}</div>
              <div className="export-group-grid">
                {FORMATS.filter((item) => item.group === group).map((item) => (
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
            </div>
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

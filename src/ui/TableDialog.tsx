/** 快速插入表格：选行列数，生成 Markdown 表格骨架。 */
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { MAX_TABLE_COLS, MAX_TABLE_ROWS } from "../core/table-insert";
import { Icon } from "./Icon";

interface Props {
  open: boolean;
  onClose: () => void;
  onInsert: (rows: number, cols: number) => void;
}

export function TableDialog({ open, onClose, onInsert }: Props) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setRows(3);
    setCols(3);
    window.setTimeout(() => firstRef.current?.focus(), 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const clamp = (value: number, max: number) =>
    Number.isFinite(value) ? Math.max(1, Math.min(max, Math.floor(value))) : 1;

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="export-dialog table-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("table.title")}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="export-head">
          <span className="export-title">
            <Icon name="chart" /> {t("table.title")}
          </span>
          <button className="icon-btn" onClick={onClose} aria-label={t("table.close")}>
            <Icon name="close" />
          </button>
        </div>
        <div className="table-fields">
          <label>
            <span>{t("table.rows")}</span>
            <input
              ref={firstRef}
              type="number"
              min={1}
              max={MAX_TABLE_ROWS}
              value={rows}
              onChange={(e) => setRows(clamp(Number(e.target.value), MAX_TABLE_ROWS))}
            />
          </label>
          <label>
            <span>{t("table.cols")}</span>
            <input
              type="number"
              min={1}
              max={MAX_TABLE_COLS}
              value={cols}
              onChange={(e) => setCols(clamp(Number(e.target.value), MAX_TABLE_COLS))}
            />
          </label>
        </div>
        <p className="export-note">{t("table.note")}</p>
        <footer className="export-actions">
          <button className="service-btn" onClick={onClose}>
            {t("table.cancel")}
          </button>
          <button className="service-btn primary" onClick={() => onInsert(rows, cols)}>
            {t("table.insert")}
          </button>
        </footer>
      </div>
    </div>
  );
}

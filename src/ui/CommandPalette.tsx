import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";
import { t } from "../i18n";
import type { CommandItem } from "./data";

/** 解析 i18n key；不是 key（如插件命令的真实标题）原样返回。 */
const tr = (value: string) =>
  value.includes(".") && !value.includes(" ") ? t(value) : value;

interface Props {
  open: boolean;
  commands: CommandItem[];
  onClose: () => void;
  onRun: (cmd: CommandItem) => void;
  /** 全库搜索：给定查询返回笔记命中，排在命令前面。 */
  searchNotes?: (query: string) => CommandItem[];
}

/** 单字只对中文放行：英文单字母会把半本文档都搜出来。 */
function worthSearching(query: string): boolean {
  const q = query.trim();
  if (q.length >= 2) return true;
  return q.length === 1 && /[\u3400-\u9fff]/.test(q);
}

export function CommandPalette({ open, commands, onClose, onRun, searchNotes }: Props) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const notes = useMemo(() => {
    if (!searchNotes || !worthSearching(query)) return [];
    return searchNotes(query);
  }, [query, searchNotes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? commands.filter(
          (c) =>
            tr(c.label).toLowerCase().includes(q) ||
            tr(c.group).toLowerCase().includes(q),
        )
      : commands;
    // 笔记命中在前：搜索时通常先想找内容，再找命令
    return q ? [...notes, ...matched] : matched;
  }, [commands, notes, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      // 等 DOM 出现再聚焦
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setSel(0), [query]);

  if (!open) return null;

  const run = (cmd: CommandItem | undefined) => {
    if (!cmd) return;
    onRun(cmd);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(filtered[sel]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  let lastGroup = "";

  return (
    <div className="palette-back on" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" onKeyDown={onKeyDown}>
        <div className="palette-in">
          <Icon name="search" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.search")}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-list">
          {filtered.length === 0 && (
            <div className="palette-group">{t("palette.noMatch")}</div>
          )}
          {filtered.map((c, i) => {
            const group = tr(c.group);
            const showGroup = group !== lastGroup;
            lastGroup = group;
            return (
              <div key={c.id}>
                {showGroup && <div className="palette-group">{group}</div>}
                <div
                  className={`palette-item ${i === sel ? "sel" : ""}`}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => run(c)}
                >
                  <Icon name={c.icon as IconName} />
                  {tr(c.label)}
                  {c.hint && <span className="right">{c.hint.includes(".") ? tr(c.hint) : c.hint}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

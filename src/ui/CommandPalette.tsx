import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";
import type { CommandItem } from "./data";

interface Props {
  open: boolean;
  commands: CommandItem[];
  onClose: () => void;
  onRun: (cmd: CommandItem) => void;
}

export function CommandPalette({ open, commands, onClose, onRun }: Props) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q),
    );
  }, [commands, query]);

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
            placeholder="输入命令、文件名，或搜索笔记…"
            aria-label="命令搜索"
          />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-list">
          {filtered.length === 0 && (
            <div className="palette-group">没有匹配的命令</div>
          )}
          {filtered.map((c, i) => {
            const showGroup = c.group !== lastGroup;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {showGroup && <div className="palette-group">{c.group}</div>}
                <div
                  className={`palette-item ${i === sel ? "sel" : ""}`}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => run(c)}
                >
                  <Icon name={c.icon as IconName} />
                  {c.label}
                  {c.hint && <span className="right">{c.hint}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

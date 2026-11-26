import { useState } from "react";
import { Icon } from "./Icon";
import { t } from "../i18n";
import type { TreeItem } from "./data";

interface Props {
  items: TreeItem[];
  activeId: string;
  collapsed: boolean;
  onSelect: (item: TreeItem) => void;
}

export function FileDrawer({ items, activeId, collapsed, onSelect }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(
        items.filter((i) => i.kind === "folder").map((i) => [i.id, !!i.expanded]),
      ),
  );

  return (
    <aside
      className={`drawer left ${collapsed ? "closed" : ""}`}
      aria-label={t("drawer.fileTree")}
      aria-hidden={collapsed}
    >
      <div className="drawer-head">
        <span className="drawer-title">{t("drawer.files")}</span>
        <button className="icon-btn" title={t("drawer.newDoc")} aria-label={t("drawer.newDoc")}>
          <Icon name="plus" />
        </button>
      </div>
      <div className="tree">
        {items.map((item) => {
          const isOpen = expanded[item.id] ?? false;
          return (
            <div
              key={item.id}
              className={`tree-row ${item.indent ? `indent-${item.indent}` : ""} ${
                activeId === item.id ? "active" : ""
              }`}
              onClick={() => {
                if (item.kind === "folder")
                  setExpanded((s) => ({ ...s, [item.id]: !isOpen }));
                else onSelect(item);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (item.kind === "folder")
                    setExpanded((s) => ({ ...s, [item.id]: !isOpen }));
                  else onSelect(item);
                }
              }}
            >
              {item.kind === "folder" ? (
                <>
                  <span className="chev">{isOpen ? "▾" : "▸"}</span>
                  <Icon name="folder" className="folder" />
                </>
              ) : (
                <span className="filedot" />
              )}
              <span className="tree-label">{item.label}</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

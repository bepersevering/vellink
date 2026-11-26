import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { t } from "../i18n";

export interface FileItem {
  id: string;
  title: string;
  dirty: boolean;
}

interface Props {
  docs: FileItem[];
  activeId: string | null;
  collapsed: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

/**
 * 左抽屉：真实文档列表。
 *
 * 删除做二次确认（第一次点击变成红色对勾，3 秒内再点才真删），
 * 避免误触把唯一一份没同步的稿子删掉。
 */
export function FileDrawer({
  docs,
  activeId,
  collapsed,
  onSelect,
  onNew,
  onDelete,
}: Props) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!pendingDelete) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setPendingDelete(null), 3000);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [pendingDelete]);

  const requestDelete = (id: string) => {
    if (pendingDelete === id) {
      setPendingDelete(null);
      onDelete(id);
      return;
    }
    setPendingDelete(id);
  };

  return (
    <aside
      className={`drawer left ${collapsed ? "closed" : ""}`}
      aria-label={t("drawer.fileTree")}
      aria-hidden={collapsed}
    >
      <div className="drawer-head">
        <span className="drawer-title">{t("drawer.files")}</span>
        <button
          className="icon-btn"
          title={t("drawer.newDoc")}
          aria-label={t("drawer.newDoc")}
          onClick={onNew}
        >
          <Icon name="plus" />
        </button>
      </div>
      <div className="tree">
        {docs.map((doc) => {
          const active = doc.id === activeId;
          const pending = pendingDelete === doc.id;
          return (
            <div
              key={doc.id}
              className={`tree-row ${active ? "active" : ""} ${pending ? "pending" : ""}`}
              onClick={() => onSelect(doc.id)}
              role="button"
              tabIndex={0}
              aria-current={active}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(doc.id);
                }
              }}
            >
              <span className="filedot" />
              <span className="tree-label" title={doc.title}>
                {doc.title}
              </span>
              {doc.dirty && <span className="dirty-dot" title={t("drawer.unsaved")} />}
              <button
                className={`doc-del ${pending ? "confirm" : ""}`}
                title={pending ? t("drawer.confirmDelete") : t("drawer.deleteDoc", { name: doc.title })}
                aria-label={pending ? t("drawer.confirmDelete") : t("drawer.deleteDoc", { name: doc.title })}
                onClick={(e) => {
                  e.stopPropagation();
                  requestDelete(doc.id);
                }}
              >
                <Icon name={pending ? "check" : "close"} />
              </button>
            </div>
          );
        })}
        {docs.length === 0 && <div className="tree-empty">{t("drawer.empty")}</div>}
      </div>
    </aside>
  );
}

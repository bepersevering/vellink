import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { t } from "../i18n";

export interface FileItem {
  id: string;
  /** 稳定标识：改名后 id（路径）会变，uid 不变，用它做 React key。 */
  uid: string;
  title: string;
  dirty: boolean;
  /** 磁盘上的文件名（文件后端才有）：改标题会跟着重命名，摆在 tooltip 里可核对。 */
  fileName?: string;
}

interface Props {
  docs: FileItem[];
  activeId: string | null;
  collapsed: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onImport: () => void;
  onDelete: (id: string) => void | Promise<void>;
  /** 桌面端的工作区目录；浏览器版为 null（不显示目录条）。 */
  workspaceDir?: string | null;
  onOpenFolder?: () => void;
  onRevealFolder?: () => void;
}

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * 左抽屉：真实文档列表。
 *
 * 删除做二次确认（第一次点击变成红色对勾，3 秒内再点才真删），
 * 避免误触把唯一一份没同步的稿子删掉。
 *
 * 桌面端多一条目录栏：点目录名换工作区，右侧按钮在文件管理器里定位，
 * 让「文档到底存在哪」这件事始终可见。
 */
export function FileDrawer({
  docs,
  activeId,
  collapsed,
  onSelect,
  onNew,
  onImport,
  onDelete,
  workspaceDir = null,
  onOpenFolder,
  onRevealFolder,
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
          title={t("drawer.importDocs")}
          aria-label={t("drawer.importDocs")}
          onClick={onImport}
        >
          <Icon name="up" />
        </button>
        <button
          className="icon-btn"
          title={t("drawer.newDoc")}
          aria-label={t("drawer.newDoc")}
          onClick={onNew}
        >
          <Icon name="plus" />
        </button>
      </div>
      {workspaceDir && (
        <div className="workspace-bar">
          <button
            className="workspace-path"
            title={`${t("drawer.openFolder")}\n${workspaceDir}`}
            onClick={onOpenFolder}
          >
            <Icon name="folder" />
            <span className="workspace-name">{folderName(workspaceDir)}</span>
          </button>
          <button
            className="icon-btn"
            title={t("drawer.revealFolder")}
            aria-label={t("drawer.revealFolder")}
            onClick={onRevealFolder}
          >
            <Icon name="external" />
          </button>
        </div>
      )}
      <div className="tree">
        {docs.map((doc) => {
          const active = doc.id === activeId;
          const pending = pendingDelete === doc.id;
          return (
            <div
              key={doc.uid || doc.id}
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
              <span
                className="tree-label"
                title={doc.fileName ? `${doc.title}\n${doc.fileName}` : doc.title}
              >
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

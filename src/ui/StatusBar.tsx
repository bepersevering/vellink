import { Icon } from "./Icon";
import type { DocStats } from "./Editor";

interface Props {
  pluginCount: number;
  stats: DocStats;
}

export function StatusBar({ pluginCount, stats }: Props) {
  return (
    <footer className="statusbar">
      <div className="status-i">
        <Icon name="check" />已保存
      </div>
      <div className="status-i sync">
        <Icon name="cloud" />WebDAV 已同步
      </div>
      <div className="sp" />
      <div>
        第 {stats.line} 行 · 共 {stats.chars.toLocaleString("zh-CN")} 字
      </div>
      <div title={`PM pos ${stats.pm} ↔ 源码 offset ${stats.source}`}>
        UTF-8　Markdown　PM {stats.pm} ⇄ src {stats.source}
      </div>
      <div className="status-i">
        <Icon name="plug" />
        {pluginCount} 个插件已启用
      </div>
    </footer>
  );
}

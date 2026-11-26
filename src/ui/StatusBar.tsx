import { Icon } from "./Icon";

interface Props {
  pluginCount: number;
}

export function StatusBar({ pluginCount }: Props) {
  return (
    <footer className="statusbar">
      <div className="status-i">
        <Icon name="check" />已保存
      </div>
      <div className="status-i sync">
        <Icon name="cloud" />WebDAV 已同步
      </div>
      <div className="sp" />
      <div>第 24 行 · 共 1,182 字</div>
      <div>UTF-8　Markdown</div>
      <div className="status-i">
        <Icon name="plug" />
        {pluginCount} 个插件已启用
      </div>
    </footer>
  );
}

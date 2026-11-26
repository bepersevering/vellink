import { Icon, type IconName } from "./Icon";
import type { OutlineItem, PluginInfo } from "./data";

export type PanelTab = "outline" | "plugins" | "ai" | "graph";

interface Props {
  tab: PanelTab;
  collapsed: boolean;
  onTabChange: (t: PanelTab) => void;
  outline: OutlineItem[];
  plugins: PluginInfo[];
  onTogglePlugin: (id: string) => void;
}

const TABS: { id: PanelTab; label: string }[] = [
  { id: "outline", label: "大纲" },
  { id: "plugins", label: "插件" },
  { id: "ai", label: "AI 助手" },
  { id: "graph", label: "图谱" },
];

export function SideDrawer({
  tab,
  collapsed,
  onTabChange,
  outline,
  plugins,
  onTogglePlugin,
}: Props) {
  return (
    <aside
      className={`drawer right ${collapsed ? "closed" : ""}`}
      aria-label="侧边面板"
      aria-hidden={collapsed}
    >
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? "on" : ""}`}
            onClick={() => onTabChange(t.id)}
            role="tab"
            aria-selected={tab === t.id}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={`panel ${tab === "outline" ? "on" : ""}`}>
        {outline.map((item, idx) => (
          <div key={item.id}>
            {idx === 4 && <div style={{ height: 24 }} />}
            <div
              className={`outline-item lv${item.level} ${item.current ? "cur" : ""}`}
            >
              <span className="bar" />
              {item.label}
            </div>
          </div>
        ))}
      </div>

      <div className={`panel ${tab === "plugins" ? "on" : ""}`}>
        {plugins.map((p) => (
          <div className="plugin-card" key={p.id}>
            <div className="plugin-top">
              <div className={`plugin-ico ${p.tone}`}>
                <Icon name={p.icon as IconName} />
              </div>
              <span className="plugin-name">{p.name}</span>
              <button
                className={`toggle ${p.enabled ? "on" : ""}`}
                onClick={() => onTogglePlugin(p.id)}
                aria-label={`${p.enabled ? "停用" : "启用"} ${p.name}`}
                aria-pressed={p.enabled}
              />
            </div>
            <div className="plugin-desc">{p.desc}</div>
            <span className="plugin-tag">{p.tag}</span>
          </div>
        ))}
        <div
          className="plugin-card"
          style={{
            borderStyle: "dashed",
            textAlign: "center",
            color: "var(--text-hint)",
            fontSize: 12,
            padding: 16,
          }}
        >
          + 从社区安装插件
        </div>
      </div>

      <div className={`panel ${tab === "ai" ? "on" : ""}`}>
        <div className="chat-msg">
          <div className="chat-label">你</div>
          <div className="chat-user">这篇文章的核心观点是什么？</div>
        </div>
        <div className="chat-msg">
          <div className="chat-label">AI · 已检索 3 篇相关笔记</div>
          <div className="chat-ai">
            核心观点是：知识体系的价值不在收藏量，而在能否被重新调用。文中给出了“收集→连接→压缩→表达”的最小闭环，并强调 <code>distill</code>（压缩）是最容易被跳过、也最关键的一步。
          </div>
        </div>
        <div className="chat-msg">
          <div className="chat-label">你可以问</div>
          <div className="chat-ai" style={{ color: "var(--accent-text)", cursor: "pointer" }}>
            · 帮我续写“写在最后”　· 把这篇精简成 200 字　· 列出可链接的笔记
          </div>
        </div>
        <div className="chat-input">
          问点什么…<span className="kbd">↵</span>
        </div>
      </div>

      <div className={`panel ${tab === "graph" ? "on" : ""}`}>
        <svg className="graph" viewBox="0 0 260 280">
          <path
            d="M130 130 L62 70 M130 130 L200 76 M130 130 L70 195 M130 130 L196 198 M62 70 L70 195 M200 76 L196 198"
            stroke="#dcdcd6"
            strokeWidth="1"
            fill="none"
          />
          <circle cx="130" cy="130" r="13" fill="#5b6ec9" />
          <text x="130" y="134" textAnchor="middle" fontSize="8" fill="#fff" fontFamily="sans-serif">
            核心
          </text>
          <circle cx="62" cy="70" r="8" fill="#8a6fc9" />
          <circle cx="200" cy="76" r="9" fill="#3f9e77" />
          <circle cx="70" cy="195" r="7" fill="#c98a2e" />
          <circle cx="196" cy="198" r="10" fill="#8a6fc9" />
          <text x="62" y="52" textAnchor="middle" fontSize="9" fill="#7a7a75" fontFamily="sans-serif">
            第二大脑
          </text>
          <text x="200" y="59" textAnchor="middle" fontSize="9" fill="#7a7a75" fontFamily="sans-serif">
            原子笔记
          </text>
          <text x="70" y="216" textAnchor="middle" fontSize="9" fill="#7a7a75" fontFamily="sans-serif">
            深度工作
          </text>
          <text x="196" y="222" textAnchor="middle" fontSize="9" fill="#7a7a75" fontFamily="sans-serif">
            读书笔记
          </text>
        </svg>
      </div>
    </aside>
  );
}

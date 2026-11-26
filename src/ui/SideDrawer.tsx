import { Icon, type IconName } from "./Icon";
import { ServicePanel } from "./ServicePanel";
import { t } from "../i18n";
import type { PluginRuntime } from "../core/plugin/runtime";
import type { OutlineEntry } from "../core/outline";
import type { PluginInfo } from "./data";

export type PanelTab = "outline" | "plugins" | "ai" | "graph";

interface Props {
  tab: PanelTab;
  collapsed: boolean;
  onTabChange: (t: PanelTab) => void;
  outline: OutlineEntry[];
  onJump: (offset: number) => void;
  plugins: PluginInfo[];
  pluginErrors?: string[];
  onTogglePlugin: (id: string) => void;
  runtime: PluginRuntime | null;
  notify: (message: string) => void;
}

const TABS: { id: PanelTab; labelKey: string }[] = [
  { id: "outline", labelKey: "tab.outline" },
  { id: "plugins", labelKey: "tab.plugins" },
  { id: "ai", labelKey: "tab.ai" },
  { id: "graph", labelKey: "tab.graph" },
];

export function SideDrawer({
  tab,
  collapsed,
  onTabChange,
  outline,
  onJump,
  plugins,
  pluginErrors = [],
  onTogglePlugin,
  runtime,
  notify,
}: Props) {
  return (
    <aside
      className={`drawer right ${collapsed ? "closed" : ""}`}
      aria-label={t("drawer.sidePanel")}
      aria-hidden={collapsed}
    >
      <div className="tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={`tab ${tab === item.id ? "on" : ""}`}
            onClick={() => onTabChange(item.id)}
            role="tab"
            aria-selected={tab === item.id}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      <div className={`panel ${tab === "outline" ? "on" : ""}`}>
        {outline.length === 0 && <div className="panel-empty">{t("outline.empty")}</div>}
        {outline.map((item) => (
          <button
            key={item.id}
            className={`outline-item lv${item.level}`}
            onClick={() => onJump(item.offset)}
            title={item.label}
          >
            <span className="bar" />
            {item.label}
          </button>
        ))}
      </div>

      <div className={`panel ${tab === "plugins" ? "on" : ""}`}>
        {pluginErrors.map((error) => (
          <div key={error} className="plugin-error" title={error}>
            ⚠ {error}
          </div>
        ))}
        {plugins.length === 0 && pluginErrors.length === 0 && (
          <div className="plugin-empty">{t("plugins.loading")}</div>
        )}
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
                aria-label={t(p.enabled ? "plugins.disable" : "plugins.enable", { name: p.name })}
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
          {t("plugins.installHint")}
        </div>
      </div>

      <div className={`panel ${tab === "ai" ? "on" : ""}`}>
        <ServicePanel runtime={runtime} notify={notify} />
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
            {t("graph.core")}
          </text>
          <circle cx="62" cy="70" r="8" fill="#8a6fc9" />
          <circle cx="200" cy="76" r="9" fill="#3f9e77" />
          <circle cx="70" cy="195" r="7" fill="#c98a2e" />
          <circle cx="196" cy="198" r="10" fill="#8a6fc9" />
          <text x="62" y="52" textAnchor="middle" fontSize="9" fill="#7a7a75" fontFamily="sans-serif">
            {t("graph.secondBrain")}
          </text>
          <text x="200" y="59" textAnchor="middle" fontSize="9" fill="#7a7a75" fontFamily="sans-serif">
            {t("graph.atomicNotes")}
          </text>
          <text x="70" y="216" textAnchor="middle" fontSize="9" fill="#7a7a75" fontFamily="sans-serif">
            {t("graph.deepWork")}
          </text>
          <text x="196" y="222" textAnchor="middle" fontSize="9" fill="#7a7a75" fontFamily="sans-serif">
            {t("graph.readingNotes")}
          </text>
        </svg>
      </div>
    </aside>
  );
}

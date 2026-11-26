/**
 * 官方插件配置与交互面板。
 * 刻意不静态 import 插件实现：只通过 runtime 的 Provider 贡献点拿到结构化服务，
 * 保持插件入口是独立 chunk（卸载插件时 UI 自动降级为「未安装」）。
 */
import { useEffect, useState } from "react";
import type { PluginRuntime } from "../core/plugin/runtime";
import { DEEPSEEK_DEFAULTS } from "../core/ai/provider";
import { t } from "../i18n";

interface AIConfig {
  baseUrl: string;
  model: string;
  account: string;
}
interface AIService {
  configured(): boolean;
  config(): (AIConfig & { hasKey: boolean }) | undefined;
  configure(config: AIConfig, apiKey: string): Promise<void>;
  reindex(): Promise<number>;
  ask(question: string): Promise<{ answer: string; sources: Array<{ headings: string[]; score: number }> }>;
  appendToDocument(result: { answer: string; sources: Array<{ headings: string[]; score: number }> }): void;
}
interface WebDavService {
  configured(): boolean;
  config(): { baseUrl: string; account: string; remotePath?: string } | undefined;
  configure(config: { baseUrl: string; account: string; remotePath?: string }, secret: string): Promise<void>;
  sync(): Promise<{ actions: Array<{ type: string; path: string }>; pending: number }>;
}

interface Props {
  runtime: PluginRuntime | null;
  notify: (message: string) => void;
}

export function ServicePanel({ runtime, notify }: Props) {
  const [ai, setAI] = useState<AIService | null>(null);
  const [dav, setDav] = useState<WebDavService | null>(null);
  const [aiHasKey, setAiHasKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState<string>(DEEPSEEK_DEFAULTS.baseUrl);
  const [model, setModel] = useState<string>(DEEPSEEK_DEFAULTS.model);
  const [account, setAccount] = useState("default");
  const [apiKey, setApiKey] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ text: string; sources: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [davUrl, setDavUrl] = useState("");
  const [davAccount, setDavAccount] = useState("");
  const [davPath, setDavPath] = useState("");
  const [davSecret, setDavSecret] = useState("");

  useEffect(() => {
    if (!runtime) {
      setAI(null);
      setDav(null);
      return;
    }
    const aiValue = runtime.contribution<unknown>("providers", "ai-chat.provider")?.value;
    const davValue = runtime.contribution<unknown>("providers", "webdav.provider")?.value;
    setAI((aiValue as AIService) ?? null);
    setDav((davValue as WebDavService) ?? null);
    const aiConfig = typeof (aiValue as AIService | undefined)?.config === "function"
      ? (aiValue as AIService).config()
      : undefined;
    if (aiConfig) {
      setBaseUrl(aiConfig.baseUrl);
      setModel(aiConfig.model);
      setAccount(aiConfig.account);
      setAiHasKey(Boolean(aiConfig.hasKey));
    }
    const davConfig = (davValue as WebDavService | undefined)?.config?.();
    if (davConfig) {
      setDavUrl(davConfig.baseUrl);
      setDavAccount(davConfig.account);
      setDavPath(davConfig.remotePath ?? "");
    }
  }, [runtime]);

  const saveAI = async () => {
    if (!ai) return;
    try {
      await ai.configure({ baseUrl, model, account }, apiKey);
      setApiKey("");
      notify(t("service.ai.saved"));
    } catch (error) {
      notify(t("service.configFailed", { message: error instanceof Error ? error.message : String(error) }));
    }
  };

  const ask = async () => {
    if (!ai || !question.trim()) return;
    setBusy(true);
    try {
      const result = await ai.ask(question.trim());
      setAnswer({
        text: result.answer,
        sources: result.sources.map((s) => `${s.headings.join(" > ") || t("service.ai.body")} · ${s.score.toFixed(2)}`),
      });
    } catch (error) {
      notify(t("service.askFailed", { message: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(false);
    }
  };

  const writeBack = () => {
    if (!ai || !answer) return;
    ai.appendToDocument({ answer: answer.text, sources: [] });
    notify(t("service.ai.writeBackDone"));
  };

  const saveDav = async () => {
    if (!dav) return;
    try {
      await dav.configure({ baseUrl: davUrl, account: davAccount, remotePath: davPath || undefined }, davSecret);
      setDavSecret("");
      notify(t("service.dav.saved"));
    } catch (error) {
      notify(t("service.configFailed", { message: error instanceof Error ? error.message : String(error) }));
    }
  };

  const syncNow = async () => {
    if (!dav) return;
    setBusy(true);
    try {
      const report = await dav.sync();
      notify(
        t("service.dav.syncReport", {
          uploads: report.actions.filter((a) => a.type === "upload").length,
          downloads: report.actions.filter((a) => a.type === "download").length,
          conflicts: report.actions.filter((a) => a.type === "conflict").length,
        }),
      );
    } catch (error) {
      notify(t("service.dav.syncFailed", { message: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="service-panel">
      <section className="service-block">
        <div className="service-title">{t("service.ai.title")}</div>
        {!ai ? (
          <div className="service-empty">{t("service.ai.notInstalled")}</div>
        ) : (
          <>
            <div className="service-fields">
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} aria-label={t("service.ai.baseUrl")} placeholder={t("service.ai.baseUrlPlaceholder")} />
              <input value={model} onChange={(e) => setModel(e.target.value)} aria-label={t("service.ai.model")} placeholder={t("service.ai.modelPlaceholder")} />
              <input value={account} onChange={(e) => setAccount(e.target.value)} aria-label={t("service.ai.account")} placeholder={t("service.ai.accountPlaceholder")} />
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} aria-label={t("service.ai.key")} placeholder={aiHasKey ? t("service.ai.keySaved") : t("service.ai.key")} />
            </div>
            <button className="service-btn" onClick={saveAI} disabled={busy}>
              {t("service.ai.save")}
            </button>
            <textarea
              className="service-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={t("service.ai.question")}
              aria-label={t("service.ai.questionLabel")}
            />
            <button className="service-btn primary" onClick={ask} disabled={busy || !aiHasKey}>
              {busy ? t("service.ai.busy") : t("service.ai.ask")}
            </button>
            {answer && (
              <div className="service-answer">
                <div className="service-label">{t("service.ai.answer")}</div>
                <div>{answer.text}</div>
                {answer.sources.length > 0 && (
                  <div className="service-sources">
                    {t("service.ai.sources", { sources: answer.sources.join("; ") })}
                  </div>
                )}
                <button className="service-btn" onClick={writeBack}>
                  {t("service.ai.writeBack")}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="service-block">
        <div className="service-title">{t("service.dav.title")}</div>
        {!dav ? (
          <div className="service-empty">{t("service.dav.notInstalled")}</div>
        ) : (
          <>
            <div className="service-fields">
              <input value={davUrl} onChange={(e) => setDavUrl(e.target.value)} aria-label={t("service.dav.url")} placeholder="https://dav.example.com" />
              <input value={davAccount} onChange={(e) => setDavAccount(e.target.value)} aria-label={t("service.dav.account")} placeholder={t("service.dav.accountPlaceholder")} />
              <input value={davPath} onChange={(e) => setDavPath(e.target.value)} aria-label={t("service.dav.remotePath")} placeholder={t("service.dav.remotePathPlaceholder")} />
              <input type="password" value={davSecret} onChange={(e) => setDavSecret(e.target.value)} aria-label={t("service.dav.secret")} placeholder={t("service.dav.secretPlaceholder")} />
            </div>
            <div className="service-actions">
              <button className="service-btn" onClick={saveDav} disabled={busy}>
                {t("service.dav.save")}
              </button>
              <button className="service-btn primary" onClick={syncNow} disabled={busy || !dav.configured()}>
                {busy ? t("service.ai.busy") : t("service.dav.syncNow")}
              </button>
            </div>
            <div className="service-note">{t("service.dav.note")}</div>
          </>
        )}
      </section>
    </div>
  );
}

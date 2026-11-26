/**
 * 官方插件配置与交互面板。
 * 刻意不静态 import 插件实现：只通过 runtime 的 Provider 贡献点拿到结构化服务，
 * 保持插件入口是独立 chunk（卸载插件时 UI 自动降级为「未安装」）。
 */
import { useEffect, useState } from "react";
import type { PluginRuntime } from "../core/plugin/runtime";
import { DEEPSEEK_DEFAULTS } from "../core/ai/provider";

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
      notify("AI 配置已保存，密钥已交给凭据仓库");
    } catch (error) {
      notify(`配置失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const ask = async () => {
    if (!ai || !question.trim()) return;
    setBusy(true);
    try {
      const result = await ai.ask(question.trim());
      setAnswer({
        text: result.answer,
        sources: result.sources.map((s) => `${s.headings.join(" > ") || "正文"} · ${s.score.toFixed(2)}`),
      });
    } catch (error) {
      notify(`问答失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const writeBack = () => {
    if (!ai || !answer) return;
    ai.appendToDocument({ answer: answer.text, sources: [] });
    notify("回答已写回当前文档（可撤销）");
  };

  const saveDav = async () => {
    if (!dav) return;
    try {
      await dav.configure({ baseUrl: davUrl, account: davAccount, remotePath: davPath || undefined }, davSecret);
      setDavSecret("");
      notify("WebDAV 配置已保存");
    } catch (error) {
      notify(`配置失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const syncNow = async () => {
    if (!dav) return;
    setBusy(true);
    try {
      const report = await dav.sync();
      notify(
        `同步完成 · 上传 ${report.actions.filter((a) => a.type === "upload").length} / 下载 ${report.actions.filter((a) => a.type === "download").length} / 冲突 ${report.actions.filter((a) => a.type === "conflict").length}`,
      );
    } catch (error) {
      notify(`同步失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="service-panel">
      <section className="service-block">
        <div className="service-title">AI 知识库问答</div>
        {!ai ? (
          <div className="service-empty">AI 插件未安装或未启用</div>
        ) : (
          <>
            <div className="service-fields">
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} aria-label="AI 接口地址" placeholder="接口地址" />
              <input value={model} onChange={(e) => setModel(e.target.value)} aria-label="模型名" placeholder="模型名" />
              <input value={account} onChange={(e) => setAccount(e.target.value)} aria-label="账号标识" placeholder="账号标识" />
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} aria-label="API Key" placeholder={aiHasKey ? "API Key（已保存，留空不覆盖）" : "API Key"} />
            </div>
            <button className="service-btn" onClick={saveAI} disabled={busy}>
              保存配置
            </button>
            <textarea
              className="service-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="问一个关于当前文档的问题…"
              aria-label="提问"
            />
            <button className="service-btn primary" onClick={ask} disabled={busy || !aiHasKey}>
              {busy ? "处理中…" : "检索并提问"}
            </button>
            {answer && (
              <div className="service-answer">
                <div className="service-label">回答</div>
                <div>{answer.text}</div>
                {answer.sources.length > 0 && (
                  <div className="service-sources">引用：{answer.sources.join("；")}</div>
                )}
                <button className="service-btn" onClick={writeBack}>
                  写回文档
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="service-block">
        <div className="service-title">WebDAV 云同步</div>
        {!dav ? (
          <div className="service-empty">WebDAV 插件未安装或未启用</div>
        ) : (
          <>
            <div className="service-fields">
              <input value={davUrl} onChange={(e) => setDavUrl(e.target.value)} aria-label="WebDAV 地址" placeholder="https://dav.example.com" />
              <input value={davAccount} onChange={(e) => setDavAccount(e.target.value)} aria-label="WebDAV 账号" placeholder="账号" />
              <input value={davPath} onChange={(e) => setDavPath(e.target.value)} aria-label="远端根目录" placeholder="远端根目录（可选）" />
              <input type="password" value={davSecret} onChange={(e) => setDavSecret(e.target.value)} aria-label="密码或应用密码" placeholder="密码 / 应用密码" />
            </div>
            <div className="service-actions">
              <button className="service-btn" onClick={saveDav} disabled={busy}>
                保存连接
              </button>
              <button className="service-btn primary" onClick={syncNow} disabled={busy || !dav.configured()}>
                {busy ? "处理中…" : "立即同步"}
              </button>
            </div>
            <div className="service-note">断网编辑会先落本地，联网后按 ETag 合并；冲突保留 .conflict 副本。</div>
          </>
        )}
      </section>
    </div>
  );
}

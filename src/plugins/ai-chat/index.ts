/**
 * 官方 AI 问答插件 — 索引当前文档，检索相关块，调用 OpenAI 兼容模型。
 *
 * Key 存 CredentialStore（Tauri 打包后是 OS 密钥链），配置存插件私有 storage。
 * 回答写回走 ctx.documents.apply，与编辑器共用唯一撤销栈。
 */
import type { PluginContext, PluginModule } from "../../core/plugin/runtime";
import { chunkDocument } from "../../core/ai/chunk";
import { OpenAICompatProvider, type AIProvider, type ChatMessage } from "../../core/ai/provider";
import { MemoryVectorStore, hashEmbed, indexChunks, type VectorStore } from "../../core/ai/vector";
import { parseMarkdown } from "../../core/parser/markdown";

export interface AIConfig {
  baseUrl: string;
  model: string;
  account: string;
}

export interface AskResult {
  answer: string;
  sources: Array<{ text: string; headings: string[]; score: number }>;
}

export interface AIService {
  id: "ai-chat.provider";
  configured(): boolean;
  config(): (AIConfig & { hasKey: boolean }) | undefined;
  configure(config: AIConfig, apiKey: string): Promise<void>;
  reindex(): Promise<number>;
  ask(question: string): Promise<AskResult>;
  appendToDocument(result: AskResult): void;
}

const SERVICE = "vellink:ai";
const CONFIG_KEY = "config";

function createService(ctx: PluginContext): AIService {
  const store: VectorStore = new MemoryVectorStore();
  let provider: AIProvider | undefined;
  let indexedVersion = -1;

  const readConfig = () => ctx.storage.get<AIConfig>(CONFIG_KEY);

  const rebuildProvider = async () => {
    const config = readConfig();
    if (!config) {
      provider = undefined;
      return;
    }
    const credential = await ctx.credentials.get(SERVICE, config.account);
    if (!credential) {
      provider = undefined;
      return;
    }
    provider = new OpenAICompatProvider({
      id: "ai-chat",
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey: credential.secret,
      fetch: (input, init) => ctx.net.fetch(input, init),
    });
  };
  void rebuildProvider();

  const reindex = async (): Promise<number> => {
    const doc = ctx.documents.getDocument();
    const chunks = chunkDocument(doc);
    await indexChunks(store, chunks, hashEmbed);
    indexedVersion = doc.version;
    return chunks.length;
  };

  return {
    id: "ai-chat.provider",
    configured: () => Boolean(readConfig()),
    config: () => {
      const config = readConfig();
      return config ? { ...config, hasKey: Boolean(config.account) } : undefined;
    },
    async configure(config, apiKey) {
      if (!/^https?:\/\//.test(config.baseUrl)) throw new Error("接口地址必须是 http(s) URL");
      if (!config.model || !config.account || !apiKey) throw new Error("模型、账号与 API Key 不能为空");
      ctx.storage.set(CONFIG_KEY, config);
      await ctx.credentials.set(SERVICE, config.account, {
        username: config.account,
        secret: apiKey,
      });
      await rebuildProvider();
      ctx.notify("AI 配置已保存");
    },
    reindex,
    async ask(question) {
      if (!provider) throw new Error("尚未配置 AI 模型与 Key");
      const doc = ctx.documents.getDocument();
      if (indexedVersion !== doc.version || store.size() === 0) await reindex();

      const matches = (await store.query(hashEmbed(question), 4)).filter((match) => match.score > 0.02);
      const sources = matches.map((match) => ({
        text: match.text,
        headings: (match.metadata?.headings as string[] | undefined) ?? [],
        score: match.score,
      }));
      const context = sources.length
        ? sources.map((s) => `[${s.headings.join(" > ") || "正文"}]\n${s.text}`).join("\n\n")
        : "（未召回相关内容）";

      const messages: ChatMessage[] = [
        {
          role: "system",
          content:
            "你是文档助手。只根据提供的文档片段回答用户问题；引用片段标题，不编造内容。若片段不足以回答，明确说明。",
        },
        { role: "user", content: `文档片段：\n${context}\n\n问题：${question}` },
      ];
      const answer = await provider.chat(messages, { temperature: 0.2 });
      return { answer, sources };
    },
    appendToDocument(result) {
      const doc = ctx.documents.getDocument();
      const stamp = new Date().toLocaleString("zh-CN", { hour12: false });
      const citations = result.sources
        .map((source) => `- ${source.headings.join(" > ") || "正文"}（相似度 ${source.score.toFixed(2)}）`)
        .join("\n");
      const section = `\n\n## AI 问答 · ${stamp}\n\n**问题**\n\n${result.answer}\n\n**引用**\n\n${citations || "无"}\n`;
      const newSource = `${doc.source.trimEnd()}${section}`;
      ctx.documents.apply([
        {
          type: "replaceDocument",
          children: parseMarkdown({ source: newSource }).ir.children,
          source: newSource,
        },
      ]);
      indexedVersion = -1;
    },
  };
}

let service: AIService | undefined;

const plugin: PluginModule = {
  activate(ctx) {
    service = createService(ctx);
    ctx.contributions.register("providers", "ai-chat.provider", service);
  },
  commands: {
    configure(ctx) {
      ctx.notify("请在右侧「AI 助手」填写接口地址、模型与 Key");
      return Boolean(service?.configured());
    },
    async reindex(ctx) {
      if (!service?.configured()) {
        ctx.notify("尚未配置 AI 模型");
        return false;
      }
      const count = await service.reindex();
      ctx.notify(`索引完成：${count} 个片段`);
      return true;
    },
  },
};

export default plugin;

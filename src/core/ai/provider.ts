/**
 * AIProvider — OpenAI 兼容的聊天接口抽象。
 *
 * 约束：
 * 1. Key 由调用方从凭据仓库取出后临时传入，Provider 不持久化、不打印。
 * 2. 只依赖 fetch，DeepSeek / OpenAI / 本地 Ollama 都能用同一实现。
 * 3. 插件拿到的是 Provider 接口，不是具体厂商 SDK，模型可替换。
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AIProvider {
  readonly id: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
}

export interface OpenAICompatConfig {
  id?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

export class OpenAICompatProvider implements AIProvider {
  readonly id: string;
  private readonly endpoint: string;
  private readonly config: OpenAICompatConfig;
  private readonly doFetch: typeof fetch;

  constructor(config: OpenAICompatConfig) {
    if (!config.apiKey) throw new Error("AI API Key 不能为空");
    this.config = config;
    this.id = config.id ?? "openai-compatible";
    this.endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    this.doFetch = config.fetch ?? fetch;
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const response = await this.doFetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const data = (await response.json()) as ChatCompletionResponse;
    if (!response.ok) throw new Error(`AI 服务返回 ${response.status}: ${data.error?.message ?? "未知错误"}`);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("AI 服务返回空内容");
    return content;
  }
}

/** 默认 DeepSeek 配置；Key 仍需用户配置，绝不硬编码。 */
export const DEEPSEEK_DEFAULTS = {
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-flash",
} as const;

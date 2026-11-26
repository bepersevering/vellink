/**
 * VectorStore 抽象 + 内存余弦相似度实现。
 *
 * sqlite-vec / 远端向量库后续实现同一接口即可替换；
 * 内置 embedding 是确定性的字符 n-gram 哈希（无需 API Key），
 * 保证离线也能召回正确段落。需要语义级召回时可注入外部 embedder。
 */

export interface VectorRecord {
  id: string;
  vector: number[];
  text: string;
  metadata?: Record<string, unknown>;
}

export interface VectorMatch {
  id: string;
  score: number;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface VectorStore {
  readonly id: string;
  upsert(records: VectorRecord[]): Promise<void>;
  query(vector: number[], topK?: number): Promise<VectorMatch[]>;
  clear(): Promise<void>;
  size(): number;
}

export type Embedder = (text: string) => number[] | Promise<number[]>;

const DIMENSIONS = 256;

/** 字符 unigram + bigram 哈希：中英文混合都能召回，纯本地确定性。 */
export function hashEmbed(text: string, dimensions = DIMENSIONS): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const grams: string[] = [];
  for (let i = 0; i < normalized.length; i++) {
    grams.push(normalized[i]);
    if (i + 1 < normalized.length) grams.push(normalized.slice(i, i + 2));
  }
  for (const gram of grams) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < gram.length; i++) {
      hash ^= gram.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    vector[(hash >>> 0) % dimensions] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < length; i++) dot += a[i] * b[i];
  return dot;
}

export class MemoryVectorStore implements VectorStore {
  readonly id = "memory";
  private readonly records = new Map<string, VectorRecord>();

  constructor(private readonly dimensions = DIMENSIONS) {}

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const record of records) {
      if (record.vector.length !== this.dimensions)
        throw new Error(`向量维度不匹配: 期望 ${this.dimensions}，实际 ${record.vector.length}`);
      this.records.set(record.id, record);
    }
  }

  async query(vector: number[], topK = 4): Promise<VectorMatch[]> {
    return [...this.records.values()]
      .map((record) => ({
        id: record.id,
        score: cosineSimilarity(vector, record.vector),
        text: record.text,
        ...(record.metadata ? { metadata: record.metadata } : {}),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, topK));
  }

  async clear(): Promise<void> {
    this.records.clear();
  }

  size(): number {
    return this.records.size;
  }
}

/** 把 chunks 灌入 store 的便捷函数；embedder 默认用内置哈希。 */
export async function indexChunks(
  store: VectorStore,
  chunks: Array<{ id: string; text: string; headings?: string[]; start?: number; end?: number }>,
  embedder: Embedder = hashEmbed,
): Promise<void> {
  await store.clear();
  const dimensions = chunks.length ? (await embedder(chunks[0].text)).length : DIMENSIONS;
  const records: VectorRecord[] = [];
  for (const chunk of chunks) {
    const vector = await embedder(`${chunk.headings?.join(" ") ?? ""} ${chunk.text}`);
    if (vector.length !== dimensions) throw new Error("嵌入器返回的维度不一致");
    records.push({
      id: chunk.id,
      vector,
      text: chunk.text,
      metadata: { headings: chunk.headings ?? [], start: chunk.start ?? 0, end: chunk.end ?? 0 },
    });
  }
  await store.upsert(records);
}

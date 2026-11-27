/**
 * VectorStore abstraction plus an in-memory cosine-similarity implementation.
 *
 * sqlite-vec / remote vector stores can replace it by implementing the same interface;
 * the built-in embedding is a deterministic character n-gram hash (no API key needed),
 * so the right passages are recalled even offline. Inject an external embedder when
 * semantic-level recall is required.
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

/** Character unigram + bigram hashes: recalls mixed CJK/English text, fully local and deterministic. */
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
        throw new Error(`Vector dimension mismatch: expected ${this.dimensions}, got ${record.vector.length}`);
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

/** Convenience helper that indexes chunks into a store; uses the built-in hash embedder by default. */
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
    if (vector.length !== dimensions) throw new Error("embedder returned inconsistent dimensions");
    records.push({
      id: chunk.id,
      vector,
      text: chunk.text,
      metadata: { headings: chunk.headings ?? [], start: chunk.start ?? 0, end: chunk.end ?? 0 },
    });
  }
  await store.upsert(records);
}

/** Unified registry for the six contribution kinds: commands, menus, views, block renderers, syntax and providers. */

export const CONTRIBUTION_KINDS = [
  "commands",
  "menus",
  "views",
  "blockRenderers",
  "syntax",
  "providers",
] as const;

export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];

export interface Contribution<T = unknown> {
  pluginId: string;
  kind: ContributionKind;
  id: string;
  value: T;
}

export class ContributionRegistry {
  private buckets = new Map<ContributionKind, Map<string, Contribution>>();

  register<T>(
    pluginId: string,
    kind: ContributionKind,
    id: string,
    value: T,
  ): () => void {
    let bucket = this.buckets.get(kind);
    if (!bucket) {
      bucket = new Map();
      this.buckets.set(kind, bucket);
    }
    const existing = bucket.get(id);
    // A plugin may override its own earlier declaration (e.g. manifest descriptor → runtime service instance);
    // id collisions between different plugins are still rejected to keep namespaces isolated.
    if (existing && existing.pluginId !== pluginId)
      throw new Error(`Contribution already registered: ${kind}/${id}`);
    bucket.set(id, { pluginId, kind, id, value });
    return () => {
      if (bucket!.get(id)?.pluginId === pluginId) bucket!.delete(id);
    };
  }

  list<T = unknown>(kind: ContributionKind): Array<Contribution<T>> {
    return [...(this.buckets.get(kind)?.values() ?? [])] as Array<Contribution<T>>;
  }

  find<T = unknown>(kind: ContributionKind, id: string): Contribution<T> | undefined {
    return this.buckets.get(kind)?.get(id) as Contribution<T> | undefined;
  }

  /** Clean up by owner when a plugin unloads, so no contributions are left behind. */
  removePlugin(pluginId: string): void {
    for (const bucket of this.buckets.values()) {
      for (const [id, entry] of bucket) {
        if (entry.pluginId === pluginId) bucket.delete(id);
      }
    }
  }

  clear(): void {
    this.buckets.clear();
  }
}

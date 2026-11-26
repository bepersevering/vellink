/** 六类贡献点的统一注册表：命令、菜单、视图、块渲染器、语法、Provider。 */

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
    if (bucket.has(id))
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

  /** 插件卸载时按 owner 清理，避免残留贡献点。 */
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

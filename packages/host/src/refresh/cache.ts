import type { FetchResult } from "@opsdash/plugin-sdk";
import { LRUCache } from "lru-cache";

/** Short-lived result cache (FR-025), keyed by `pluginId|batchKey|refKey`. A window of 0 disables it. */
export class ResultCache {
  #lru = new LRUCache<string, { value: FetchResult }>({ max: 50_000, ttlAutopurge: false });

  static key(pluginId: string, batchKey: string, refKey: string): string {
    return `${pluginId}|${batchKey}|${refKey}`;
  }

  get(key: string): FetchResult | undefined {
    return this.#lru.get(key)?.value;
  }

  set(key: string, value: FetchResult, ttlMs: number): void {
    if (ttlMs > 0) this.#lru.set(key, { value }, { ttl: ttlMs });
  }

  clear(): void {
    this.#lru.clear();
  }
}

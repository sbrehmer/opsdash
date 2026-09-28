import type { DefinedPlugin, FetchResult, StoredRef } from "@opsdash/plugin-sdk";
import type { WidgetInstance } from "../config/resolve.ts";
import { ResultCache } from "./cache.ts";

export interface Need {
  refKey: string;
  ref: unknown;
  batchKey: string;
}

/** Something that needs this plugin's data: one of its own widgets, or a composite widget's refs (API 1.1). */
export interface Consumer {
  path: string;
  settings: unknown;
  refs: unknown[];
}

export interface BatchGroup {
  batchKey: string;
  /** Settings of the first consumer in the group; refs share a group only when their source matches. */
  settings: unknown;
  chunks: Need[][];
  /** Unique refs in the group, including cached ones. */
  uniqueRefs: number;
}

export interface BatchPlan {
  groups: BatchGroup[];
  /** Per consumer path: its de-duplicated needs. */
  needs: Map<string, Need[]>;
  cached: Map<string, FetchResult>;
}

/** Data needs of a plugin's own widget: `plugin.needs`, or its tracked refs. */
export function widgetConsumer(
  plugin: DefinedPlugin,
  w: WidgetInstance,
  trackedRefs: (path: string) => StoredRef[],
): Consumer {
  const tracked = trackedRefs(w.path)
    .filter((r) => r.pluginId === w.pluginId)
    .map((r) => r.ref);
  const refs = plugin.needs ? plugin.needs({ path: w.path, settings: w.settings, trackedRefs: tracked }) : tracked;
  return { path: w.path, settings: w.settings, refs };
}

/**
 * Plans one plugin's fetches for a refresh (FR-023): gathers the consumers' needs, removes duplicates by ref
 * key, skips refs still in the cache, groups by `batchKey(settings, ref)` (per reference, API 1.1), and chunks
 * each group to the plugin's `maxBatchSize`.
 */
export function planBatches(
  pluginId: string,
  plugin: DefinedPlugin,
  consumers: Consumer[],
  cache: ResultCache,
  maxBatchSize = Number.POSITIVE_INFINITY,
): BatchPlan {
  const needs = new Map<string, Need[]>();
  const groups = new Map<string, { settings: unknown; refs: Map<string, Need> }>();
  const cached = new Map<string, FetchResult>();

  for (const c of consumers) {
    const seen = new Set<string>();
    const list: Need[] = [];
    for (const ref of c.refs) {
      const refKey = plugin.refKey(ref);
      if (seen.has(refKey)) continue;
      seen.add(refKey);
      const batchKey = plugin.batchKey?.(c.settings, ref) ?? "default";
      const need = { refKey, ref, batchKey };
      list.push(need);
      const group = groups.get(batchKey) ?? { settings: c.settings, refs: new Map<string, Need>() };
      group.refs.set(refKey, need);
      groups.set(batchKey, group);
    }
    needs.set(c.path, list);
  }

  const planned: BatchGroup[] = [];
  for (const [batchKey, group] of groups) {
    const toFetch: Need[] = [];
    for (const n of group.refs.values()) {
      const key = ResultCache.key(pluginId, batchKey, n.refKey);
      const hit = cache.get(key);
      if (hit) cached.set(key, hit);
      else toFetch.push(n);
    }
    const size = Math.max(1, maxBatchSize);
    const chunks: Need[][] = [];
    for (let i = 0; i < toFetch.length; i += size) chunks.push(toFetch.slice(i, i + size));
    planned.push({ batchKey, settings: group.settings, chunks, uniqueRefs: group.refs.size });
  }
  return { groups: planned, needs, cached };
}

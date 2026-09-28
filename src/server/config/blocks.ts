import { configError } from "./errors.ts";
import type { BlockUse, WidgetPlacement } from "./schema.ts";
import { type ConfigError, type ConfigSet, type ErrorScope, isBlockUse, type LocatedPlacement } from "./types.ts";

/** Checks plugin declarations, block references, parameters and nesting cycles across all files. */
export function checkBlocks(set: ConfigSet, declaredPlugins: Set<string>): ConfigError[] {
  const errors: ConfigError[] = [];
  const checkList = (items: LocatedPlacement[], scope: ErrorScope) => {
    for (const item of items) {
      if (!isBlockUse(item)) {
        const w = item.value as WidgetPlacement;
        if (!declaredPlugins.has(w.plugin)) {
          errors.push(
            configError(
              item.src,
              [...item.path, "plugin"],
              `Plugin "${w.plugin}" is not configured under "plugins".`,
              scope,
            ),
          );
        }
        continue;
      }
      const use = item.value as BlockUse;
      const block = set.blocks[use.use];
      if (!block) {
        errors.push(configError(item.src, [...item.path, "use"], `Unknown block "${use.use}".`, scope));
        continue;
      }
      for (const key of Object.keys(use.with ?? {})) {
        if (!(key in block.params)) {
          errors.push(
            configError(item.src, [...item.path, "with", key], `Block "${use.use}" has no parameter "${key}".`, scope),
          );
        }
      }
      for (const [name, param] of Object.entries(block.params)) {
        if (param.default === undefined && use.with?.[name] === undefined) {
          errors.push(
            configError(
              item.src,
              item.path,
              `Block "${use.use}" requires parameter "${name}" (set it under "with").`,
              scope,
            ),
          );
        }
      }
    }
  };
  for (const d of set.dashboards) checkList(d.items, { dashboard: d.id });
  for (const b of Object.values(set.blocks)) checkList(b.items, { block: b.name });

  // Nesting cycles (FR-010).
  const state = new Map<string, "visiting" | "done">();
  const walk = (name: string, chain: string[]) => {
    state.set(name, "visiting");
    for (const item of set.blocks[name]?.items ?? []) {
      if (!isBlockUse(item)) continue;
      const next = (item.value as BlockUse).use;
      if (!set.blocks[next]) continue;
      if (state.get(next) === "visiting") {
        const cycle = [...chain.slice(chain.indexOf(next)), name, next].join(" → ");
        errors.push(configError(item.src, [...item.path, "use"], `Block nesting cycle: ${cycle}.`, { block: name }));
      } else if (!state.has(next)) walk(next, [...chain, name]);
    }
    state.set(name, "done");
  };
  for (const name of Object.keys(set.blocks)) if (!state.has(name)) walk(name, []);
  return errors;
}

/** Replaces `${name}` in every string of a value with block parameter values. */
export function substitute<T>(value: T, params: Record<string, string>): T {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Za-z0-9_-]+)\}/g, (m, name: string) => params[name] ?? m) as T;
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, params)) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, params)])) as T;
  }
  return value;
}

export interface ExpandedWidget {
  kind: "widget";
  path: string;
  placement: WidgetPlacement;
  located: LocatedPlacement;
  /** Blocks on the expansion chain, outermost first. */
  blocks: string[];
}

export interface ExpandedBlock {
  kind: "block";
  id: string;
  use: string;
  at: [number, number];
  size: [number, number];
  items: Expanded[];
}

export type Expanded = ExpandedWidget | ExpandedBlock;

/**
 * Expands block uses into nested sub-grids. Widget paths join placement ids from the dashboard down:
 * `dashboard/blockUse/.../widget`, so each use of a block has its own tracked lists.
 */
export function expand(
  set: ConfigSet,
  items: LocatedPlacement[],
  prefix: string,
  params: Record<string, string> = {},
  chain: string[] = [],
): Expanded[] {
  return items.flatMap((item): Expanded[] => {
    const path = `${prefix}/${item.value.id}`;
    if (!isBlockUse(item)) {
      const placement = substitute(item.value as WidgetPlacement, params);
      return [{ kind: "widget", path, placement, located: item, blocks: chain }];
    }
    const use = item.value as BlockUse;
    const block = set.blocks[use.use];
    if (!block || chain.includes(use.use)) return [];
    const blockParams = Object.fromEntries(
      Object.entries(block.params).map(([k, p]) => [k, substitute(use.with?.[k] ?? p.default ?? "", params)]),
    );
    return [
      {
        kind: "block",
        id: use.id,
        use: use.use,
        at: use.at,
        size: use.size,
        items: expand(set, block.items, path, blockParams, [...chain, use.use]),
      },
    ];
  });
}

/** All block names reachable from a list of placements. */
export function blocksUsed(set: ConfigSet, items: LocatedPlacement[], seen = new Set<string>()): Set<string> {
  for (const item of items) {
    if (!isBlockUse(item)) continue;
    const name = (item.value as BlockUse).use;
    if (seen.has(name) || !set.blocks[name]) continue;
    seen.add(name);
    blocksUsed(set, set.blocks[name].items, seen);
  }
  return seen;
}

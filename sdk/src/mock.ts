import type { FetchResults, MockFaults, ParseResult, PluginContext, Source } from "./types.ts";

export const DEFAULT_FAULTS: MockFaults = {
  notFound: [],
  errorKeys: [],
  omitKeys: [],
  extraKeys: [],
  latencyMs: 0,
  errorRate: 0,
};

/** Deterministic RNG seeded from a string (mulberry32 over an FNV-1a hash). */
export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
}

export function seededRng(seed: string): Rng {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)]!,
  };
}

export interface MockSourceOptions<Settings, Ref> {
  /** Realistic data for any valid ref; `rng` is seeded by the ref key so results are deterministic. */
  generate(ref: Ref, rng: Rng, ctx: PluginContext<Settings>): unknown;
  /** Offline validation of user input for "track item". */
  parseReference(input: string): ParseResult<Ref>;
  /** Canonical key for a ref (must match the plugin's `refKey`). */
  refKey(ref: Ref): string;
  /** Default faults; config `plugins.<id>.mock` overrides them per call. */
  faults?: Partial<MockFaults>;
  /** Build a ref from a key, used for `extraKeys`. */
  fromKey?(key: string): Ref;
  /** Mock versions of the plugin's resolvers (API 1.1). */
  resolvers?: Source<Settings, Ref>["resolvers"];
  /** Called after each mock fetch, for example to request a faster next refresh (API 1.1). */
  afterFetch?(refs: Ref[], results: FetchResults, ctx: PluginContext<Settings>): void;
  _settings?: Settings;
}

export const MOCK_REQUESTS_KEY = "__mock.requests";

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Builds a plugin's required mock source (FR-049): same signatures as the real source, no network, no secrets. */
export function createMockSource<Settings, Ref>(options: MockSourceOptions<Settings, Ref>): Source<Settings, Ref> {
  const faultsFor = (ctx: PluginContext<Settings>): MockFaults => ({
    ...DEFAULT_FAULTS,
    ...options.faults,
    ...ctx.mockFaults,
  });

  return {
    resolvers: options.resolvers,
    parseReference(input, ctx) {
      const parsed = options.parseReference(input.trim());
      if ("error" in parsed) return parsed;
      const key = options.refKey(parsed.ok);
      if (faultsFor(ctx).notFound.includes(key)) return { error: `${key} was not found` };
      return parsed;
    },

    async fetch(refs, ctx) {
      const faults = faultsFor(ctx);
      ctx.state.set(MOCK_REQUESTS_KEY, (ctx.state.get<number>(MOCK_REQUESTS_KEY) ?? 0) + 1);
      if (faults.latencyMs > 0) await sleep(faults.latencyMs, ctx.signal);
      if (faults.errorRate > 0 && Math.random() < faults.errorRate) throw new Error("Simulated source failure");

      const results: FetchResults = new Map();
      for (const ref of refs) {
        const key = options.refKey(ref);
        if (faults.omitKeys.includes(key)) continue;
        if (faults.notFound.includes(key)) results.set(key, { error: `${key} was not found` });
        else if (faults.errorKeys.includes(key)) results.set(key, { error: `Simulated error for ${key}` });
        else results.set(key, { data: options.generate(ref, seededRng(key), ctx) });
      }
      for (const key of faults.extraKeys ?? []) {
        const ref = options.fromKey?.(key);
        results.set(key, { data: ref ? options.generate(ref, seededRng(key), ctx) : { key } });
      }
      options.afterFetch?.(refs, results, ctx);
      return results;
    },
  };
}

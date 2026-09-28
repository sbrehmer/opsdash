import { z } from "zod";
import type { CompositePluginDefinition, DefinedComposite, DefinedPlugin, PluginDefinition } from "./types.ts";

export * from "./http.ts";
export type { MockSourceOptions, Rng } from "./mock.ts";
export { createMockSource, DEFAULT_FAULTS, MOCK_REQUESTS_KEY, seededRng } from "./mock.ts";
export { isSecretRef, SECRET_LITERAL_MESSAGE, secret } from "./secret.ts";
export * from "./types.ts";
export { z };

/**
 * Declares a plugin's server module. Returns the definition unchanged, plus `jsonSchemas()`, which the
 * SDK Vite preset uses at build time to write the settings (and, for source plugins, reference) schemas
 * into the manifest. Composite plugins (API 1.1) pass only `settings`, `actions` and `onData`.
 */
export function definePlugin<S extends z.ZodType, R extends z.ZodType>(
  def: PluginDefinition<S, R>,
): DefinedPlugin<S, R>;
export function definePlugin<S extends z.ZodType>(def: CompositePluginDefinition<S>): DefinedComposite<S>;
export function definePlugin(def: PluginDefinition | CompositePluginDefinition): DefinedPlugin | DefinedComposite {
  const opts = { io: "input", unrepresentable: "any" } as const;
  return {
    ...def,
    jsonSchemas: () => ({
      settingsSchema: z.toJSONSchema(def.settings, opts),
      ...("reference" in def && def.reference ? { referenceSchema: z.toJSONSchema(def.reference, opts) } : {}),
    }),
  } as DefinedPlugin | DefinedComposite;
}

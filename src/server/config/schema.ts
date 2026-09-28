import semver from "semver";
import { z } from "zod";
import { duration, slug } from "./primitives.ts";

export const CONFIG_VERSION = 1;

export const TOKEN_NAMES = [
  "color-bg",
  "color-surface",
  "color-text",
  "color-text-muted",
  "color-border",
  "color-accent",
  "color-ok",
  "color-warn",
  "color-error",
  "font-family",
  "font-family-mono",
  "font-size-base",
  "space-unit",
  "grid-gap",
  "radius",
  "motion-duration",
] as const;

const tokenValues = z.strictObject(Object.fromEntries(TOKEN_NAMES.map((t) => [t, z.string().optional()])));

export const themeSchema = z.strictObject({
  mode: z.enum(["light", "dark", "system"]).optional(),
  tokens: tokenValues.optional(),
  "tokens-light": tokenValues.optional(),
  "tokens-dark": tokenValues.optional(),
});
export type ThemeSpec = z.infer<typeof themeSchema>;

const column = z
  .int("Grid positions are whole numbers")
  .min(1, "Columns start at 1")
  .max(12, "The grid has 12 columns");
const row = z.int("Grid positions are whole numbers").min(1, "Rows start at 1");
const width = z.int("Sizes are whole numbers").min(1, "Width must be at least 1").max(12, "The grid has 12 columns");
const height = z.int("Sizes are whole numbers").min(1, "Height must be at least 1");

export const atSchema = z.tuple([column, row], { error: "Expected [column, row], for example [1, 1]" });
export const sizeSchema = z.tuple([width, height], { error: "Expected [width, height], for example [6, 4]" });

export const widgetPlacementSchema = z.strictObject({
  id: slug,
  plugin: slug,
  title: z.string().optional(),
  at: atSchema,
  size: sizeSchema,
  settings: z.record(z.string(), z.unknown()).optional(),
});
export type WidgetPlacement = z.infer<typeof widgetPlacementSchema>;

export const blockUseSchema = z.strictObject({
  id: slug,
  use: z.string().min(1),
  at: atSchema,
  size: sizeSchema,
  with: z.record(z.string(), z.string()).optional(),
});
export type BlockUse = z.infer<typeof blockUseSchema>;
export type Placement = WidgetPlacement | BlockUse;

export const dashboardSchema = z.strictObject({
  id: slug,
  title: z.string(),
  theme: themeSchema.optional(),
  items: z.array(z.unknown()).default([]),
});

export const blockSchema = z.strictObject({
  params: z.record(z.string(), z.strictObject({ default: z.string().optional() })).optional(),
  items: z.array(z.unknown()).default([]),
});

export const mockFaultsSchema = z.strictObject({
  notFound: z.array(z.string()).optional(),
  errorKeys: z.array(z.string()).optional(),
  omitKeys: z.array(z.string()).optional(),
  extraKeys: z.array(z.string()).optional(),
  latencyMs: z.int().min(0).optional(),
  errorRate: z.number().min(0).max(1).optional(),
  /** Plugin-specific mock scenario (plugin API 1.1), passed through as `ctx.mockFaults.scenario`. */
  scenario: z.record(z.string(), z.unknown()).optional(),
});

export const pluginConfigSchema = z.strictObject({
  version: z
    .string({ error: 'Missing required field "version" (a semver range such as ^1.0.0)' })
    .refine((v) => semver.validRange(v) !== null, "Expected a semver range such as ^1.0.0"),
  settings: z.record(z.string(), z.unknown()).optional(),
  refreshInterval: duration.optional(),
  cacheWindow: duration.optional(),
  timeout: duration.optional(),
  mock: mockFaultsSchema.optional(),
});
export type PluginConfig = z.infer<typeof pluginConfigSchema>;

const include = z.array(z.string().min(1)).optional();

export const rootFileSchema = z.strictObject({
  version: z.literal(CONFIG_VERSION, {
    error: (iss) =>
      iss.input === undefined
        ? 'Missing required field "version"'
        : `Unsupported config version ${JSON.stringify(iss.input)}; supported versions: ${CONFIG_VERSION}`,
  }),
  include,
  defaults: z
    .strictObject({
      refreshInterval: duration.optional(),
      cacheWindow: duration.optional(),
      timeout: duration.optional(),
    })
    .optional(),
  theme: themeSchema.optional(),
  plugins: z.record(z.string(), z.unknown()).optional(),
  dashboards: z.array(z.unknown()).optional(),
  blocks: z.record(z.string(), z.unknown()).optional(),
});

export const includedFileSchema = z.strictObject({
  include,
  plugins: z.record(z.string(), z.unknown()).optional(),
  dashboards: z.array(z.unknown()).optional(),
  blocks: z.record(z.string(), z.unknown()).optional(),
});

/** The complete config shape, published as JSON Schema for editors (FR-013). */
export const publishedConfigSchema = rootFileSchema.extend({
  plugins: z.record(slug, pluginConfigSchema).optional(),
  dashboards: z
    .array(dashboardSchema.extend({ items: z.array(z.union([widgetPlacementSchema, blockUseSchema])) }))
    .optional(),
  blocks: z
    .record(z.string(), blockSchema.extend({ items: z.array(z.union([widgetPlacementSchema, blockUseSchema])) }))
    .optional(),
});

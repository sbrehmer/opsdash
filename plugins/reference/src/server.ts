import { createMockSource, definePlugin, secret, z } from "@opsdash/plugin-sdk";
import { type ReferenceItem, type ReferenceRef, simulatedBatchLookup } from "./source.ts";

const KEY = /^[A-Z]+-\d+$/;
const parse = (input: string) =>
  KEY.test(input.trim()) ? { ok: { key: input.trim() } } : { error: "Expected an item key like ITEM-123" };

const settings = z.strictObject({
  view: z.enum(["list", "compact"]).default("list"),
  items: z.array(z.string().regex(KEY, "Item keys look like ITEM-123")).default([]),
  apiToken: secret().optional(),
});

export default definePlugin({
  settings,
  reference: z.strictObject({ key: z.string().regex(KEY) }),
  refKey: (ref) => ref.key,
  needs: ({ settings, trackedRefs }) => [...settings.items.map((key) => ({ key })), ...trackedRefs],
  parseReference: (input) => parse(input),
  fetch: (refs, ctx) => simulatedBatchLookup(refs, ctx),
  mock: createMockSource<z.output<typeof settings>, ReferenceRef>({
    refKey: (ref) => ref.key,
    fromKey: (key) => ({ key }),
    parseReference: parse,
    generate: (ref, rng): ReferenceItem => ({
      key: ref.key,
      title:
        rng.pick(["Update", "Fix", "Review", "Refactor", "Document"]) +
        " " +
        rng.pick(["login flow", "billing export", "search index", "release notes", "alert rules"]),
      status: rng.pick(["open", "in-progress", "done"] as const),
      updatedAt: Date.now() - rng.int(1, 72) * 3_600_000,
    }),
  }),
});

import { definePlugin, type PluginContext, secret, z } from "@opsdash/plugin-sdk";
import { mock } from "./mock.ts";
import { parseJiraInput } from "./parse.ts";
import { fetchIssues } from "./source.ts";
import { type JiraSettings, KEY } from "./types.ts";

/** Resolver (API 1.1): the configured project keys, used by the tracker for story-key suggestions. */
const projectKeys = (_input: unknown, ctx: PluginContext<JiraSettings>) => ctx.settings.projectKeys ?? [];

const settings = z
  .strictObject({
    deployment: z.enum(["cloud", "datacenter"]),
    baseUrl: z.url(),
    email: z.string().optional(),
    token: secret(),
    projectKeys: z.array(z.string().regex(/^[A-Z][A-Z0-9_]+$/, "Project keys look like PROJ")).default([]),
  })
  .refine((s) => s.deployment !== "cloud" || Boolean(s.email), {
    message: "Jira Cloud needs the account email",
    path: ["email"],
  });

export default definePlugin({
  settings,
  reference: z.strictObject({ key: z.string().regex(KEY) }),
  refKey: (ref) => ref.key,
  batchKey: () => "default",
  parseReference: (input) => parseJiraInput(input),
  fetch: (refs, ctx) => fetchIssues(refs, ctx),
  mock: { ...mock, resolvers: { projectKeys } },
  resolvers: { projectKeys },
});

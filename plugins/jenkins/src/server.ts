import { definePlugin, secret, z } from "@opsdash/plugin-sdk";
import { mock } from "./mock.ts";
import { parseJenkinsInput } from "./parse.ts";
import { resolvers } from "./resolvers.ts";
import { fetchJobs } from "./source.ts";
import { parseDuration } from "./types.ts";

const settings = z.strictObject({
  baseUrl: z.url(),
  user: z.string(),
  token: secret(),
  pipelines: z.record(z.string(), z.string()).default({}),
  pipelineTemplate: z.string().default("{name}"),
  defaultOwner: z
    .string()
    .regex(/^[\w.-]+$/)
    .optional(),
  mainBranch: z.string().default("main"),
  runningRefreshInterval: z
    .string()
    .refine((s) => (parseDuration(s) ?? 0) > 0, 'Expected a duration like "10s", "5m" or "500ms"')
    .default("10s"),
});

export default definePlugin({
  settings,
  reference: z.strictObject({ pipeline: z.string().min(1), job: z.string().min(1) }),
  refKey: (ref) => `${ref.pipeline}/${ref.job}`,
  batchKey: (_settings, ref) => ref.pipeline,
  parseReference: (input) => parseJenkinsInput(input),
  fetch: (refs, ctx) => fetchJobs(refs, ctx),
  resolvers,
  mock,
});

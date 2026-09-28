import { definePlugin, secret, z } from "@opsdash/plugin-sdk";
import { mock } from "./mock.ts";
import { parseGithubInput } from "./parse.ts";
import { fetchPullRequests } from "./source.ts";
import { REPO, refKeyOf } from "./types.ts";

const settings = z.strictObject({
  apiUrl: z.url().default("https://api.github.com/graphql"),
  webUrl: z.url().default("https://github.com"),
  token: secret(),
  defaultRepo: z.string().regex(REPO, "Repositories look like owner/name").optional(),
});

export default definePlugin({
  settings,
  reference: z.strictObject({ repo: z.string().regex(REPO), number: z.int().min(1) }),
  refKey: refKeyOf,
  batchKey: () => "default",
  parseReference: (input, ctx) => parseGithubInput(input, ctx.settings.defaultRepo),
  fetch: (refs, ctx) => fetchPullRequests(refs, ctx),
  mock,
});

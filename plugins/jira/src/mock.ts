import { createMockSource } from "@opsdash/plugin-sdk";
import { parseJiraInput } from "./parse.ts";
import type { JiraIssue, JiraRef, JiraSettings, StatusCategory } from "./types.ts";

const STATUSES: Array<[string, StatusCategory]> = [
  ["To Do", "todo"],
  ["In Progress", "inprogress"],
  ["In Review", "inprogress"],
  ["Done", "done"],
];
const VERBS = ["Add", "Fix", "Improve", "Remove", "Document", "Speed up"];
const THINGS = [
  "checkout flow",
  "login rate limiting",
  "invoice export",
  "search ranking",
  "audit log",
  "onboarding email",
];
const PEOPLE = ["Ada Lovelace", "Grace Hopper", "Alan Turing", "Katherine Johnson", null];

/** Deterministic Jira mock; `mock.scenario.status[key]` overrides the seeded status. */
export const mock = createMockSource<JiraSettings, JiraRef>({
  refKey: (ref) => ref.key,
  fromKey: (key) => ({ key }),
  parseReference: parseJiraInput,
  generate: (ref, rng, ctx): JiraIssue => {
    let [status, category] = rng.pick(STATUSES);
    const override = (ctx.mockFaults.scenario?.status as Record<string, string> | undefined)?.[ref.key];
    if (override) {
      status = override;
      category = STATUSES.find(([s]) => s === override)?.[1] ?? "inprogress";
    }
    return {
      key: ref.key,
      url: `${ctx.settings.baseUrl.replace(/\/$/, "")}/browse/${ref.key}`,
      title: `${rng.pick(VERBS)} ${rng.pick(THINGS)}`,
      status,
      category,
      assignee: rng.pick(PEOPLE),
    };
  },
});

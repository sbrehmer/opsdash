import { createMockSource, type Source } from "@opsdash/plugin-sdk";
import { parseGithubInput } from "./parse.ts";
import { fromKey, type GithubPr, type GithubRef, type GithubSettings, type PrState, refKeyOf } from "./types.ts";

const VERBS = ["Add", "Fix", "Improve", "Remove", "Document", "Speed up"];
const THINGS = [
  "checkout flow",
  "login rate limiting",
  "invoice export",
  "search ranking",
  "audit log",
  "onboarding email",
];
const PEOPLE = ["ada", "grace", "alan", "katherine", "linus", "margaret"];
const STATES: PrState[] = ["open", "open", "open", "open", "draft"];
const REVIEWS: GithubPr["review"][] = ["approved", "review_required", "review_required", "changes_requested", null];
const CHECKS: GithubPr["checks"][] = ["success", "success", "pending", "failure", null];
const DAY = 86_400_000;

interface Scenario {
  merged?: string[];
  closed?: string[];
  draft?: string[];
  changesRequested?: string[];
  failingChecks?: string[];
  mergedAgoDays?: Record<string, number>;
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Deterministic GitHub mock (research R10). PR `owner/name#n` has the title `PROJ-<n mod 97>: …` and the branch
 * `feature/PROJ-<n mod 97>-…`; `mock.scenario` lists override the seeded state, review and checks.
 */
const base = createMockSource<GithubSettings, GithubRef>({
  refKey: refKeyOf,
  fromKey,
  parseReference: (input) => parseGithubInput(input),
  generate: (ref, rng, ctx): GithubPr => {
    const key = refKeyOf(ref);
    const scenario = (ctx.mockFaults.scenario ?? {}) as Scenario;
    const has = (list?: string[]) => Array.isArray(list) && list.includes(key);
    const story = `PROJ-${ref.number % 97}`;
    const summary = `${rng.pick(VERBS)} ${rng.pick(THINGS)}`;
    const author = rng.pick(PEOPLE);
    let state = rng.pick(STATES);
    let review = rng.pick(REVIEWS);
    let checks = rng.pick(CHECKS);
    const now = Date.now();
    const updatedAt = new Date(now - rng.int(1, 72) * 3_600_000).toISOString();
    let mergedAt: string | null = null;
    let closedAt: string | null = null;

    if (has(scenario.draft)) state = "draft";
    if (has(scenario.changesRequested)) review = "changes_requested";
    if (has(scenario.failingChecks)) checks = "failure";
    const agoDays = scenario.mergedAgoDays?.[key];
    if (has(scenario.merged) || typeof agoDays === "number") {
      state = "merged";
      mergedAt = new Date(now - (typeof agoDays === "number" ? agoDays : rng.int(1, 48) / 24) * DAY).toISOString();
      closedAt = mergedAt;
    } else if (has(scenario.closed)) {
      state = "closed";
      closedAt = new Date(now - rng.int(1, 48) * 3_600_000).toISOString();
    }
    if (state === "merged" && review === null) review = "approved";

    return {
      repo: ref.repo,
      number: ref.number,
      url: `${ctx.settings.webUrl.replace(/\/$/, "")}/${ref.repo}/pull/${ref.number}`,
      title: `${story}: ${summary}`,
      author,
      branch: `feature/${story}-${slug(summary)}`,
      state,
      review,
      checks,
      updatedAt,
      mergedAt,
      closedAt,
    };
  },
});

/** `#12` uses `settings.defaultRepo`, which the SDK mock's parser cannot see, so expand it first. */
export const mock: Source<GithubSettings, GithubRef> = {
  ...base,
  parseReference: (input, ctx) => {
    const text = input.trim();
    const expanded = /^#\d+$/.test(text) && ctx.settings.defaultRepo ? `${ctx.settings.defaultRepo}${text}` : text;
    return base.parseReference(expanded, ctx);
  },
};

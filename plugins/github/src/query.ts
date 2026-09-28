import type { ChecksState, GithubPr, GithubRef, PrState, ReviewState } from "./types.ts";

export const PR_FIELDS =
  "title url state isDraft author { login } reviewDecision headRefName mergedAt closedAt updatedAt " +
  "commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }";

/** One GraphQL query for all refs, aliased `p0`..`pN` in input order (research R7). */
export function buildPrQuery(refs: GithubRef[]): string {
  const parts = refs.map((ref, i) => {
    const [owner, name] = ref.repo.split("/");
    const number = Math.trunc(Number(ref.number));
    return `p${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequest(number: ${number}) { ${PR_FIELDS} } }`;
  });
  return `query {\n  ${parts.join("\n  ")}\n}`;
}

/** The raw GraphQL pull request node (fields from `PR_FIELDS`). */
export interface PrNode {
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED" | string;
  isDraft: boolean;
  author: { login: string } | null;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  headRefName: string;
  mergedAt: string | null;
  closedAt: string | null;
  updatedAt: string | null;
  commits?: { nodes?: Array<{ commit?: { statusCheckRollup?: { state?: string } | null } | null } | null> } | null;
}

function mapState(node: PrNode): PrState {
  if (node.state === "MERGED") return "merged";
  if (node.state === "CLOSED") return "closed";
  return node.isDraft ? "draft" : "open";
}

function mapChecks(state: string | undefined): ChecksState {
  switch (state) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
      return "failure";
    case "ERROR":
      return "error";
    case "PENDING":
    case "EXPECTED":
      return "pending";
    default:
      return null;
  }
}

/** Maps a GraphQL pull request node to the plugin's item data. */
export function mapPrNode(node: PrNode, ref: GithubRef): GithubPr {
  const rollup = node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state;
  return {
    repo: ref.repo,
    number: ref.number,
    url: node.url,
    title: node.title,
    author: node.author?.login ?? "ghost",
    branch: node.headRefName,
    state: mapState(node),
    review: (node.reviewDecision?.toLowerCase() ?? null) as ReviewState,
    checks: mapChecks(rollup),
    updatedAt: node.updatedAt ?? null,
    mergedAt: node.mergedAt ?? null,
    closedAt: node.closedAt ?? null,
  };
}

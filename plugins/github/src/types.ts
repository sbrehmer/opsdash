export interface GithubRef {
  repo: string;
  number: number;
}

export interface GithubSettings {
  apiUrl: string;
  webUrl: string;
  token: { env: string };
  defaultRepo?: string;
}

export type PrState = "draft" | "open" | "merged" | "closed";
export type ReviewState = "approved" | "changes_requested" | "review_required" | null;
export type ChecksState = "success" | "failure" | "pending" | "error" | null;

export interface GithubPr {
  repo: string;
  number: number;
  url: string;
  title: string;
  author: string;
  branch: string;
  state: PrState;
  review: ReviewState;
  checks: ChecksState;
  updatedAt: string | null;
  mergedAt: string | null;
  closedAt: string | null;
}

export const REPO = /^[\w.-]+\/[\w.-]+$/;

export const refKeyOf = (ref: GithubRef): string => `${ref.repo}#${ref.number}`;

export function fromKey(key: string): GithubRef {
  const i = key.lastIndexOf("#");
  return { repo: key.slice(0, i), number: Number(key.slice(i + 1)) };
}

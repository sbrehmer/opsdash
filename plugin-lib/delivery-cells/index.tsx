import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import css from "./cells.module.css";

// ---------------------------------------------------------------------------
// Live data types (data-model.md §Live data)
// ---------------------------------------------------------------------------

export type StoryCategory = "todo" | "inprogress" | "done";

export interface JiraIssue {
  key: string;
  url: string;
  title: string;
  status: string;
  category: StoryCategory;
  assignee: string | null;
}

export type PrState = "draft" | "open" | "merged" | "closed";
export type ReviewState = "approved" | "changes_requested" | "review_required";
export type ChecksState = "success" | "failure" | "pending" | "error";

export interface PullRequest {
  repo: string;
  number: number;
  url: string;
  title: string;
  author: string;
  branch: string;
  state: PrState;
  review: ReviewState | null;
  checks: ChecksState | null;
  updatedAt: string | null;
  mergedAt: string | null;
  closedAt: string | null;
}

export type BuildResult = "success" | "failure" | "unstable" | "aborted" | "not_built";

export interface JenkinsBuild {
  number: number;
  url: string;
  result: BuildResult | null;
  building: boolean;
  startedAt: number;
  durationMs: number;
  estimatedDurationMs: number;
}

export interface JenkinsMain {
  branch: string;
  lastSuccessAt: number | null;
  url: string | null;
}

export interface JenkinsJob {
  pipeline: string;
  job: string;
  url: string;
  exists: boolean;
  build: JenkinsBuild | null;
  main: JenkinsMain;
}

/** The parts of `WidgetItem` (@opsdash/plugin-sdk/client) the cells read. */
export interface CellItem<Data> {
  refKey: string;
  data?: Data;
  error?: string;
  state?: "ok" | "stale" | "error" | "timeout" | "loading";
  lastSuccessAt?: number;
}

// ---------------------------------------------------------------------------
// Labels and tones (FR-023: every status has a text label as well as a colour)
// ---------------------------------------------------------------------------

export type Tone = "ok" | "warn" | "error" | "accent" | "muted";

export const storyCategoryTone: Record<StoryCategory, Tone> = { todo: "muted", inprogress: "accent", done: "ok" };
export const storyCategoryLabel: Record<StoryCategory, string> = {
  todo: "to do",
  inprogress: "in progress",
  done: "done",
};

export const prStateLabel: Record<PrState, [string, Tone]> = {
  draft: ["draft", "muted"],
  open: ["open", "ok"],
  merged: ["merged", "accent"],
  closed: ["closed", "error"],
};

export const reviewLabel: Record<ReviewState, [string, Tone]> = {
  approved: ["approved", "ok"],
  changes_requested: ["changes requested", "error"],
  review_required: ["review required", "warn"],
};

export const checksLabel: Record<ChecksState, [string, Tone]> = {
  success: ["checks passed", "ok"],
  failure: ["checks failed", "error"],
  pending: ["checks running", "warn"],
  error: ["checks errored", "error"],
};

export const buildResultLabel: Record<BuildResult, [string, Tone]> = {
  success: ["succeeded", "ok"],
  failure: ["failed", "error"],
  unstable: ["unstable", "warn"],
  aborted: ["aborted", "muted"],
  not_built: ["not built", "muted"],
};

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** "just now", "45 s ago", "3 min ago", "2 h ago", "4 d ago" (or "in …" for future times). */
export function formatRelative(at: number, now = Date.now()): string {
  const diff = now - at;
  const s = Math.round(Math.abs(diff) / 1000);
  if (s < 5) return "just now";
  let text: string;
  if (s < 60) text = `${s} s`;
  else if (s < 3600) text = `${Math.round(s / 60)} min`;
  else if (s < 86400) text = `${Math.round(s / 3600)} h`;
  else text = `${Math.round(s / 86400)} d`;
  return diff >= 0 ? `${text} ago` : `in ${text}`;
}

/** Rough remaining-time text: "<1 min", "3 min", "1 h 5 min". */
export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return "<1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Estimated progress of a running build; `percent` may exceed 100. */
export function buildProgress(build: JenkinsBuild, now = Date.now()): { percent: number; remainingMs: number } | null {
  if (!(build.estimatedDurationMs > 0)) return null;
  const elapsed = Math.max(0, now - build.startedAt);
  return {
    percent: Math.floor((elapsed / build.estimatedDurationMs) * 100),
    remainingMs: build.estimatedDurationMs - elapsed,
  };
}

/** Current time, re-read every `intervalMs` while `active`. */
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, active]);
  return now;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Relative time with the exact date and time on hover or focus (FR-023). */
export function RelativeTime({ at }: { at: number }) {
  const now = useNow(30_000);
  const date = new Date(at);
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so the exact time shows on focus (FR-023)
    <time class={css.time} dateTime={date.toISOString()} title={date.toLocaleString()} tabIndex={0}>
      {formatRelative(at, now)}
    </time>
  );
}

const toneClass: Record<Tone, string | undefined> = {
  ok: css.toneOk,
  warn: css.toneWarn,
  error: css.toneError,
  accent: css.toneAccent,
  muted: css.toneMuted,
};

/** A text status label with a colour dot; the colour is never the only signal (FR-023). */
export function StatusLabel({ label, tone = "muted" }: { label: string; tone?: Tone }) {
  return (
    <span class={`${css.status} ${toneClass[tone] ?? ""}`}>
      <span class={css.dot} aria-hidden="true" />
      {label}
    </span>
  );
}

export function ProgressBar({ percent, label, text }: { percent: number; label: string; text: string }) {
  return (
    <span class={css.progress}>
      <progress class={css.bar} max={100} value={Math.min(100, Math.max(0, percent))} aria-label={label} />
      <span class={css.progressText}>{text}</span>
    </span>
  );
}

export function ErrorCell({ error, state }: { error?: string; state?: string }) {
  const text = error ?? (state === "timeout" ? "The source did not respond in time." : "Could not load.");
  return (
    <span class={`${css.cell} ${css.errorCell}`}>
      <StatusLabel label="error" tone="error" /> <span class={css.errorText}>{text}</span>
    </span>
  );
}

function StaleBadge({ item }: { item: CellItem<unknown> }) {
  return (
    <span class={css.badge} title={item.error}>
      stale
      {item.lastSuccessAt ? (
        <>
          {" · "}
          <RelativeTime at={item.lastSuccessAt} />
        </>
      ) : null}
    </span>
  );
}

function ExtLink({ href, class: cls, children }: { href: string; class?: string; children: ComponentChildren }) {
  return (
    <a class={`${css.link} ${cls ?? ""}`} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/**
 * Common frame: error cell when there is no data, a loading line while pending, and a stale badge
 * when the data is older than the last refresh (per-item freshness).
 */
function Cell<D>({ item, children }: { item: CellItem<D>; children: (data: D) => ComponentChildren }) {
  const failed = item.error !== undefined || item.state === "error" || item.state === "timeout";
  if (item.data === undefined || item.data === null) {
    if (failed) return <ErrorCell error={item.error} state={item.state} />;
    return (
      <span class={css.cell}>
        <span class={css.muted}>{item.refKey} · loading…</span>
      </span>
    );
  }
  return (
    <span class={css.cell}>
      {children(item.data)}
      {(item.state === "stale" || failed) && <StaleBadge item={item} />}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

export function StoryCell({ item }: { item: CellItem<JiraIssue> }) {
  return (
    <Cell item={item}>
      {(d) => (
        <>
          <span class={css.line}>
            <ExtLink href={d.url} class={css.key}>
              {d.key}
            </ExtLink>
            <span class={css.title} title={d.title}>
              {d.title}
            </span>
          </span>
          <span class={css.meta}>
            <StatusLabel label={d.status} tone={storyCategoryTone[d.category] ?? "muted"} />
            <span class={css.muted}>{d.assignee ?? "unassigned"}</span>
          </span>
        </>
      )}
    </Cell>
  );
}

export function PrCell({ item }: { item: CellItem<PullRequest> }) {
  return (
    <Cell item={item}>
      {(d) => {
        const [stateText, stateTone] = prStateLabel[d.state] ?? [d.state, "muted"];
        const review = d.review ? reviewLabel[d.review] : undefined;
        const checks = d.checks ? checksLabel[d.checks] : undefined;
        return (
          <>
            <span class={css.line}>
              <ExtLink href={d.url} class={css.key}>
                {d.repo}#{d.number}
              </ExtLink>
              <span class={css.title} title={d.title}>
                {d.title}
              </span>
            </span>
            <span class={css.meta}>
              <StatusLabel label={stateText} tone={stateTone} />
              {review && <StatusLabel label={review[0]} tone={review[1]} />}
              {checks && <StatusLabel label={checks[0]} tone={checks[1]} />}
              <span class={css.muted}>{d.author}</span>
            </span>
          </>
        );
      }}
    </Cell>
  );
}

function RunningBuild({ build }: { build: JenkinsBuild }) {
  const now = useNow(1000);
  const p = buildProgress(build, now);
  if (!p) return <StatusLabel label="running" tone="accent" />;
  if (p.percent > 100) return <ProgressBar percent={100} label="Build progress" text="running, over estimate" />;
  return (
    <ProgressBar
      percent={p.percent}
      label="Build progress"
      text={`running · ${p.percent}% · ~${formatDuration(p.remainingMs)} left`}
    />
  );
}

export function BuildCell({ item, prState }: { item: CellItem<JenkinsJob>; prState?: PrState }) {
  return (
    <Cell item={item}>
      {(d) => {
        const b = d.build;
        let status: ComponentChildren;
        if (d.exists === false) {
          status =
            prState === undefined || prState === "open" || prState === "draft" ? (
              <span class={css.muted}>waiting for first build</span>
            ) : (
              <span class={css.muted}>job no longer exists</span>
            );
        } else if (!b) {
          status = <span class={css.muted}>waiting for first build</span>;
        } else if (b.building) {
          status = <RunningBuild build={b} />;
        } else {
          const [text, tone] = b.result ? (buildResultLabel[b.result] ?? [b.result, "muted"]) : ["no result", "muted"];
          status = (
            <>
              <StatusLabel label={text} tone={tone as Tone} />
              <RelativeTime at={b.startedAt + b.durationMs} />
            </>
          );
        }
        return (
          <>
            <span class={css.line}>
              <ExtLink href={d.url} class={css.key}>
                {d.pipeline}/{d.job}
              </ExtLink>
              {b && d.exists !== false && (
                <ExtLink href={b.url} class={css.muted}>
                  #{b.number}
                </ExtLink>
              )}
            </span>
            <span class={css.meta}>{status}</span>
          </>
        );
      }}
    </Cell>
  );
}

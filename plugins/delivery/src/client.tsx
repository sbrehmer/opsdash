import type { CellItem, JenkinsJob, JiraIssue, PullRequest } from "@opsdash/delivery-cells";
import { BuildCell, PrCell, RelativeTime, StoryCell } from "@opsdash/delivery-cells";
import { defineWidget, type WidgetProps } from "@opsdash/plugin-sdk/client";
import { useState } from "preact/hooks";
import { buildRows, groupRows, type Item, isDone, type Row, sortRows, storyKeys } from "./rows.ts";
import css from "./tracker.module.css";

interface Settings {
  retention?: string;
  storyProjects?: string[];
}
type Props = WidgetProps<Settings>;
type Run = Props["actions"]["run"];
type Meta = { dismissed?: Record<string, string[]>; storyProjects?: string[] } | undefined;

/** Runs an action and reports its error sentence (or `undefined` on success). */
async function call(run: Run, name: string, payload: unknown): Promise<string | undefined> {
  try {
    const result = await run(name, payload);
    return "error" in result ? result.error : undefined;
  } catch (err) {
    return (err as Error).message || "The action failed.";
  }
}

function useAction(run: Run) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const go = async (name: string, payload: unknown): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    const err = await call(run, name, payload);
    setBusy(false);
    setError(err);
    return err === undefined;
  };
  return { busy, error, go, clear: () => setError(undefined) };
}

function AddForm({ run }: { run: Run }) {
  const { busy, error, go } = useAction(run);
  const [pr, setPr] = useState("");
  const [job, setJob] = useState("");
  const [story, setStory] = useState("");
  const submit = async (e: Event) => {
    e.preventDefault();
    const payload = { pr: pr.trim() || undefined, job: job.trim() || undefined, story: story.trim() || undefined };
    if (await go("addRow", payload)) {
      setPr("");
      setJob("");
      setStory("");
    }
  };
  const input = (label: string, value: string, set: (v: string) => void, placeholder: string) => (
    <label class={css.field}>
      <span class={css.label}>{label}</span>
      <input
        class={css.input}
        value={value}
        placeholder={placeholder}
        onInput={(e) => set((e.currentTarget as HTMLInputElement).value)}
      />
    </label>
  );
  return (
    <form class={css.add} onSubmit={submit}>
      {/* Same order as the table columns: Story | Pull request | Build | (actions) */}
      {input("Story (optional)", story, setStory, "PROJ-12")}
      {input("Pull request", pr, setPr, "owner/repo#123")}
      {input("Build job", job, setJob, "folder/pipeline/PR-123")}
      <button class={css.primary} type="submit" disabled={busy}>
        Add
      </button>
      {error && (
        <p class={css.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** A one-field inline form used by the row menu (change story, set job) and "+ Story". */
function InlineForm(props: {
  label: string;
  placeholder: string;
  busy: boolean;
  onSubmit(value: string): void;
  onCancel(): void;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      class={css.inline}
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit(value.trim());
      }}
    >
      <label class={css.field}>
        <span class="od-visually-hidden">{props.label}</span>
        <input
          class={css.input}
          value={value}
          placeholder={props.placeholder}
          aria-label={props.label}
          onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <button class={css.button} type="submit" disabled={props.busy}>
        Save
      </button>
      <button class={css.button} type="button" onClick={props.onCancel}>
        Cancel
      </button>
    </form>
  );
}

function TrackerRow({
  row,
  run,
  settings,
  dismissed,
}: {
  row: Row;
  run: Run;
  settings: Settings;
  dismissed: string[];
}) {
  const { busy, error, go, clear } = useAction(run);
  const [editing, setEditing] = useState<"story" | "job">();
  const pr = row.pr.refKey;
  const act = async (name: string, extra: Record<string, string> = {}) => {
    if (await go(name, { pr, ...extra })) setEditing(undefined);
  };
  const suggestion = row.story
    ? undefined
    : storyKeys(row.pr.data?.title, row.pr.data?.branch, settings.storyProjects).find((k) => !dismissed.includes(k));
  const cancel = () => {
    setEditing(undefined);
    clear();
  };

  let storyCell = row.story ? <StoryCell item={row.story as CellItem<JiraIssue>} /> : null;
  if (editing === "story") {
    storyCell = (
      <InlineForm
        label="Story"
        placeholder="PROJ-12"
        busy={busy}
        onSubmit={(story) => act("setStory", { story })}
        onCancel={cancel}
      />
    );
  } else if (!row.story) {
    storyCell = suggestion ? (
      <span class={css.suggest}>
        <button
          class={css.button}
          type="button"
          disabled={busy}
          onClick={() => act("linkSuggestion", { story: suggestion })}
        >
          Link {suggestion}
        </button>
        <button
          class={css.quiet}
          type="button"
          disabled={busy}
          aria-label={`Dismiss suggestion ${suggestion}`}
          onClick={() => act("dismissSuggestion", { story: suggestion })}
        >
          Dismiss
        </button>
      </span>
    ) : (
      <button class={css.quiet} type="button" onClick={() => setEditing("story")}>
        + Story
      </button>
    );
  }

  const buildCell =
    editing === "job" ? (
      <InlineForm
        label="Build job"
        placeholder="folder/pipeline/PR-123"
        busy={busy}
        onSubmit={(job) => act("setJob", { job })}
        onCancel={cancel}
      />
    ) : row.job ? (
      <BuildCell item={row.job as CellItem<JenkinsJob>} prState={row.pr.data?.state} />
    ) : (
      <span class={css.muted}>no build job</span>
    );

  const menu = (label: string, onClick: () => void) => (
    <li>
      <button
        class={css.menuItem}
        type="button"
        disabled={busy}
        onClick={(e) => {
          (e.currentTarget as HTMLElement).closest("details")?.removeAttribute("open");
          onClick();
        }}
      >
        {label}
      </button>
    </li>
  );

  return (
    <tr class={css.row}>
      <td class={css.cell} data-label="Story">
        {storyCell}
      </td>
      <td class={css.cell} data-label="Pull request">
        <PrCell item={row.pr as CellItem<PullRequest>} />
      </td>
      <td class={css.cell} data-label="Build">
        {buildCell}
      </td>
      <td class={css.actions}>
        <details class={css.menu}>
          <summary class={css.menuButton} aria-label={`Actions for ${pr}`}>
            ⋯
          </summary>
          <ul class={css.menuList}>
            {menu(row.story ? "Change story" : "Set story", () => setEditing("story"))}
            {row.story && menu("Remove story", () => act("removeStory"))}
            {menu("Re-infer job", () => act("reinferJob"))}
            {menu("Set job", () => setEditing("job"))}
            {menu("Remove row", () => act("removeRow"))}
          </ul>
        </details>
        {error && (
          <p class={css.error} role="alert">
            {error}
          </p>
        )}
      </td>
    </tr>
  );
}

/** "main: last success …" for a repository group, from any row's job data. */
function MainStatus({ rows }: { rows: Row[] }) {
  const main = rows.map((r) => r.job?.data?.main).find((m) => m !== undefined);
  if (!main) return null;
  if (main.lastSuccessAt === null) return <span class={css.muted}>{main.branch}: no successful build</span>;
  const text = (
    <>
      {main.branch}: last success <RelativeTime at={main.lastSuccessAt} />
    </>
  );
  return main.url ? (
    <a class={css.mainLink} href={main.url} target="_blank" rel="noopener noreferrer">
      {text}
    </a>
  ) : (
    <span class={css.muted}>{text}</span>
  );
}

const repoUrl = (row: Row): string | undefined => row.pr.data?.url?.replace(/\/pull\/\d+$/, "");

function Head() {
  return (
    <thead>
      <tr>
        <th scope="col">Story</th>
        <th scope="col">Pull request</th>
        <th scope="col">Build</th>
        <th scope="col">
          <span class="od-visually-hidden">Actions</span>
        </th>
      </tr>
    </thead>
  );
}

function Tracker({ items, links, meta, settings, actions }: Props) {
  const rows = buildRows(items as Item[], links ?? []);
  const dismissed = (meta as Meta)?.dismissed ?? {};
  const active = rows.filter((r) => !isDone(r));
  const done = sortRows(rows.filter(isDone));
  const rowProps = (row: Row) => ({
    row,
    run: actions.run,
    // Widget setting wins; otherwise the Jira plugin's projectKeys (from onData meta).
    settings: { ...settings, storyProjects: settings?.storyProjects ?? (meta as Meta)?.storyProjects },
    dismissed: dismissed[row.pr.refKey] ?? [],
  });
  return (
    <div class={css.root}>
      <AddForm run={actions.run} />
      {active.length > 0 ? (
        <table class={css.table}>
          <Head />
          {groupRows(active).map((g) => {
            const url = g.rows.map(repoUrl).find(Boolean);
            return (
              <tbody key={g.repo} class={css.group}>
                <tr class={css.groupHead}>
                  <th colSpan={4} scope="colgroup">
                    {url ? (
                      <a class={css.repo} href={url} target="_blank" rel="noopener noreferrer">
                        {g.repo}
                      </a>
                    ) : (
                      <span class={css.repo}>{g.repo}</span>
                    )}{" "}
                    <MainStatus rows={g.rows} />
                  </th>
                </tr>
                {g.rows.map((row) => (
                  <TrackerRow key={row.pr.refKey} {...rowProps(row)} />
                ))}
              </tbody>
            );
          })}
        </table>
      ) : (
        <p class={css.muted}>No open changes tracked. Add a pull request or build job above.</p>
      )}
      {done.length > 0 && (
        <details class={css.done}>
          <summary>Done ({done.length})</summary>
          <table class={css.table}>
            <Head />
            <tbody>
              {done.map((row) => (
                <TrackerRow key={row.pr.refKey} {...rowProps(row)} />
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

export default defineWidget<Settings>({ render: Tracker, handlesStates: ["empty"] });

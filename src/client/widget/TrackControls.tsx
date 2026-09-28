import { useEffect, useRef, useState } from "preact/hooks";
import { widgetUrl } from "../api.ts";
import css from "./widget.module.css";

/** Track / untrack panel: data entry, the only input the UI accepts (FR-012, FR-032). */
export function TrackPanel({ path, onClose }: { path: string; onClose(): void }) {
  const [input, setInput] = useState("");
  const [message, setMessage] = useState<string>();
  const [tracked, setTracked] = useState<Array<{ refKey: string; plugin?: string }>>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = `track-${path.replace(/[^a-zA-Z0-9-]/g, "-")}`;

  const refresh = async () => {
    const res = await fetch(widgetUrl(path));
    if (res.ok)
      setTracked(
        ((await res.json()) as Array<{ refKey: string; plugin?: string }>).map((r) => ({
          refKey: r.refKey,
          plugin: r.plugin,
        })),
      );
  };

  useEffect(() => {
    void refresh();
    inputRef.current?.focus();
  }, [path]);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setMessage(undefined);
    const res = await fetch(widgetUrl(path), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input }),
    });
    setBusy(false);
    if (res.status === 201) {
      setInput("");
      await refresh();
    } else {
      setMessage(
        ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Could not track (${res.status})`,
      );
    }
  };

  const untrack = async (refKey: string, plugin?: string) => {
    const query = plugin ? `?plugin=${encodeURIComponent(plugin)}` : "";
    const res = await fetch(`${widgetUrl(path)}/${encodeURIComponent(refKey)}${query}`, { method: "DELETE" });
    if (res.ok) await refresh();
  };

  return (
    <div class={css.track}>
      <form class={css.trackRow} onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <label class="od-visually-hidden" for={inputId}>
          Item to track
        </label>
        <input
          ref={inputRef}
          id={inputId}
          class={css.input}
          value={input}
          placeholder="Item identifier"
          autocomplete="off"
          aria-invalid={message ? "true" : undefined}
          aria-describedby={message ? `${inputId}-msg` : undefined}
          onInput={(e) => setInput((e.target as HTMLInputElement).value)}
        />
        <button class={css.iconButton} type="submit" disabled={busy || input.trim() === ""}>
          Track
        </button>
      </form>
      {message && (
        <p id={`${inputId}-msg`} class={css.message} role="alert">
          {message}
        </p>
      )}
      {tracked.length > 0 && (
        <ul class={css.tracked} aria-label="Tracked items">
          {tracked.map(({ refKey: key, plugin }) => (
            <li key={`${plugin ?? ""}:${key}`} class={css.chip}>
              {key}
              <button type="button" aria-label={`Untrack ${key}`} onClick={() => untrack(key, plugin)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

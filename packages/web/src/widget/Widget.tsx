import type { WidgetDefinition } from "@opsdash/plugin-sdk/client";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { type ResolvedItem, runAction } from "../api.ts";
import { loadWidget, pluginRevisions } from "../live/plugins.ts";
import { widgetSignal } from "../live/store.ts";
import { Boundary } from "./Boundary.tsx";
import { Frame } from "./Frame.tsx";
import { Placeholder } from "./Placeholder.tsx";
import { DefaultState, StaleNotice } from "./states.tsx";
import { TrackPanel } from "./TrackControls.tsx";
import css from "./widget.module.css";

type WidgetItem = Extract<ResolvedItem, { kind: "widget" }>;

export function Widget({ item }: { item: WidgetItem }) {
  const data = widgetSignal(item.path).value;
  const [def, setDef] = useState<WidgetDefinition>();
  const [loadError, setLoadError] = useState<string>();
  const [tracking, setTracking] = useState(false);
  const clientUrl = pluginRevisions.value[item.pluginId] ?? item.clientUrl;
  const actions = useMemo(
    () => ({ run: (name: string, payload?: unknown) => runAction(item.path, name, payload) }),
    [item.path],
  );

  useEffect(() => {
    if (item.status !== "ok" || !clientUrl) return;
    let live = true;
    loadWidget(item.pluginId, clientUrl, item.styleUrl).then(
      (d) => {
        if (!live) return;
        setDef(() => d);
        setLoadError(undefined);
      },
      (err: Error) => live && setLoadError(`Widget code failed to load: ${err.message}`),
    );
    return () => {
      live = false;
    };
  }, [item.pluginId, clientUrl, item.styleUrl, item.status]);

  if (item.status !== "ok") {
    return (
      <Frame id={item.path} title={item.title} placeholder>
        {item.placeholder ? (
          <Placeholder {...item.placeholder} />
        ) : (
          <DefaultState state="error" error="Invalid configuration" />
        )}
      </Frame>
    );
  }

  const controls = item.trackable ? (
    <button
      type="button"
      class={css.iconButton}
      aria-expanded={tracking}
      aria-label={tracking ? "Close tracking" : `Track item in ${item.title ?? item.path}`}
      onClick={() => setTracking(!tracking)}
    >
      {tracking ? "Done" : "+ Track"}
    </button>
  ) : undefined;

  const state = data?.state ?? "loading";
  const Render = def?.render;
  const handles = def?.handlesStates ?? [];
  let body: ComponentChildren;
  if (loadError) body = <DefaultState state="error" error={loadError} />;
  else if (!Render || (state !== "ok" && state !== "stale" && !handles.includes(state)))
    body = <DefaultState state={Render ? state : "loading"} error={data?.error} />;
  else {
    body = (
      <>
        {state === "stale" && !handles.includes("stale") && (
          <StaleNotice lastSuccessAt={data?.lastSuccessAt} error={data?.error} />
        )}
        <Render
          items={data?.items ?? []}
          state={state}
          lastSuccessAt={data?.lastSuccessAt}
          error={data?.error}
          settings={item.settings}
          title={item.title}
          links={data?.links}
          meta={data?.meta}
          actions={actions}
        />
      </>
    );
  }

  return (
    <Frame id={item.path} title={item.title} controls={controls} controlsOpen={tracking}>
      {tracking && <TrackPanel path={item.path} onClose={() => setTracking(false)} />}
      <Boundary resetKey={clientUrl}>{body}</Boundary>
    </Frame>
  );
}

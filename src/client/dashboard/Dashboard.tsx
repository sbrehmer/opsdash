import { useEffect, useState } from "preact/hooks";
import type { ResolvedDashboard } from "../../shared/api-types.ts";
import { getJson } from "../api.ts";
import { Grid } from "../grid/Grid.tsx";
import { pluginReloaded } from "../live/plugins.ts";
import { connect } from "../live/store.ts";
import { applyTheme } from "../theme/apply.ts";
import { Widget } from "../widget/Widget.tsx";
import { Errors } from "./Errors.tsx";

export function Dashboard({ id, onListChanged }: { id: string; onListChanged(): void }) {
  const [dashboard, setDashboard] = useState<ResolvedDashboard>();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      getJson<ResolvedDashboard>(`/api/dashboards/${encodeURIComponent(id)}`).then(
        (d) => {
          if (!live) return;
          setDashboard(d);
          setMissing(false);
          applyTheme(d.theme);
          document.title = `${d.title} · Opsdash`;
        },
        () => live && setMissing(true),
      );
    void load();
    const disconnect = connect(id, {
      onDashboardChanged: (changed) => changed === id && void load(),
      onDashboardsChanged: onListChanged,
      onPluginReloaded: pluginReloaded,
    });
    return () => {
      live = false;
      disconnect();
    };
  }, [id]);

  if (missing) return <p>Dashboard “{id}” no longer exists.</p>;
  if (!dashboard) return null;
  if (dashboard.errors.length > 0) return <Errors errors={dashboard.errors} />;
  return <Grid items={dashboard.items} renderWidget={(item) => <Widget item={item} />} />;
}

import { useEffect, useState } from "preact/hooks";
import { type DashboardSummary, getJson, type Meta } from "./api.ts";
import css from "./app.module.css";
import { Dashboard } from "./dashboard/Dashboard.tsx";
import dcss from "./dashboard/dashboard.module.css";

const currentRoute = () => decodeURIComponent(location.hash.replace(/^#\/?/, ""));

export function App() {
  const [meta, setMeta] = useState<Meta>();
  const [list, setList] = useState<DashboardSummary[]>();
  const [route, setRoute] = useState(currentRoute());

  const loadList = () => getJson<DashboardSummary[]>("/api/dashboards").then(setList, () => setList([]));

  useEffect(() => {
    void getJson<Meta>("/api/meta").then(setMeta);
    void loadList();
    const onHash = () => setRoute(currentRoute());
    addEventListener("hashchange", onHash);
    onHash(); // the hash may have changed between first render and this effect
    return () => removeEventListener("hashchange", onHash);
  }, []);

  // With no dashboard open there is no event stream, so poll for newly configured dashboards.
  useEffect(() => {
    if (list?.length !== 0) return;
    const t = setInterval(loadList, 3000);
    return () => clearInterval(t);
  }, [list?.length]);

  const active = list?.find((d) => d.id === route) ?? list?.[0];

  return (
    <div class={css.shell}>
      <header class={css.bar}>
        <p class={css.brand}>Opsdash</p>
        {list && list.length > 0 && (
          <nav class={css.nav} aria-label="Dashboards">
            {list.map((d) => (
              <a
                key={d.id}
                href={`#/${d.id}`}
                class={`${css.tab} ${d.status === "invalid" ? css.tabInvalid : ""}`}
                aria-current={active?.id === d.id ? "page" : undefined}
                title={d.status === "invalid" ? `${d.errorCount} configuration error(s)` : undefined}
              >
                {d.title}
              </a>
            ))}
          </nav>
        )}
        {meta?.mock && (
          <span class={css.badge} role="status" data-testid="mock-badge">
            Mock mode
          </span>
        )}
      </header>
      <main class={css.main}>
        <h1 class="od-visually-hidden">{active?.title ?? "Opsdash"}</h1>
        {list && list.length === 0 && (
          <div class={dcss.empty}>
            <p>No dashboards are configured yet.</p>
            <p>
              Create <code>opsdash.yaml</code> in the config directory Opsdash was started with (<code>--config</code>).
              It is picked up automatically.
            </p>
          </div>
        )}
        {active && <Dashboard key={active.id} id={active.id} onListChanged={loadList} />}
      </main>
    </div>
  );
}

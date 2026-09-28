import { render } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { cellStyle, Grid } from "../../../src/client/grid/Grid.tsx";
import { applyTheme } from "../../../src/client/theme/apply.ts";
import type { ResolvedItem } from "../../../src/shared/api-types.ts";

const widget = (path: string, at: [number, number], size: [number, number]): ResolvedItem => ({
  kind: "widget",
  path,
  at,
  size,
  pluginId: "reference",
  trackable: false,
  status: "ok",
  settings: {},
});

describe("grid (FR-002b)", () => {
  it("maps placements to grid areas", () => {
    expect(cellStyle([7, 2], [6, 4])).toEqual({ "--col": "7", "--row": "2", "--w": "6", "--h": "4", "--order": "207" });
  });

  it("orders cells row-then-column for the single-column layout", () => {
    const items = [widget("d/c", [7, 1], [6, 2]), widget("d/a", [1, 3], [12, 2]), widget("d/b", [1, 1], [6, 2])];
    const order = items
      .map((i) => [i.kind === "widget" ? i.path : "", Number(cellStyle(i.at, i.size)["--order"])] as const)
      .sort((x, y) => x[1] - y[1])
      .map(([p]) => p);
    expect(order).toEqual(["d/b", "d/c", "d/a"]);
  });

  it("renders block uses as nested grids", () => {
    const items: ResolvedItem[] = [
      { kind: "block", id: "team", at: [1, 1], size: [12, 3], items: [widget("d/team/w", [1, 1], [12, 3])] },
    ];
    const { getByTestId } = render(<Grid items={items} renderWidget={(w) => <span>{w.path}</span>} />);
    const block = getByTestId("block-team");
    expect(block.style.getPropertyValue("--w")).toBe("12");
    expect(block.querySelector('[data-testid="cell-d/team/w"]')?.textContent).toBe("d/team/w");
  });
});

describe("theme (FR-037, FR-038)", () => {
  it("sets the mode and writes token overrides", () => {
    applyTheme({ mode: "dark", tokens: { "color-accent": "#ff0000" }, tokensLight: {}, tokensDark: { radius: "4px" } });
    expect(document.documentElement.dataset.theme).toBe("dark");
    const css = document.getElementById("od-theme-overrides")!.textContent!;
    expect(css).toContain(":root[data-theme] { --od-color-accent: #ff0000; }");
    expect(css).toContain(':root[data-theme="dark"] { --od-radius: 4px; }');
  });
});

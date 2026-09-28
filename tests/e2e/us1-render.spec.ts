import { expect, test } from "@playwright/test";
import { openDashboard, widget, withConfig } from "./util.ts";

test.describe("US1: config-defined dashboard", () => {
  test("renders widgets at their configured grid positions", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "grid geometry is checked at desktop width");
    await openDashboard(page, "overview");
    const open = (await page.getByTestId("cell-overview/open-items").boundingBox())!;
    const recent = (await page.getByTestId("cell-overview/recent").boundingBox())!;
    const watch = (await page.getByTestId("cell-overview/watchlist").boundingBox())!;
    expect(Math.abs(open.y - recent.y)).toBeLessThan(1); // same row
    expect(recent.x).toBeGreaterThan(open.x + open.width - 1); // columns 7-12 right of 1-6
    expect(Math.abs(open.width - recent.width)).toBeLessThan(1); // both 6 wide
    expect(watch.y).toBeGreaterThan(open.y + open.height - 1); // row 5 below rows 1-4
    await expect(widget(page, "overview/open-items")).toContainText("ITEM-1");
    await expect(widget(page, "overview/team-a/items")).toContainText("Team A items");
  });

  test("stacks widgets in one column on narrow screens", async ({ page }, info) => {
    test.skip(info.project.name !== "phone");
    await openDashboard(page, "overview");
    const open = (await page.getByTestId("cell-overview/open-items").boundingBox())!;
    const recent = (await page.getByTestId("cell-overview/recent").boundingBox())!;
    expect(Math.abs(open.x - recent.x)).toBeLessThan(1);
    expect(recent.y).toBeGreaterThan(open.y);
  });

  test("navigates between dashboards and applies each theme", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop");
    await openDashboard(page, "overview");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
    await page.getByRole("link", { name: "Details" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(widget(page, "details/everything")).toContainText("ITEM-6");
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--od-color-accent").trim(),
    );
    expect(accent).toBe("#7c9cff"); // tokens-dark override
  });

  test("picks up config edits without a restart (SC-007)", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop");
    await openDashboard(page, "overview");
    await withConfig(
      page,
      (y) => y.replace("  mode: system", "  mode: light").replace('color-accent: "#3b5bdb"', 'color-accent: "#aa3377"'),
      async () => {
        await expect(page.locator("html")).toHaveAttribute("data-theme", "light", { timeout: 3000 });
        await expect
          .poll(() =>
            page.evaluate(() =>
              getComputedStyle(document.documentElement).getPropertyValue("--od-color-accent").trim(),
            ),
          )
          .toBe("#aa3377");
      },
    );
  });

  test("shows the mock badge and no configuration editors", async ({ page }) => {
    await openDashboard(page, "overview");
    await expect(page.getByTestId("mock-badge")).toHaveText("Mock mode");
    await expect(page.locator("input, textarea, select")).toHaveCount(0);
  });
});

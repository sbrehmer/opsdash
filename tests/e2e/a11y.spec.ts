import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openDashboard, seedDeliveryRows, withConfig } from "./util.ts";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// The Delivery dashboard is checked with rows in it (tracked items are data, seeded through the actions API).
test.beforeAll(async () => {
  await seedDeliveryRows(8, { repos: 2, from: 1400 });
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`WCAG 2.2 AA in ${scheme} (SC-010)`, () => {
    test.use({ colorScheme: scheme });

    for (const id of ["overview", "team", "details", "delivery"]) {
      test(`${id} dashboard`, async ({ page }) => {
        await openDashboard(page, id);
        await expect(page.locator('[role="status"][aria-label="Loading"]')).toHaveCount(0);
        await expect(page.getByText("loading…")).toHaveCount(0);
        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }

    test("error view", async ({ page }) => {
      await withConfig(
        page,
        (y) => y.replace("size: [12, 5]", "size: [14, 5]"),
        async () => {
          await page.goto("/#/details");
          await expect(page.getByRole("alert")).toContainText(/grid has 12 columns/i, { timeout: 3000 });
          const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
          expect(results.violations.map((v) => v.id)).toEqual([]);
        },
      );
    });
  });
}

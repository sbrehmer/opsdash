import { expect, test } from "@playwright/test";
import { openDashboard, widget, withConfig } from "./util.ts";

test("US3: a hanging source times out only its own widgets", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await withConfig(
    page,
    (y) =>
      y.replace(
        '    mock:\n      notFound: ["ITEM-404"]',
        "    timeout: 1s\n    cacheWindow: 0s\n    mock:\n      latencyMs: 20000",
      ),
    async () => {
      await page.waitForTimeout(600);
      await openDashboard(page, "details");
      await expect(widget(page, "details/everything")).toContainText(
        /did not respond in time|Timed out waiting for the source/,
        { timeout: 5000 },
      );
      await page.getByRole("link", { name: "Overview" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
    },
  );
});

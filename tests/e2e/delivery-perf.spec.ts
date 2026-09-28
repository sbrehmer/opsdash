import { expect, test } from "@playwright/test";
import { seedDeliveryRows } from "./util.ts";

test("30 tracker rows: every cell leaves its loading state within 2 s (SC-003)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await seedDeliveryRows(30, { repos: 3, from: 1700 });
  await page.goto("/");
  const started = Date.now();
  await page.goto("/#/delivery");
  const tracker = page.locator('[data-widget="delivery/tracker"]');
  await expect(page.locator('[data-widget] [role="status"][aria-label="Loading"]')).toHaveCount(0);
  await expect(tracker.getByText("loading…")).toHaveCount(0);
  // All 30 seeded rows are there (rows added by other specs may be too).
  await expect(tracker.getByRole("link", { name: /^acme\/\w+#17\d\d$/ })).toHaveCount(30);
  expect(Date.now() - started).toBeLessThan(2000);
});

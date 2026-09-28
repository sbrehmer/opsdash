import { expect, test } from "@playwright/test";

test("20 widgets reach their final state within 2 s (SC-006)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto("/");
  const started = Date.now();
  await page.goto("/#/batching-demo");
  await expect(page.locator("[data-widget]")).toHaveCount(20);
  await expect(page.locator('[data-widget] [role="status"][aria-label="Loading"]')).toHaveCount(0);
  await expect(page.locator("[data-widget] li")).toHaveCount(80);
  expect(Date.now() - started).toBeLessThan(2000);
});

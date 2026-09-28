import { expect, test } from "@playwright/test";
import { openDashboard, widget } from "./util.ts";

test("US6: track and untrack items from a widget", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await openDashboard(page, "overview");
  const w = widget(page, "overview/watchlist");
  await w.hover();
  await w.getByRole("button", { name: /Track item/ }).click();
  const input = w.getByLabel("Item to track");
  await input.fill("ITEM-7");
  await input.press("Enter");
  await expect(w.getByRole("list", { name: "Tracked items" })).toContainText("ITEM-7");
  await expect(w).toContainText("ITEM-7");

  await input.fill("ITEM-7");
  await input.press("Enter");
  await expect(w.getByRole("alert")).toContainText("already tracked");
  await input.fill("bad");
  await input.press("Enter");
  await expect(w.getByRole("alert")).toContainText("ITEM-123");

  await page.reload();
  await expect(widget(page, "overview/watchlist")).toContainText("ITEM-7");

  const again = widget(page, "overview/watchlist");
  await again.hover();
  await again.getByRole("button", { name: /Track item/ }).click();
  await again.getByRole("button", { name: "Untrack ITEM-7" }).click();
  await expect(again.getByRole("list", { name: "Tracked items" })).toHaveCount(0);
  await expect(again).toContainText("Nothing to show yet");
});

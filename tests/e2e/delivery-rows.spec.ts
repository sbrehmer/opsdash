import { expect, test } from "@playwright/test";
import { openDashboard, widget } from "./util.ts";

test("US1: add a tracker row from a pull request, link the suggested story, and remove it (SC-001)", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop");
  await openDashboard(page, "delivery");
  const tracker = widget(page, "delivery/tracker");
  const form = tracker.locator("form").first();
  const row = tracker.locator("tr", { has: page.getByRole("link", { name: "acme/web#1423" }) });

  // Time the whole add-row flow: fill and submit until the row is visible.
  const flowStarted = Date.now();
  await form.getByLabel("Pull request").fill("acme/web#1423");
  const submitted = Date.now();
  await form.getByRole("button", { name: "Add" }).click();
  await expect(row).toBeVisible({ timeout: 2000 });
  const uiMs = Date.now() - submitted;
  expect(uiMs).toBeLessThan(2000);
  expect(Date.now() - flowStarted).toBeLessThan(20_000);
  await expect(form.getByLabel("Pull request")).toHaveValue("");

  await expect(row).toContainText("acme/web/PR-1423");
  const link = row.getByRole("button", { name: "Link PROJ-65" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(row.locator('td[data-label="Story"]')).toContainText("PROJ-65");
  await expect(row.getByRole("button", { name: /^Link / })).toHaveCount(0);

  // A duplicate is refused with an inline error in the form.
  await form.getByLabel("Pull request").fill("acme/web#1423");
  await form.getByRole("button", { name: "Add" }).click();
  await expect(form.getByRole("alert")).toContainText(/already tracked/);

  // Remove the row through its actions menu.
  await row.getByLabel("Actions for acme/web#1423").click();
  await row.getByRole("button", { name: "Remove row" }).click();
  await expect(tracker.getByRole("link", { name: "acme/web#1423" })).toHaveCount(0);
});

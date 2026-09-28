import { expect, type Locator, test } from "@playwright/test";
import { openDashboard, widget } from "./util.ts";

async function track(w: Locator, input: string) {
  await w.hover();
  await w.getByRole("button", { name: /Track item/ }).click();
  const field = w.getByLabel("Item to track");
  await field.fill(input);
  await field.press("Enter");
  await expect(w.getByRole("list", { name: "Tracked items" })).toContainText(input);
  await w.getByRole("button", { name: "Close tracking" }).click();
}

test("US4: track items in the standalone Stories, Pull requests and Builds widgets", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await openDashboard(page, "delivery");

  const stories = widget(page, "delivery/stories");
  await track(stories, "PROJ-88");
  await expect(stories.getByRole("link", { name: "PROJ-88" })).toBeVisible();
  await expect(stories.getByText(/^(To Do|In Progress|In Review|Done)$/)).toBeVisible();

  const prs = widget(page, "delivery/prs");
  await track(prs, "acme/api#12");
  await expect(prs.getByRole("link", { name: "acme/api#12" })).toBeVisible();
  await expect(prs.getByText(/^(open|draft|merged|closed)$/)).toBeVisible();

  const builds = widget(page, "delivery/builds");
  await track(builds, "acme/web/PR-7");
  await expect(builds.getByRole("link", { name: "acme/web/PR-7" })).toBeVisible();
  await expect(
    builds.getByText(/^(succeeded|failed|unstable|aborted|running|waiting for first build)$|^running · /),
  ).toBeVisible();
  await expect(builds).toContainText(/main: last success \S+/);
});

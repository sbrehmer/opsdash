import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

export const CONFIG = join(import.meta.dirname, "../../.data/e2e-config/opsdash.yaml");

/** Edits the live config for the duration of `fn`, then restores it and waits for the reload. */
export async function withConfig(page: Page, edit: (yaml: string) => string, fn: () => Promise<void>) {
  const original = readFileSync(CONFIG, "utf8");
  writeFileSync(CONFIG, edit(original));
  try {
    await fn();
  } finally {
    writeFileSync(CONFIG, original);
    await page.waitForTimeout(600);
  }
}

export async function openDashboard(page: Page, id: string) {
  await page.goto(`/#/${id}`);
  await expect(page.locator("[data-widget]").first()).toBeVisible();
}

export const widget = (page: Page, path: string) => page.locator(`[data-widget="${path}"]`);

export const BASE_URL = "http://localhost:4411";

/** Runs a widget action through the public actions API (for seeding); returns the HTTP status. */
export async function runAction(path: string, name: string, payload: unknown): Promise<number> {
  const res = await fetch(`${BASE_URL}/api/widgets/${encodeURIComponent(path)}/actions/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  await res.body?.cancel();
  return res.status;
}

/**
 * Seeds `rows` Delivery tracker rows over `repos` repositories (as scripts/seed-delivery.mjs does), starting at
 * PR number `from`. Rows already tracked (422 duplicates from an earlier project or spec) are fine.
 */
export async function seedDeliveryRows(rows: number, { repos = 3, from = 1600 } = {}) {
  const names = ["web", "api", "mobile", "infra", "docs"].slice(0, repos);
  for (let i = 0; i < rows; i++) {
    const repo = names[i % names.length];
    const n = from + i;
    const payload =
      i % 3 === 1
        ? { job: `acme/${repo}/PR-${n}` }
        : i % 3 === 2
          ? { pr: `acme/${repo}#${n}`, story: `PROJ-${(n % 97) + 1}` }
          : { pr: `acme/${repo}#${n}` };
    const status = await runAction("delivery/tracker", "addRow", payload);
    if (status !== 200 && status !== 422) throw new Error(`Seeding ${JSON.stringify(payload)} failed: ${status}`);
  }
}

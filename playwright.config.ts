import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://localhost:4411",
    // Alpine (musl) cannot run Playwright's bundled browser; set OPSDASH_CHROMIUM to a system Chromium.
    launchOptions: process.env.OPSDASH_CHROMIUM ? { executablePath: process.env.OPSDASH_CHROMIUM } : {},
  },
  webServer: {
    command:
      "node packages/host/src/main.ts --config .data/e2e-config --plugins plugins --db .data/e2e.db --mock --port 4411",
    url: "http://localhost:4411/healthz",
    reuseExistingServer: false,
    timeout: 30000,
  },
  globalSetup: "./tests/e2e/global-setup.ts",
  projects: [
    { name: "phone", use: { viewport: { width: 360, height: 780 } } },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "wall", use: { viewport: { width: 3840, height: 2160 } } },
  ],
});

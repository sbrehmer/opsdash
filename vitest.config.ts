import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "host", root: "packages/host", include: ["tests/**/*.test.ts"], testTimeout: 20000 } },
      { test: { name: "plugin-sdk", root: "packages/plugin-sdk", include: ["tests/**/*.test.ts"] } },
      "packages/web/vitest.config.ts",
      { test: { name: "delivery", root: "plugins/delivery", include: ["tests/**/*.test.ts"] } },
      { test: { name: "contract", root: "tests/contract", include: ["**/*.test.ts"], testTimeout: 60000 } },
    ],
  },
});

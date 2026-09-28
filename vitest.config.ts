import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "server", include: ["tests/server/**/*.test.ts"], testTimeout: 20000 } },
      {
        plugins: [preact()],
        test: { name: "client", environment: "happy-dom", include: ["tests/client/**/*.test.tsx"] },
      },
      { test: { name: "sdk", include: ["sdk/tests/**/*.test.ts"] } },
      { test: { name: "plugins", include: ["plugins/*/tests/**/*.test.ts"] } },
      { test: { name: "contract", root: "tests/contract", include: ["**/*.test.ts"], testTimeout: 60000 } },
    ],
  },
});

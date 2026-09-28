import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

const host = process.env.OPSDASH_HOST ?? "http://localhost:4400";

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      ["/api", "/plugins", "/schema", "/vendor", "/healthz"].map((p) => [p, { target: host, changeOrigin: false }]),
    ),
  },
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
});

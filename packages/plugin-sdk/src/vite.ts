import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build, type Plugin } from "vite";
import type { DefinedPlugin, PluginManifest, PluginManifestSource } from "./types.ts";

/** Modules shared with the host page through its import map; never bundled into a plugin client. */
export const SHARED_CLIENT_MODULES = ["preact", "preact/hooks", "preact/jsx-runtime", "@preact/signals"];

export interface OpsdashPluginOptions {
  /** Client entry, default `src/client.tsx`. */
  client?: string;
  /** Server entry, default `src/server.ts`. */
  server?: string;
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((f) => join(dir, f))
    .filter((f) => statSync(f).isFile());
}

/**
 * Vite preset for Opsdash plugins. The Vite build produces the browser widget (`dist/client.js`,
 * shared modules external, CSS Modules extracted to `dist/style.css`); after it, the server module is
 * bundled for Node (`dist/server.js`, all dependencies inlined) and `dist/opsdash.manifest.json` is
 * generated from package.json plus the plugin's settings and reference JSON Schemas.
 */
export function opsdashPlugin(options: OpsdashPluginOptions = {}): Plugin {
  const clientEntry = options.client ?? "src/client.tsx";
  const serverEntry = options.server ?? "src/server.ts";
  let root = process.cwd();

  return {
    name: "opsdash-plugin",
    config(config) {
      root = resolve(config.root ?? process.cwd());
      return {
        oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
        build: {
          outDir: "dist",
          emptyOutDir: false,
          target: "es2022",
          lib: { entry: clientEntry, formats: ["es"], fileName: () => "client.js", cssFileName: "style" },
          rollupOptions: { external: SHARED_CLIENT_MODULES },
        },
      };
    },
    buildStart() {
      for (const file of listFiles(join(root, "src"))) this.addWatchFile(file);
    },
    async closeBundle() {
      const outDir = join(root, "dist");
      await build({
        configFile: false,
        root,
        logLevel: "warn",
        build: {
          ssr: serverEntry,
          outDir: "dist",
          emptyOutDir: false,
          target: "node24",
          minify: false,
          rollupOptions: { output: { format: "es", entryFileNames: "server.js" } },
        },
        ssr: { target: "node", noExternal: true },
      });

      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
        name: string;
        version: string;
        opsdash: PluginManifestSource;
      };
      const mod = (await import(`${pathToFileURL(join(outDir, "server.js")).href}?t=${Date.now()}`)) as {
        default: DefinedPlugin;
      };
      const plugin = mod.default;
      let style: string | undefined;
      try {
        statSync(join(outDir, "style.css"));
        style = "style.css";
      } catch {}
      const manifest: PluginManifest = {
        ...pkg.opsdash,
        name: pkg.name,
        version: pkg.version,
        ...plugin.jsonSchemas(),
        hasMock: typeof plugin.mock?.fetch === "function" && typeof plugin.mock?.parseReference === "function",
        ...(style ? { style } : {}),
      };
      writeFileSync(join(outDir, "opsdash.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    },
  };
}

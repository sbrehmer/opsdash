import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

export interface ManifestSource {
  name: string;
  version: string;
  fields: PluginManifestSource;
}

function readJson(file: string): Record<string, unknown> | undefined {
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

/**
 * Reads a plugin's manifest source: `plugin.json` (built-in plugins, fields at top level) or, for
 * plugins with their own package, the `opsdash` field of `package.json` plus its name and version.
 */
export function readManifestSource(root: string): ManifestSource {
  let source: Record<string, unknown>;
  const plugin = readJson(join(root, "plugin.json"));
  const pkg = plugin ? undefined : readJson(join(root, "package.json"));
  if (plugin) source = plugin;
  else if (pkg && typeof pkg.opsdash === "object" && pkg.opsdash !== null) {
    source = { ...(pkg.opsdash as Record<string, unknown>), name: pkg.name, version: pkg.version };
  } else {
    throw new Error(`No plugin manifest: add plugin.json or an "opsdash" field in package.json (${root})`);
  }
  const { name, version, ...fields } = source;
  if (typeof name !== "string" || name === "") throw new Error(`Plugin manifest is missing "name" (${root})`);
  if (typeof version !== "string" || version === "") throw new Error(`Plugin manifest is missing "version" (${root})`);
  return { name, version, fields: fields as unknown as PluginManifestSource };
}

/**
 * Vite preset for Opsdash plugins. The Vite build produces the browser widget (`dist/client.js`,
 * shared modules external, CSS Modules extracted to `dist/style.css`); after it, the server module is
 * bundled for Node (`dist/server.js`, all dependencies inlined) and `dist/opsdash.manifest.json` is
 * generated from the manifest source (see `readManifestSource`) plus the plugin's settings and reference JSON Schemas.
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

      const { name, version, fields } = readManifestSource(root);
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
        ...fields,
        name,
        version,
        ...plugin.jsonSchemas(),
        hasMock: typeof plugin.mock?.fetch === "function" && typeof plugin.mock?.parseReference === "function",
        ...(style ? { style } : {}),
      };
      writeFileSync(join(outDir, "opsdash.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    },
  };
}

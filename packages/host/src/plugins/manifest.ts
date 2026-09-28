import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_API_VERSION, type PluginManifest } from "@opsdash/plugin-sdk";
import semver from "semver";
import { parseDuration } from "../config/primitives.ts";

export const MANIFEST_FILE = "dist/opsdash.manifest.json";
export const SUPPORTED_CAPABILITIES = new Set(["track", "actions"]);

const REQUIRED = [
  "id",
  "name",
  "version",
  "apiVersion",
  "server",
  "client",
  "capabilities",
  "env",
  "refresh",
  "settingsSchema",
  "referenceSchema",
  "hasMock",
] as const;

export type ManifestCheck =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; id?: string; version?: string; reason: string };

/** Static manifest check, before any plugin code runs (FR-015, FR-016, FR-049). */
export function checkManifest(dir: string): ManifestCheck {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(join(dir, MANIFEST_FILE), "utf8"));
  } catch {
    return { ok: false, reason: `Missing or unreadable ${MANIFEST_FILE} (build the plugin with the SDK Vite preset)` };
  }
  const id = typeof raw.id === "string" ? raw.id : undefined;
  const version = typeof raw.version === "string" ? raw.version : undefined;
  const refuse = (reason: string): ManifestCheck => ({ ok: false, id, version, reason });

  const composite = raw.composes !== undefined;
  if (
    composite &&
    (!Array.isArray(raw.composes) || raw.composes.some((c) => typeof c !== "string" || !/^[a-z0-9-]+$/.test(c)))
  ) {
    return refuse(`"composes" must be a list of plugin ids`);
  }
  // Composite plugins (API 1.1) have no source: no reference schema or mock, but still a settings schema.
  const required = composite ? REQUIRED.filter((f) => f !== "referenceSchema" && f !== "hasMock") : REQUIRED;
  const missing = required.filter((f) => raw[f] === undefined);
  if (missing.length > 0) return refuse(`Manifest is missing required field(s): ${missing.join(", ")}`);
  const m = raw as unknown as PluginManifest;
  if (!/^[a-z0-9-]+$/.test(m.id))
    return refuse(`Plugin id "${m.id}" must contain only lowercase letters, digits and dashes`);
  if (!semver.valid(m.version)) return refuse(`Plugin version "${m.version}" is not a valid semver version`);
  if (!semver.validRange(m.apiVersion) || !semver.satisfies(PLUGIN_API_VERSION, m.apiVersion)) {
    return refuse(`Plugin targets plugin API ${m.apiVersion}; this host implements ${PLUGIN_API_VERSION}`);
  }
  const unsupported = m.capabilities.filter((c) => !SUPPORTED_CAPABILITIES.has(c));
  if (unsupported.length > 0) {
    return refuse(
      `Capability "${unsupported.join(", ")}" is not supported: mutating capabilities are not yet supported`,
    );
  }
  if (!Array.isArray(m.env) || m.env.some((e) => typeof e !== "string"))
    return refuse(`"env" must be a list of variable names`);
  if (parseDuration(m.refresh?.interval ?? "") === undefined || parseDuration(m.refresh?.timeout ?? "") === undefined) {
    return refuse(`"refresh" must declare interval and timeout durations such as 60s`);
  }
  if (m.maxBatchSize !== undefined && (!Number.isInteger(m.maxBatchSize) || m.maxBatchSize < 1)) {
    return refuse(`"maxBatchSize" must be a positive integer`);
  }
  if (!composite && m.hasMock !== true) return refuse("Plugin does not provide a mock source (required)");
  return { ok: true, manifest: m };
}

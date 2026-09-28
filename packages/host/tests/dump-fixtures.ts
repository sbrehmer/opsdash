// Dev helper: prints each invalid-config fixture's errors; with --write, records file/line/column/path
// into expected.json (after the messages have been reviewed by hand).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config/load.ts";
import { resolveConfig } from "../src/config/resolve.ts";
import { createLogger } from "../src/log.ts";
import { PluginRegistry } from "../src/plugins/registry.ts";
import { Redactor } from "../src/secrets/redact.ts";

const dir = join(import.meta.dirname, "../../../tests/fixtures/invalid-config");
const reg = new PluginRegistry(
  join(import.meta.dirname, "../../../plugins"),
  createLogger(new Redactor(), { write() {} } as never),
);
await reg.loadAll();
for (const name of readdirSync(dir)) {
  const r = resolveConfig(loadConfig(join(dir, name)), reg, { mock: true, env: new Map(), redactor: new Redactor() });
  const e = r.errors[0]!;
  console.log(
    name.padEnd(30),
    `${e.file}:${e.line}:${e.column} ${e.path} | ${e.message}`,
    r.errors.length > 1 ? `(+${r.errors.length - 1})` : "",
  );
  if (process.argv.includes("--write")) {
    const file = join(dir, name, "expected.json");
    const expected = JSON.parse(readFileSync(file, "utf8"));
    if (!e.message.includes(expected.messageIncludes)) throw new Error(`${name}: message mismatch: ${e.message}`);
    writeFileSync(
      file,
      `${JSON.stringify({ file: e.file, line: e.line, column: e.column, path: e.path, messageIncludes: expected.messageIncludes }, null, 2)}\n`,
    );
  }
}

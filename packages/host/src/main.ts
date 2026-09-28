#!/usr/bin/env node
import { parseArgs } from "node:util";
import { startOpsdash } from "./server.ts";
import { StoreError } from "./store/db.ts";

const USAGE = `Usage: opsdash --config <dir> --plugins <dir> [--db <file>] [--env-file <file>] [--mock] [--port <n>]

  --config    Config directory containing opsdash.yaml, or a root config file such as
              config/production.yaml (required)
  --plugins   Directory containing plugins (required)
  --db        SQLite store file (default ./.data/opsdash.db)
  --env-file  Env file with secrets (process environment wins)
  --mock      Mock mode: plugins use their mock sources (also OPSDASH_MOCK=1)
  --port      HTTP port (default 4400)`;

// `pnpm start -- --config …` forwards the literal `--`; drop it.
const argv = process.argv.slice(2);
if (argv[0] === "--") argv.shift();

const { values } = parseArgs({
  args: argv,
  options: {
    config: { type: "string" },
    plugins: { type: "string" },
    db: { type: "string", default: "./.data/opsdash.db" },
    "env-file": { type: "string" },
    mock: { type: "boolean", default: false },
    port: { type: "string", default: "4400" },
    help: { type: "boolean", default: false },
  },
});

if (values.help || !values.config || !values.plugins) {
  console.error(USAGE);
  process.exit(values.help ? 0 : 2);
}

try {
  const opsdash = await startOpsdash({
    configDir: values.config,
    pluginsDir: values.plugins,
    dbFile: values.db!,
    envFile: values["env-file"],
    mock: values.mock || process.env.OPSDASH_MOCK === "1",
    port: Number(values.port),
  });
  const shutdown = async () => {
    await opsdash.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch (err) {
  if (err instanceof StoreError) {
    console.error(JSON.stringify({ level: 60, event: "store.refused", msg: err.message }));
    process.exit(1);
  }
  throw err;
}

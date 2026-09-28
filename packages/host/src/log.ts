import pino, { type DestinationStream, type Logger } from "pino";
import type { Redactor } from "./secrets/redact.ts";

export type { Logger };

/** Structured JSON logs to stdout (FR-046); secret values are redacted by value (FR-035). */
export function createLogger(redactor: Redactor, destination?: DestinationStream, level = "info"): Logger {
  return pino(
    {
      level: process.env.OPSDASH_LOG_LEVEL ?? level,
      base: undefined,
      formatters: { log: (obj) => redactor.deep(obj) },
      hooks: {
        logMethod(args, method) {
          method.apply(this, args.map((a) => redactor.deep(a)) as Parameters<typeof method>);
        },
      },
    },
    destination ?? pino.destination(1),
  );
}

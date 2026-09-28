import { z } from "zod";

const UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

/** Parses durations like `500ms`, `30s`, `5m`, `1h` into milliseconds. */
export function parseDuration(value: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value.trim());
  return m ? Number(m[1]) * UNITS[m[2]!]! : undefined;
}

export const duration = z
  .string({ error: "Expected a duration such as 30s, 5m or 1h" })
  .refine((v) => parseDuration(v) !== undefined, "Expected a duration such as 30s, 5m or 1h");

export const SLUG = /^[a-z0-9-]+$/;
export const slug = z
  .string({ error: "Expected an identifier" })
  .regex(SLUG, "Identifiers may only contain lowercase letters, digits and dashes");

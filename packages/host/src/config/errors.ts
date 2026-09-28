import type { core } from "zod";
import { formatPath, locate } from "./locate.ts";
import type { ConfigError, DocPath, ErrorScope, Source } from "./types.ts";

const typeName = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "a list" : typeof v);

const isDefault = (message: string) => /^Invalid (input|option)/.test(message);
const sentence = (message: string) => (/[.!?]$/.test(message) ? message : `${message}.`);

function plainMessage(issue: core.$ZodIssue, field: string): string {
  return sentence(rawMessage(issue, field));
}

function rawMessage(issue: core.$ZodIssue, field: string): string {
  const input = (issue as { input?: unknown }).input;
  switch (issue.code) {
    case "invalid_type":
      if (input === undefined) return `Missing required field "${field}".`;
      if (issue.message && !isDefault(issue.message)) return issue.message;
      return `"${field}" must be ${issue.expected === "array" ? "a list" : `a ${issue.expected}`} (found ${typeName(input)}).`;
    case "unrecognized_keys":
      return `Unknown field "${issue.keys[0]}".`;
    case "invalid_value":
      if (issue.message && !isDefault(issue.message)) return issue.message;
      return `"${field}" must be one of: ${issue.values.map((v) => JSON.stringify(v)).join(", ")} (found ${JSON.stringify(input)}).`;
    default:
      return issue.message;
  }
}

export function configError(
  src: Source,
  path: DocPath,
  message: string,
  scope: ErrorScope,
  unknownKey?: string,
): ConfigError {
  const { line, column } = locate(src, path, unknownKey);
  const fullPath = unknownKey ? [...path, unknownKey] : path;
  return { file: src.file, line, column, path: formatPath(fullPath), message, scope };
}

/** Turns Zod issues from validating the node at `base` into located, plain-language errors. */
export function fromZod(
  issues: core.$ZodIssue[],
  src: Source,
  base: DocPath,
  scope: ErrorScope,
  rewrite?: (issue: core.$ZodIssue, message: string) => string,
): ConfigError[] {
  return issues.flatMap((issue) => {
    const path = [...base, ...(issue.path as DocPath)];
    const field = String(path.at(-1) ?? "value");
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => {
        const msg = `Unknown field "${key}".`;
        return configError(src, path, rewrite ? rewrite({ ...issue, keys: [key] }, msg) : msg, scope, key);
      });
    }
    const msg = plainMessage(issue, field);
    return [configError(src, path, rewrite ? rewrite(issue, msg) : msg, scope)];
  });
}

export function formatError(e: ConfigError): string {
  return `${e.file}:${e.line}:${e.column}  ${e.path}\n  ${e.message}`;
}

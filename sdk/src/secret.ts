import { z } from "zod";

export const SECRET_LITERAL_MESSAGE = "Secrets must be referenced as { env: NAME }; literal values are not allowed";

/** A secret-typed setting. Only `{ env: "NAME" }` is accepted; literal strings are rejected (FR-034). */
export function secret() {
  return z
    .strictObject(
      { env: z.string().regex(/^[A-Z_][A-Z0-9_]*$/, "Environment variable names use A-Z, 0-9 and _") },
      { error: (issue) => (typeof issue.input === "string" ? SECRET_LITERAL_MESSAGE : undefined) },
    )
    .meta({ opsdashSecret: true });
}

/** True for a `{ env: "NAME" }` secret reference value. */
export function isSecretRef(value: unknown): value is { env: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as { env?: unknown }).env === "string"
  );
}

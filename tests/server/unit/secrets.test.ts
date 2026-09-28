import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { SECRET_LITERAL_MESSAGE, secret, z } from "@opsdash/plugin-sdk";
import { describe, expect, it } from "vitest";
import { loadEnv } from "../../../src/server/secrets/env.ts";
import { Redactor } from "../../../src/server/secrets/redact.ts";
import { tmp } from "../helpers.ts";

describe("secrets (US7)", () => {
  it("env file fills only keys missing from the process environment", () => {
    const file = join(tmp(), ".env");
    writeFileSync(file, "A=from-file\nB=from-file\n");
    const env = loadEnv(file, { A: "from-process" });
    expect(env.get("A")).toBe("from-process");
    expect(env.get("B")).toBe("from-file");
  });

  it("secret() accepts only { env: NAME } and rejects literal values", () => {
    const schema = z.object({ token: secret() });
    expect(schema.safeParse({ token: { env: "MY_TOKEN" } }).success).toBe(true);
    const literal = schema.safeParse({ token: "ghp_literal" });
    expect(literal.success).toBe(false);
    expect(literal.error!.issues[0]!.message).toBe(SECRET_LITERAL_MESSAGE);
    expect(schema.safeParse({ token: { env: "lower" } }).success).toBe(false);
  });

  it("redacts registered values in strings, nested objects and errors", () => {
    const r = new Redactor();
    r.register("s3cr3t-value");
    r.register("abc"); // too short to register safely
    expect(r.string("token=s3cr3t-value; x=abc")).toBe("token=[REDACTED]; x=abc");
    const out = r.deep({ a: ["s3cr3t-value"], b: { c: new Error("bad s3cr3t-value") } });
    expect(JSON.stringify(out)).not.toContain("s3cr3t-value");
  });
});

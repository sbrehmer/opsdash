/** Replaces known secret values wherever they appear (FR-035). pino only redacts by key path. */
export class Redactor {
  #values = new Set<string>();

  register(value: string | undefined): void {
    if (value && value.length >= 4) this.#values.add(value);
  }

  string(input: string): string {
    let out = input;
    for (const v of this.#values) if (out.includes(v)) out = out.split(v).join("[REDACTED]");
    return out;
  }

  deep<T>(input: T, seen = new WeakSet<object>()): T {
    if (typeof input === "string") return this.string(input) as T;
    if (typeof input !== "object" || input === null || this.#values.size === 0) return input;
    if (seen.has(input)) return input;
    seen.add(input);
    if (input instanceof Error) {
      const copy = {
        type: input.name,
        message: this.string(input.message),
        stack: input.stack && this.string(input.stack),
      };
      return copy as T;
    }
    if (Array.isArray(input)) return input.map((v) => this.deep(v, seen)) as T;
    return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, this.deep(v, seen)])) as T;
  }
}

/** Modules shared between the host page and plugin widgets through the import map (research R4). */
export const SHARED_MODULES: Record<string, string> = {
  preact: "preact",
  "preact-hooks": "preact/hooks",
  "preact-jsx-runtime": "preact/jsx-runtime",
  "preact-signals": "@preact/signals",
};

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Builds shim modules re-exporting the page's own module instances (set on `globalThis.__opsdash_shared`
 * by the web app), so every widget uses the host's single Preact instance in dev and in production.
 */
export async function buildVendorShims(): Promise<Map<string, string>> {
  const shims = new Map<string, string>();
  for (const [name, specifier] of Object.entries(SHARED_MODULES)) {
    const mod = (await import(specifier)) as Record<string, unknown>;
    const names = Object.keys(mod).filter((k) => k !== "default" && IDENT.test(k));
    const lines = [
      `const m = globalThis.__opsdash_shared?.[${JSON.stringify(specifier)}];`,
      `if (!m) throw new Error(${JSON.stringify(`Opsdash shared module ${specifier} is not initialised`)});`,
      `export const { ${names.join(", ")} } = m;`,
    ];
    if ("default" in mod) lines.push("export default m.default;");
    shims.set(name, `${lines.join("\n")}\n`);
  }
  return shims;
}

export function importMap(): string {
  return JSON.stringify({
    imports: Object.fromEntries(Object.entries(SHARED_MODULES).map(([name, spec]) => [spec, `/vendor/${name}.js`])),
  });
}

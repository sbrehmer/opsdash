import { configError } from "./errors.ts";
import { locate } from "./locate.ts";
import { type ConfigError, type ErrorScope, isBlockUse, type LocatedPlacement } from "./types.ts";

const kind = (p: LocatedPlacement) => (isBlockUse(p) ? "Block" : "Widget");
const where = (p: LocatedPlacement) => {
  const { line, column } = locate(p.src, p.path);
  return `${p.src.file}:${line}:${column}`;
};

/** Cross-field checks for one list of sibling placements: ids, grid bounds, overlaps (FR-002a, FR-002b). */
export function validatePlacements(items: LocatedPlacement[], scope: ErrorScope): ConfigError[] {
  const errors: ConfigError[] = [];
  const seen = new Map<string, LocatedPlacement>();
  for (const item of items) {
    const { id, at, size } = item.value;
    const first = seen.get(id);
    if (first) {
      errors.push(
        configError(item.src, [...item.path, "id"], `Duplicate id "${id}" (also used at ${where(first)}).`, scope),
      );
    } else seen.set(id, item);
    const lastColumn = at[0] + size[0] - 1;
    if (lastColumn > 12) {
      errors.push(
        configError(
          item.src,
          [...item.path, "size"],
          `${kind(item)} "${id}" extends to column ${lastColumn}; the grid has 12 columns.`,
          scope,
        ),
      );
    }
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = items[j]!.value;
      const b = items[i]!.value;
      const overlap =
        a.at[0] < b.at[0] + b.size[0] &&
        b.at[0] < a.at[0] + a.size[0] &&
        a.at[1] < b.at[1] + b.size[1] &&
        b.at[1] < a.at[1] + a.size[1];
      if (overlap) {
        errors.push(
          configError(
            items[i]!.src,
            [...items[i]!.path, "at"],
            `${kind(items[i]!)} "${b.id}" overlaps ${kind(items[j]!).toLowerCase()} "${a.id}" (${where(items[j]!)}).`,
            scope,
          ),
        );
      }
    }
  }
  return errors;
}

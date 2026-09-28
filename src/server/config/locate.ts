import { isMap, isPair, isScalar, isSeq, type Node, type Pair } from "yaml";
import type { DocPath, Source } from "./types.ts";

function keyOf(pair: Pair): string {
  return isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
}

function startOf(node: unknown): number | undefined {
  return (node as Node | null)?.range?.[0];
}

/**
 * Maps a document path (for example from a Zod issue) to a 1-based line and column in the YAML source.
 * Points at the value when present, at the key when the value is empty, and at the closest existing
 * ancestor when the path does not exist (for example a missing required field).
 */
export function locate(src: Source, path: DocPath, unknownKey?: string): { line: number; column: number } {
  let node: unknown = src.doc.contents;
  let offset = startOf(node) ?? 0;
  for (const seg of path) {
    if (isMap(node)) {
      const pair = node.items.find((p) => isPair(p) && keyOf(p) === String(seg));
      if (!pair) break;
      node = pair.value;
      offset = startOf(pair.value) ?? startOf(pair.key) ?? offset;
    } else if (isSeq(node) && typeof seg === "number") {
      const item = node.items[seg];
      if (item === undefined) break;
      node = item;
      offset = startOf(item) ?? offset;
    } else break;
  }
  if (unknownKey !== undefined && isMap(node)) {
    const pair = node.items.find((p) => isPair(p) && keyOf(p) === unknownKey);
    offset = startOf(pair?.key) ?? offset;
  }
  const pos = src.lc.linePos(offset);
  return { line: pos.line, column: pos.col };
}

/** Formats a document path as `dashboards[0].items[2].size`. */
export function formatPath(path: DocPath): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else out += out ? `.${seg}` : seg;
  }
  return out || "(root)";
}

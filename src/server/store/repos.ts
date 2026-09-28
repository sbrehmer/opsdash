import type { StoredRef } from "@opsdash/plugin-sdk";
import type { Db } from "./db.ts";
import { orm } from "./drizzle.ts";
import { pluginState, refLink, trackedRef } from "./schema.ts";

export class DuplicateRefError extends Error {}

const { and, eq, inArray, or, sql } = orm;

type Row = typeof trackedRef.$inferSelect;
const toRef = (r: Row): StoredRef => ({
  id: r.id,
  pluginId: r.pluginId,
  widgetPath: r.widgetPath,
  refKey: r.refKey,
  ref: r.ref,
});

/** The storage layer's repositories: the only code that queries the database. */
export function createRepos(db: Db) {
  return {
    trackRef(widgetPath: string, pluginId: string, refKey: string, ref: unknown): StoredRef {
      try {
        const row = db
          .insert(trackedRef)
          .values({ widgetPath, pluginId, refKey, ref, createdAt: Date.now() })
          .returning()
          .get();
        return toRef(row);
      } catch (err) {
        const e = err as { code?: string; cause?: { code?: string } };
        if (e.code === "SQLITE_CONSTRAINT_UNIQUE" || e.cause?.code === "SQLITE_CONSTRAINT_UNIQUE") {
          throw new DuplicateRefError(refKey);
        }
        throw err;
      }
    },

    /** `untrackRef(path, refKey)` removes that key for any plugin; `untrackRef(path, pluginId, refKey)` for one plugin. */
    untrackRef(widgetPath: string, pluginIdOrKey: string, refKey?: string): boolean {
      const where =
        refKey === undefined
          ? and(eq(trackedRef.widgetPath, widgetPath), eq(trackedRef.refKey, pluginIdOrKey))
          : and(
              eq(trackedRef.widgetPath, widgetPath),
              eq(trackedRef.pluginId, pluginIdOrKey),
              eq(trackedRef.refKey, refKey),
            );
      return db.delete(trackedRef).where(where).run().changes > 0;
    },

    getRef(widgetPath: string, pluginId: string, refKey: string): StoredRef | undefined {
      const row = db
        .select()
        .from(trackedRef)
        .where(
          and(eq(trackedRef.widgetPath, widgetPath), eq(trackedRef.pluginId, pluginId), eq(trackedRef.refKey, refKey)),
        )
        .get();
      return row && toRef(row);
    },

    getRefById(id: number): StoredRef | undefined {
      const row = db.select().from(trackedRef).where(eq(trackedRef.id, id)).get();
      return row && toRef(row);
    },

    /**
     * Removes a ref; with `cascade`, also removes refs in the same widget that it was linked to and that
     * are left without any link (a story still linked to another row is kept).
     */
    removeRef(id: number, cascade = false): number {
      return db.transaction((tx) => {
        const target = tx.select().from(trackedRef).where(eq(trackedRef.id, id)).get();
        if (!target) return 0;
        const neighbours = cascade
          ? tx
              .select({ fromRefId: refLink.fromRefId, toRefId: refLink.toRefId })
              .from(refLink)
              .where(or(eq(refLink.fromRefId, id), eq(refLink.toRefId, id)))
              .all()
              .map((l) => (l.fromRefId === id ? l.toRefId : l.fromRefId))
          : [];
        let removed = tx.delete(trackedRef).where(eq(trackedRef.id, id)).run().changes;
        for (const n of neighbours) {
          const other = tx.select().from(trackedRef).where(eq(trackedRef.id, n)).get();
          if (!other || other.widgetPath !== target.widgetPath) continue;
          const stillLinked = tx
            .select({ id: refLink.id })
            .from(refLink)
            .where(or(eq(refLink.fromRefId, n), eq(refLink.toRefId, n)))
            .get();
          if (!stillLinked) removed += tx.delete(trackedRef).where(eq(trackedRef.id, n)).run().changes;
        }
        return removed;
      });
    },

    listLinksForWidget(widgetPath: string): Array<{ from: number; to: number }> {
      const ids = db
        .select({ id: trackedRef.id })
        .from(trackedRef)
        .where(eq(trackedRef.widgetPath, widgetPath))
        .all()
        .map((r) => r.id);
      if (ids.length === 0) return [];
      return db
        .select({ from: refLink.fromRefId, to: refLink.toRefId })
        .from(refLink)
        .where(inArray(refLink.fromRefId, ids))
        .all();
    },

    transaction<T>(fn: () => T): T {
      return db.transaction(() => fn());
    },

    listRefs(widgetPath: string): StoredRef[] {
      return db
        .select()
        .from(trackedRef)
        .where(eq(trackedRef.widgetPath, widgetPath))
        .orderBy(trackedRef.id)
        .all()
        .map(toRef);
    },

    pathsWithRefs(): Array<{ widgetPath: string; count: number }> {
      return db
        .select({ widgetPath: trackedRef.widgetPath, count: sql<number>`count(*)` })
        .from(trackedRef)
        .groupBy(trackedRef.widgetPath)
        .all();
    },

    deleteRefsForPaths(paths: string[]): number {
      if (paths.length === 0) return 0;
      return db.delete(trackedRef).where(inArray(trackedRef.widgetPath, paths)).run().changes;
    },

    findRef(pluginId: string, refKey: string): StoredRef[] {
      return db
        .select()
        .from(trackedRef)
        .where(and(eq(trackedRef.pluginId, pluginId), eq(trackedRef.refKey, refKey)))
        .all()
        .map(toRef);
    },

    createLink(fromRefId: number, toRefId: number, createdBy: string): void {
      db.insert(refLink).values({ fromRefId, toRefId, createdBy, createdAt: Date.now() }).onConflictDoNothing().run();
    },

    removeLink(fromRefId: number, toRefId: number): void {
      db.delete(refLink)
        .where(and(eq(refLink.fromRefId, fromRefId), eq(refLink.toRefId, toRefId)))
        .run();
    },

    listLinks(refId: number): Array<{ fromRefId: number; toRefId: number; createdBy: string }> {
      return db
        .select({ fromRefId: refLink.fromRefId, toRefId: refLink.toRefId, createdBy: refLink.createdBy })
        .from(refLink)
        .where(or(eq(refLink.fromRefId, refId), eq(refLink.toRefId, refId)))
        .all();
    },

    stateGet(pluginId: string, key: string): unknown {
      return db
        .select({ value: pluginState.value })
        .from(pluginState)
        .where(and(eq(pluginState.pluginId, pluginId), eq(pluginState.key, key)))
        .get()?.value;
    },

    stateSet(pluginId: string, key: string, value: unknown): void {
      const updatedAt = Date.now();
      db.insert(pluginState)
        .values({ pluginId, key, value, updatedAt })
        .onConflictDoUpdate({ target: [pluginState.pluginId, pluginState.key], set: { value, updatedAt } })
        .run();
    },

    stateDelete(pluginId: string, key: string): void {
      db.delete(pluginState)
        .where(and(eq(pluginState.pluginId, pluginId), eq(pluginState.key, key)))
        .run();
    },

    stateList(pluginId: string): Array<{ key: string; value: unknown }> {
      return db
        .select({ key: pluginState.key, value: pluginState.value })
        .from(pluginState)
        .where(eq(pluginState.pluginId, pluginId))
        .all();
    },
  };
}

export type Repos = ReturnType<typeof createRepos>;

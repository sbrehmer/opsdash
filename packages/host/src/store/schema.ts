import { orm, sqliteCore } from "./drizzle.ts";

const { sql } = orm;
const { check, index, integer, primaryKey, sqliteTable, text, unique } = sqliteCore;

/** Item references tracked per widget instance. Identifiers only: no item content or status (FR-029). */
export const trackedRef = sqliteTable(
  "tracked_ref",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    widgetPath: text("widget_path").notNull(),
    pluginId: text("plugin_id").notNull(),
    refKey: text("ref_key").notNull(),
    ref: text("ref", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    unique("tracked_ref_widget_plugin_key").on(t.widgetPath, t.pluginId, t.refKey),
    index("tracked_ref_widget").on(t.widgetPath),
  ],
);

/** Links between references, possibly across plugins. Removed with either end. */
export const refLink = sqliteTable(
  "ref_link",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fromRefId: integer("from_ref_id")
      .notNull()
      .references(() => trackedRef.id, { onDelete: "cascade" }),
    toRefId: integer("to_ref_id")
      .notNull()
      .references(() => trackedRef.id, { onDelete: "cascade" }),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    unique("ref_link_pair").on(t.fromRefId, t.toRefId),
    check("ref_link_not_self", sql`${t.fromRefId} != ${t.toRefId}`),
  ],
);

/** Private key-value state per plugin namespace (FR-021). */
export const pluginState = sqliteTable(
  "plugin_state",
  {
    pluginId: text("plugin_id").notNull(),
    key: text("key").notNull(),
    value: text("value", { mode: "json" }).notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.pluginId, t.key] })],
);

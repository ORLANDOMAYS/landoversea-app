import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const migrationRunsTable = pgTable("migration_runs", {
  id: serial("id").primaryKey(),
  sourceSystem: text("source_system").notNull().default("base44"),
  mode: text("mode").notNull(), // dry_run, commit, rollback
  status: text("status").notNull(), // previewed, committed, conflicted, rolled_back, failed
  actorUserId: integer("actor_user_id")
    .references(() => usersTable.id, { onDelete: "set null" }),
  dryRunId: integer("dry_run_id"),
  snapshotHash: text("snapshot_hash").notNull(),
  snapshotId: text("snapshot_id"),
  sourceExportedAt: timestamp("source_exported_at", { withTimezone: true }),
  sourceCounts: jsonb("source_counts").$type<Record<string, number>>().notNull().default({}),
  beforeCounts: jsonb("before_counts").$type<Record<string, number>>().notNull().default({}),
  afterCounts: jsonb("after_counts").$type<Record<string, number>>().notNull().default({}),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
  error: jsonb("error").$type<Record<string, unknown>>(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
});

export const migrationMappingsTable = pgTable("migration_mappings", {
  id: serial("id").primaryKey(),
  sourceSystem: text("source_system").notNull().default("base44"),
  entityType: text("entity_type").notNull(),
  sourceId: text("source_id").notNull(),
  targetTable: text("target_table").notNull(),
  targetId: integer("target_id").notNull(),
  status: text("status").notNull(), // migrated, linked, updated, kept_replit, rolled_back
  sourceHash: text("source_hash").notNull(),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  lastRunId: integer("last_run_id")
    .notNull()
    .references(() => migrationRunsTable.id, { onDelete: "restrict" }),
  migratedAt: timestamp("migrated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  unique("migration_mapping_source_unique").on(
    table.sourceSystem,
    table.entityType,
    table.sourceId,
  ),
  unique("migration_mapping_target_unique").on(
    table.sourceSystem,
    table.targetTable,
    table.targetId,
  ),
]);

export const migrationConflictsTable = pgTable("migration_conflicts", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => migrationRunsTable.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  sourceId: text("source_id").notNull(),
  targetTable: text("target_table"),
  targetId: integer("target_id"),
  conflictType: text("conflict_type").notNull(),
  sourceData: jsonb("source_data").$type<Record<string, unknown>>().notNull().default({}),
  targetData: jsonb("target_data").$type<Record<string, unknown>>().notNull().default({}),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  targetUpdatedAt: timestamp("target_updated_at", { withTimezone: true }),
  decision: text("decision").notNull().default("pending"),
  resolutionNote: text("resolution_note"),
  resolvedBy: integer("resolved_by").references(() => usersTable.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("migration_conflict_run_source_unique").on(
    table.runId,
    table.entityType,
    table.sourceId,
    table.conflictType,
  ),
]);

export const migrationLedgerTable = pgTable("migration_ledger", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => migrationRunsTable.id, { onDelete: "restrict" }),
  sequence: integer("sequence").notNull(),
  entityType: text("entity_type").notNull(),
  sourceId: text("source_id").notNull(),
  targetTable: text("target_table").notNull(),
  targetId: integer("target_id").notNull(),
  operation: text("operation").notNull(), // insert, update, link
  beforeData: jsonb("before_data").$type<Record<string, unknown>>(),
  afterData: jsonb("after_data").$type<Record<string, unknown>>(),
  mappingBefore: jsonb("mapping_before").$type<Record<string, unknown>>(),
  mappingAfter: jsonb("mapping_after").$type<Record<string, unknown>>(),
  expectedAfterHash: text("expected_after_hash").notNull(),
  reversalStatus: text("reversal_status"),
  reversedAt: timestamp("reversed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("migration_ledger_run_sequence_unique").on(table.runId, table.sequence),
  unique("migration_ledger_run_source_operation_unique").on(
    table.runId,
    table.entityType,
    table.sourceId,
    table.operation,
  ),
]);

export type MigrationRun = typeof migrationRunsTable.$inferSelect;
export type MigrationMapping = typeof migrationMappingsTable.$inferSelect;
export type MigrationConflict = typeof migrationConflictsTable.$inferSelect;
export type MigrationLedgerEntry = typeof migrationLedgerTable.$inferSelect;
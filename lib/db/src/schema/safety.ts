import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const blocksTable = pgTable("blocks", {
  id: serial("id").primaryKey(),
  blockerId: integer("blocker_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  blockedId: integer("blocked_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  reason: text("reason"),
  isExplicit: boolean("is_explicit").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("blocks_blocker_blocked_unique").on(t.blockerId, t.blockedId),
]);

export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  reporterId: integer("reporter_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  reportedId: integer("reported_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  description: text("description"),
  messageId: integer("message_id"),
  status: text("status").notNull().default("pending"), // pending, reviewed, dismissed, actioned
  adminNotes: text("admin_notes"),
  reviewedBy: integer("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Immutable audit trail of report status transitions so moderation actions are
// traceable and cannot silently jump between terminal states.
export const reportActionsTable = pgTable("report_actions", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id")
    .notNull()
    .references(() => reportsTable.id, { onDelete: "cascade" }),
  adminId: integer("admin_id").references(() => usersTable.id, { onDelete: "set null" }),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const safetyTipsTable = pgTable("safety_tips", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  category: text("category").notNull().default("general"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("safety_tips_title_unique").on(t.title),
]);

export type Block = typeof blocksTable.$inferSelect;
export type Report = typeof reportsTable.$inferSelect;
export type ReportAction = typeof reportActionsTable.$inferSelect;

import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const swipesTable = pgTable("swipes", {
  id: serial("id").primaryKey(),
  swiperId: integer("swiper_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  targetId: integer("target_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  action: text("action").notNull(), // like, pass, superlike
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("unique_swipe_pair").on(t.swiperId, t.targetId),
  uniqueIndex("swipes_scoped_idempotency_unique")
    .on(t.swiperId, t.targetId, t.action, t.idempotencyKey),
]);

export const matchesTable = pgTable("matches", {
  id: serial("id").primaryKey(),
  userId1: integer("user_id_1")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  userId2: integer("user_id_2")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  conversationId: integer("conversation_id"), // set after conversation created
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("unique_match_pair").on(t.userId1, t.userId2),
]);

export const insertSwipeSchema = createInsertSchema(swipesTable).omit({
  id: true,
  createdAt: true,
});
export const insertMatchSchema = createInsertSchema(matchesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertSwipe = z.infer<typeof insertSwipeSchema>;
export type Swipe = typeof swipesTable.$inferSelect;
export type Match = typeof matchesTable.$inferSelect;

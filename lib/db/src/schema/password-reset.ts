import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Password reset tokens.
 *
 * Security model:
 * - Only a hash of the token is stored (never the raw token).
 * - Tokens are single-use: `usedAt` is stamped on redemption.
 * - Tokens are short-lived: `expiresAt` enforces a short expiry window.
 */
export const passwordResetTokensTable = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertPasswordResetTokenSchema = createInsertSchema(
  passwordResetTokensTable,
).omit({
  id: true,
  createdAt: true,
});

export type InsertPasswordResetToken = z.infer<
  typeof insertPasswordResetTokenSchema
>;
export type PasswordResetToken =
  typeof passwordResetTokensTable.$inferSelect;

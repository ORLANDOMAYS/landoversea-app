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
 * Email verification tokens.
 *
 * Security model (mirrors password_reset_tokens):
 * - Only a hash of the token is stored (never the raw token).
 * - Tokens become usable only after delivery is accepted.
 * - Tokens are single-use: `usedAt` is stamped on redemption.
 * - Tokens are short-lived: `expiresAt` enforces a short expiry window.
 */
export const emailVerificationTokensTable = pgTable(
  "email_verification_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    deliveryAcceptedAt: timestamp("delivery_accepted_at", {
      withTimezone: true,
    }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    // Failed guesses are tracked only for the authenticated account's newest
    // token. They are never returned by the API.
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const insertEmailVerificationTokenSchema = createInsertSchema(
  emailVerificationTokensTable,
).omit({
  id: true,
  createdAt: true,
});

export type InsertEmailVerificationToken = z.infer<
  typeof insertEmailVerificationTokenSchema
>;
export type EmailVerificationToken =
  typeof emailVerificationTokensTable.$inferSelect;

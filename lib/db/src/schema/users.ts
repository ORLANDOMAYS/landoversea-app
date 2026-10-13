import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  boolean,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userRoleEnum = pgEnum("user_role", ["user", "coach", "admin"]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: userRoleEnum("role").notNull().default("user"),
  isProfileComplete: boolean("is_profile_complete").notNull().default(false),
  // Email verification lifecycle. Existing accounts default to unverified but
  // remain fully usable; verification is not (yet) a hard gate on every route.
  isEmailVerified: boolean("is_email_verified").notNull().default(false),
  // Opt-in gate: legacy rows remain false after migration; registration sets
  // this true explicitly for newly-created accounts.
  verificationRequired: boolean("verification_required").notNull().default(false),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  // Audit evidence that the user explicitly accepted the 18+ requirement.
  // Nullable only so pre-existing accounts remain valid after a non-destructive migration.
  ageRequirementAcceptedAt: timestamp("age_requirement_accepted_at", { withTimezone: true }),
  isPremium: boolean("is_premium").notNull().default(false),
  isRestricted: boolean("is_restricted").notNull().default(false),
  restrictionReason: text("restriction_reason"),
  isTest: boolean("is_test").notNull().default(false),
  isInternal: boolean("is_internal").notNull().default(false),
  moderationScore: integer("moderation_score").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  boolean,
  real,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const premiumSubscriptionsTable = pgTable("premium_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  planId: text("plan_id"), // weekly, monthly, annual
  status: text("status").notNull().default("none"), // authoritative Stripe status for web rows
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  nextBillingDate: timestamp("next_billing_date", { withTimezone: true }),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionCreatedAt: timestamp("stripe_subscription_created_at", { withTimezone: true }),
  stripeLastEventCreatedAt: timestamp("stripe_last_event_created_at", { withTimezone: true }),
  platform: text("platform").notNull().default("web"), // web, ios, android
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("premium_subscriptions_user_unique").on(t.userId),
  uniqueIndex("premium_subscriptions_stripe_subscription_unique").on(t.stripeSubscriptionId),
]);

// This is an authorization cache, not a product/subscription catalog. RevenueCat
// remains authoritative and the short cache deadline bounds access during an
// upstream outage.
export const nativePremiumEntitlementsTable = pgTable("native_premium_entitlements", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("revenuecat"),
  appUserId: text("app_user_id").notNull(),
  entitlementId: text("entitlement_id").notNull().default("premium"),
  productId: text("product_id"),
  isActive: boolean("is_active").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  cacheValidUntil: timestamp("cache_valid_until", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).notNull(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("native_premium_entitlements_user_unique").on(t.userId),
  uniqueIndex("native_premium_entitlements_app_user_unique").on(t.appUserId),
]);

export const superlikesTable = pgTable("superlikes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  usedCount: integer("used_count").notNull().default(0),
  lastResetAt: timestamp("last_reset_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPremiumSubscriptionSchema = createInsertSchema(premiumSubscriptionsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export type PremiumSubscription = typeof premiumSubscriptionsTable.$inferSelect;
export type NativePremiumEntitlement = typeof nativePremiumEntitlementsTable.$inferSelect;

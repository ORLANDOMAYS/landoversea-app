import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  boolean,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Durable delivery record / outbox for a single notification on a single
// channel (email, push, webhook). One row per (notification, channel). The
// worker/dispatcher advances status and records attempts + backoff schedule.
export const notificationDeliveriesTable = pgTable("notification_deliveries", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  // Links to the durable in-app notification this delivery mirrors.
  notificationId: integer("notification_id"),
  channel: text("channel").notNull(), // email, push, webhook
  // pending: queued, not yet attempted
  // sent: provider accepted the dispatch
  // failed: exhausted retries / permanent failure
  // skipped: no provider configured / no destination — truthfully not sent
  // unavailable: provider configured but destination missing (e.g. no token)
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  lastError: text("last_error"),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  providerMessageId: text("provider_message_id"),
  // Idempotency key so the same logical event cannot enqueue duplicate rows.
  idempotencyKey: text("idempotency_key").notNull(),
  // Non-secret metadata only (title/type/target kind). Never store secrets or
  // full private payloads here.
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("notification_deliveries_idem_channel_unique").on(t.idempotencyKey, t.channel),
]);

// Registered device push tokens for a user. A token is unique so the same
// device registering twice updates in place.
export const pushTokensTable = pgTable("push_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  platform: text("platform").notNull().default("web"), // ios, android, web
  provider: text("provider").notNull().default("expo"), // expo, fcm, apns
  isActive: boolean("is_active").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Server-side per-user notification channel preferences.
export const notificationPreferencesTable = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" })
    .unique(),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  pushEnabled: boolean("push_enabled").notNull().default(true),
  bookingEnabled: boolean("booking_enabled").notNull().default(true),
  showOnlineStatus: boolean("show_online_status").notNull().default(true),
  readReceipts: boolean("read_receipts").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationDelivery = typeof notificationDeliveriesTable.$inferSelect;
export type PushToken = typeof pushTokensTable.$inferSelect;
export type NotificationPreference = typeof notificationPreferencesTable.$inferSelect;

import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { bookingsTable, coachesTable } from "./coaching";

// A payment for a booking. Amount/currency are server-owned. Provider IDs and
// lifecycle state persist so webhook retries are idempotent and safe.
export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id")
    .notNull()
    .references(() => bookingsTable.id, { onDelete: "cascade" }),
  clientId: integer("client_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  coachId: integer("coach_id")
    .notNull()
    .references(() => coachesTable.id, { onDelete: "cascade" }),
  // Amount in the currency's minor unit (e.g. cents). Server-owned.
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  // requires_payment: intent created, awaiting client action
  // processing: client submitted, provider processing
  // succeeded: payment captured
  // failed: payment failed
  // refunded / partially_refunded: money returned
  // provider_unavailable: no Stripe config — nothing charged
  status: text("status").notNull().default("requires_payment"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeChargeId: text("stripe_charge_id"),
  clientSecret: text("client_secret"),
  lastError: text("last_error"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("payments_booking_unique").on(t.bookingId),
  uniqueIndex("payments_payment_intent_unique").on(t.stripePaymentIntentId),
  uniqueIndex("payments_checkout_session_unique").on(t.stripeCheckoutSessionId),
]);

export const refundsTable = pgTable("refunds", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id")
    .notNull()
    .references(() => paymentsTable.id, { onDelete: "cascade" }),
  bookingId: integer("booking_id")
    .notNull()
    .references(() => bookingsTable.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  status: text("status").notNull().default("pending"), // pending, succeeded, failed
  reason: text("reason"),
  stripeRefundId: text("stripe_refund_id"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("refunds_stripe_refund_unique").on(t.stripeRefundId),
]);

// Coach payout transfer for a completed & paid session. Created only after an
// eligible completed session and an approved/connected coach account. Uses an
// idempotency key; failures are recorded for reconciliation/retry.
export const coachTransfersTable = pgTable("coach_transfers", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id")
    .notNull()
    .references(() => paymentsTable.id, { onDelete: "cascade" }),
  bookingId: integer("booking_id")
    .notNull()
    .references(() => bookingsTable.id, { onDelete: "cascade" }),
  coachId: integer("coach_id")
    .notNull()
    .references(() => coachesTable.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  // pending: eligible, not yet transferred
  // succeeded: transfer created at provider
  // failed: transfer failed — retryable, recorded for reconciliation
  // provider_unavailable: no Stripe config
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  destinationAccountId: text("destination_account_id"),
  stripeTransferId: text("stripe_transfer_id"),
  stripePayoutId: text("stripe_payout_id"),
  payoutStatus: text("payout_status"), // pending, paid, failed (from payout.* webhooks)
  idempotencyKey: text("idempotency_key").notNull(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  // One transfer per booking (a session is paid out once).
  uniqueIndex("coach_transfers_booking_unique").on(t.bookingId),
  uniqueIndex("coach_transfers_idem_unique").on(t.idempotencyKey),
]);

// Ledger of payment-provider webhook event IDs already processed — enables
// idempotent webhook handling under provider retries.
export const processedWebhookEventsTable = pgTable("processed_webhook_events", {
  id: serial("id").primaryKey(),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  source: text("source").notNull().default("stripe_connect"),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("processed_webhook_events_source_event_unique").on(t.source, t.eventId),
]);

export type Payment = typeof paymentsTable.$inferSelect;
export type Refund = typeof refundsTable.$inferSelect;
export type CoachTransfer = typeof coachTransfersTable.$inferSelect;
export type ProcessedWebhookEvent = typeof processedWebhookEventsTable.$inferSelect;

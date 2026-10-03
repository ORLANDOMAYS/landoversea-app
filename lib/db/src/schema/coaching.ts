import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  boolean,
  real,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

export const coachesTable = pgTable("coaches", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" })
    .unique(),
  displayName: text("display_name").notNull(),
  bio: text("bio"),
  photoUrl: text("photo_url"),
  specialties: text("specialties").array().notNull().default([]),
  languages: text("languages").array().notNull().default([]),
  sessionLengthsMinutes: integer("session_lengths_minutes").array().notNull().default([]),
  ratesPerHour: real("rates_per_hour"),
  // Optional per-length pricing, e.g. [{minutes:15,price:20},{minutes:30,price:35},{minutes:60,price:60}].
  pricingTiers: jsonb("pricing_tiers").notNull().default([]),
  currency: text("currency").notNull().default("USD"),
  rating: real("rating"),
  reviewCount: integer("review_count").notNull().default(0),
  isVerified: boolean("is_verified").notNull().default(false),
  verificationStatus: text("verification_status").notNull().default("unsubmitted"),
  // Payout readiness is derived from real Stripe Connect onboarding, never faked.
  isPayoutReady: boolean("is_payout_ready").notNull().default(false),
  payoutStatus: text("payout_status").notNull().default("not_started"), // not_started, pending, verified, restricted
  stripeAccountId: text("stripe_account_id"),
  payoutDetailsSubmitted: boolean("payout_details_submitted").notNull().default(false),
  availabilitySlots: jsonb("availability_slots").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const bookingsTable = pgTable("bookings", {
  id: serial("id").primaryKey(),
  coachId: integer("coach_id")
    .notNull()
    .references(() => coachesTable.id, { onDelete: "cascade" }),
  clientId: integer("client_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"), // pending, confirmed, completed, cancelled, no_show
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  rateAtBooking: real("rate_at_booking"),
  currency: text("currency").notNull().default("USD"),
  notes: text("notes"),
  coachNotes: text("coach_notes"),
  zoomLink: text("zoom_link"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const reviewsTable = pgTable("reviews", {
  id: serial("id").primaryKey(),
  coachId: integer("coach_id")
    .notNull()
    .references(() => coachesTable.id, { onDelete: "cascade" }),
  clientId: integer("client_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  bookingId: integer("booking_id").references(() => bookingsTable.id),
  rating: real("rating").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // A client may leave at most one review per completed booking.
  uniqueIndex("reviews_booking_unique").on(t.bookingId),
]);

// Coach credential / identity documents. Only the private object-storage path
// and queryable metadata are stored here — never the file bytes.
export const coachCredentialsTable = pgTable("coach_credentials", {
  id: serial("id").primaryKey(),
  coachId: integer("coach_id")
    .notNull()
    .references(() => coachesTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // certification, id_document, background_check, resume
  title: text("title"),
  objectPath: text("object_path").notNull(), // /objects/... in private storage
  originalName: text("original_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  status: text("status").notNull().default("pending"), // pending, approved, rejected
  reviewedBy: integer("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("coach_credentials_object_path_unique").on(t.objectPath),
]);

export const clientSubscriptionsTable = pgTable("client_subscriptions", {
  id: serial("id").primaryKey(),
  coachId: integer("coach_id")
    .notNull()
    .references(() => coachesTable.id, { onDelete: "cascade" }),
  clientId: integer("client_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  planName: text("plan_name"),
  sessionsPerMonth: integer("sessions_per_month"),
  monthlyRate: real("monthly_rate"),
  status: text("status").notNull().default("active"), // active, paused, cancelled
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  nextBillingAt: timestamp("next_billing_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("client_subscriptions_active_pair_unique")
    .on(t.clientId, t.coachId)
    .where(sql`${t.status} = 'active'`),
]);

export const coachingPlansTable = pgTable("coaching_plans", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  coachId: integer("coach_id")
    .notNull()
    .references(() => coachesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  goals: text("goals").array().notNull().default([]),
  currentProgressPercent: integer("current_progress_percent").notNull().default(0),
  milestones: text("milestones").array().notNull().default([]),
  notes: text("notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const groupWorkshopsTable = pgTable("group_workshops", {
  id: serial("id").primaryKey(),
  coachId: integer("coach_id")
    .notNull()
    .references(() => coachesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  maxParticipants: integer("max_participants").notNull().default(20),
  currentParticipants: integer("current_participants").notNull().default(0),
  price: real("price"),
  currency: text("currency").notNull().default("USD"),
  zoomLink: text("zoom_link"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("group_workshops_coach_title_unique").on(t.coachId, t.title),
]);

export const workshopEnrollmentsTable = pgTable("workshop_enrollments", {
  id: serial("id").primaryKey(),
  workshopId: integer("workshop_id")
    .notNull()
    .references(() => groupWorkshopsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("enrolled"), // enrolled, waitlisted, cancelled
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("workshop_enrollments_workshop_user_unique").on(t.workshopId, t.userId),
]);

export const coachAuditEventsTable = pgTable("coach_audit_events", {
  id: serial("id").primaryKey(),
  coachId: integer("coach_id")
    .notNull()
    .references(() => coachesTable.id, { onDelete: "cascade" }),
  actorUserId: integer("actor_user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  // verification | payout
  field: text("field").notNull(),
  // e.g. submitted, approved, rejected, payout_enabled, payout_disabled
  action: text("action").notNull(),
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Group conversation attached to a workshop for enrolled participants.
export const workshopConversationsTable = pgTable("workshop_conversations", {
  id: serial("id").primaryKey(),
  workshopId: integer("workshop_id")
    .notNull()
    .references(() => groupWorkshopsTable.id, { onDelete: "cascade" })
    .unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Coach = typeof coachesTable.$inferSelect;

export type CoachAuditEvent = typeof coachAuditEventsTable.$inferSelect;
export type Booking = typeof bookingsTable.$inferSelect;
export type Review = typeof reviewsTable.$inferSelect;
export type ClientSubscription = typeof clientSubscriptionsTable.$inferSelect;
export type CoachingPlan = typeof coachingPlansTable.$inferSelect;
export type GroupWorkshop = typeof groupWorkshopsTable.$inferSelect;
export type CoachCredential = typeof coachCredentialsTable.$inferSelect;
export type WorkshopEnrollment = typeof workshopEnrollmentsTable.$inferSelect;
export type WorkshopConversation = typeof workshopConversationsTable.$inferSelect;

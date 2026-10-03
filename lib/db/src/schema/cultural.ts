import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const culturalStampsTable = pgTable("cultural_stamps", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  country: text("country").notNull(),
  title: text("title").notNull().default("Cultural Explorer"),
  iconUrl: text("icon_url"),
  earnedAt: timestamp("earned_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("cultural_stamps_user_country_unique").on(t.userId, t.country),
]);

export const culturalFactsTable = pgTable("cultural_facts", {
  id: serial("id").primaryKey(),
  country: text("country").notNull(),
  fact: text("fact").notNull(),
  category: text("category"),
  // Community-submitted facts go through moderation before display.
  status: text("status").notNull().default("approved"), // pending, approved, rejected
  submittedBy: integer("submitted_by").references(() => usersTable.id, { onDelete: "set null" }),
  reviewedBy: integer("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("cultural_facts_country_fact_unique").on(t.country, t.fact),
]);

export const culturalEventsTable = pgTable("cultural_events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  country: text("country").notNull(),
  date: timestamp("date", { withTimezone: true }).notNull(),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("cultural_events_title_country_unique").on(t.title, t.country),
]);

export const eventRsvpsTable = pgTable("event_rsvps", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id")
    .notNull()
    .references(() => culturalEventsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("event_rsvps_event_user_unique").on(t.eventId, t.userId),
]);

export const tribesTable = pgTable("tribes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  country: text("country"),
  language: text("language"),
  iconUrl: text("icon_url"),
  memberCount: integer("member_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("tribes_name_unique").on(t.name),
]);

export const tribeMembershipsTable = pgTable("tribe_memberships", {
  id: serial("id").primaryKey(),
  tribeId: integer("tribe_id")
    .notNull()
    .references(() => tribesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("tribe_memberships_tribe_user_unique").on(t.tribeId, t.userId),
]);

export const conversationStartersTable = pgTable("conversation_starters", {
  id: serial("id").primaryKey(),
  text: text("text").notNull(),
  country: text("country"),
  category: text("category"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("conversation_starters_text_unique").on(t.text),
]);

// Persisted culture/community leaderboard scores. One row per user; recomputed
// from passport stamps and engagement so rankings are real, not client-faked.
export const leaderboardScoresTable = pgTable("leaderboard_scores", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" })
    .unique(),
  passportScore: integer("passport_score").notNull().default(0),
  engagementScore: integer("engagement_score").notNull().default(0),
  totalScore: integer("total_score").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type CulturalStamp = typeof culturalStampsTable.$inferSelect;
export type CulturalEvent = typeof culturalEventsTable.$inferSelect;
export type Tribe = typeof tribesTable.$inferSelect;
export type CulturalFact = typeof culturalFactsTable.$inferSelect;
export type LeaderboardScore = typeof leaderboardScoresTable.$inferSelect;

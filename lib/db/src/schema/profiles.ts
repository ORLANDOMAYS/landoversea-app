import {
  pgTable,
  serial,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const profilesTable = pgTable("profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" })
    .unique(),
  name: text("name").notNull().default(""),
  age: integer("age"),
  bio: text("bio"),
  occupation: text("occupation"),
  height: integer("height"),
  gender: text("gender"),
  lookingFor: text("looking_for"),
  relationshipGoal: text("relationship_goal"),
  primaryLanguage: text("primary_language"),
  otherLanguages: text("other_languages").array().notNull().default([]),
  learningLanguages: text("learning_languages").array().notNull().default([]),
  country: text("country"),
  city: text("city"),
  countriesOfInterest: text("countries_of_interest").array().notNull().default([]),
  culturalInterests: text("cultural_interests").array().notNull().default([]),
  interests: text("interests").array().notNull().default([]),
  travelGoals: text("travel_goals"),
  longDistanceOpenness: boolean("long_distance_openness").notNull().default(false),
  relocationOpenness: boolean("relocation_openness").notNull().default(false),
  communicationPreferences: text("communication_preferences").array().notNull().default([]),
  preferredMinAge: integer("preferred_min_age").notNull().default(18),
  preferredMaxAge: integer("preferred_max_age").notNull().default(100),
  preferredGender: text("preferred_gender"),
  // Discover advanced preferences (owner-independent, persisted per profile).
  preferredRelationshipGoal: text("preferred_relationship_goal"),
  preferredInterestsOverlap: boolean("preferred_interests_overlap").notNull().default(false),
  preferredVerifiedOnly: boolean("preferred_verified_only").notNull().default(false),
  preferredLongDistance: boolean("preferred_long_distance").notNull().default(false),
  preferredRelocation: boolean("preferred_relocation").notNull().default(false),
  voiceIntroUrl: text("voice_intro_url"),
  isVerified: boolean("is_verified").notNull().default(false),
  verificationStatus: text("verification_status").notNull().default("none"),
  discoveryEnabled: boolean("discovery_enabled").notNull().default(true),
  globalDiscovery: boolean("global_discovery").notNull().default(true),
  completionPercent: integer("completion_percent").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const profilePhotosTable = pgTable("profile_photos", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  position: integer("position").notNull().default(0),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProfileSchema = createInsertSchema(profilesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertProfilePhotoSchema = createInsertSchema(profilePhotosTable).omit({
  id: true,
  createdAt: true,
});

export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Profile = typeof profilesTable.$inferSelect;
export type ProfilePhoto = typeof profilePhotosTable.$inferSelect;

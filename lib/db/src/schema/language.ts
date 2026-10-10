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

export const languageStreaksTable = pgTable("language_streaks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" })
    .unique(),
  currentStreak: integer("current_streak").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  xpTotal: integer("xp_total").notNull().default(0),
  level: text("level").notNull().default("Beginner"),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const languageQuizzesTable = pgTable("language_quizzes", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  language: text("language").notNull(),
  category: text("category").notNull().default("vocabulary"), // vocabulary, grammar, comprehension, cultural
  questionCount: integer("question_count").notNull().default(10),
  difficulty: text("difficulty").notNull().default("beginner"), // beginner, intermediate, advanced
  xpReward: integer("xp_reward").notNull().default(50),
  questions: jsonb("questions").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("language_quizzes_title_language_unique").on(t.title, t.language),
]);

export const quizAttemptsTable = pgTable("quiz_attempts", {
  id: serial("id").primaryKey(),
  quizId: integer("quiz_id")
    .notNull()
    .references(() => languageQuizzesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  total: integer("total").notNull(),
  passed: boolean("passed").notNull().default(false),
  xpEarned: integer("xp_earned").notNull().default(0),
  answers: jsonb("answers").notNull().default([]),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiCoachMessagesTable = pgTable("ai_coach_messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // user, assistant
  content: text("content").notNull(),
  targetLanguage: text("target_language"),
  mode: text("mode").notNull().default("freeform"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LanguageStreak = typeof languageStreaksTable.$inferSelect;
export type LanguageQuiz = typeof languageQuizzesTable.$inferSelect;
export type AiCoachMessage = typeof aiCoachMessagesTable.$inferSelect;

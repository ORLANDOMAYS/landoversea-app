import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  boolean,
  jsonb,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const conversationsTable = pgTable("conversations", {
  id: serial("id").primaryKey(),
  type: text("type").notNull().default("direct"), // direct, group
  matchId: integer("match_id"),
  title: text("title"),
  // Canonical, order-independent identity for a direct pair (e.g. "12:45" where 12 < 45).
  // Enforced unique so a pair can only ever have one reusable direct conversation.
  directKey: text("direct_key"),
  ownerId: integer("owner_id").references(() => usersTable.id, { onDelete: "set null" }),
  // Deprecated: translation preferences are participant-scoped. Retained for
  // backwards-compatible reads while older deployments roll forward.
  translationEnabled: boolean("translation_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("conversations_direct_key_unique").on(t.directKey),
]);

export const conversationParticipantsTable = pgTable("conversation_participants", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"), // owner, admin, member
  isPinned: boolean("is_pinned").notNull().default(false),
  isMuted: boolean("is_muted").notNull().default(false),
  translationEnabled: boolean("translation_enabled").notNull().default(false),
  translationLanguage: text("translation_language"),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("conversation_participants_conv_user_unique").on(t.conversationId, t.userId),
]);

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversationsTable.id, { onDelete: "cascade" }),
  senderId: integer("sender_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  content: text("content"),
  contentType: text("content_type").notNull().default("text"), // text, image, audio, voice, system
  attachmentUrl: text("attachment_url"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  detectedLanguage: text("detected_language"),
  detectionStatus: text("detection_status").notNull().default("unknown"), // unknown, pending, done, failed, not_applicable
  detectedLanguageAt: timestamp("detected_language_at", { withTimezone: true }),
  detectionError: text("detection_error"),
  reactions: jsonb("reactions").notNull().default([]),
  // Legacy clients send idempotencyKey; newer clients send clientRequestId.
  // Both are scoped to sender + conversation, preventing cross-conversation
  // row disclosure while making ordinary retries deterministic.
  idempotencyKey: text("idempotency_key"),
  clientRequestId: text("client_request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("messages_sender_conversation_idem_unique")
    .on(t.senderId, t.conversationId, t.idempotencyKey),
  uniqueIndex("messages_sender_conversation_request_unique")
    .on(t.senderId, t.conversationId, t.clientRequestId),
]);

export const translationsTable = pgTable("translations", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id")
    .notNull()
    .references(() => messagesTable.id, { onDelete: "cascade" }),
  targetLanguage: text("target_language").notNull(),
  sourceLanguage: text("source_language"),
  translatedContent: text("translated_content").notNull(),
  status: text("status").notNull().default("done"), // pending, done, failed
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  // One cached translation per (message, target language). Preserves originals; unique per target.
  uniqueIndex("translations_message_target_unique").on(t.messageId, t.targetLanguage),
]);

export const insertConversationSchema = createInsertSchema(conversationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMessageSchema = createInsertSchema(messagesTable).omit({ id: true, createdAt: true });
export const insertTranslationSchema = createInsertSchema(translationsTable).omit({ id: true, createdAt: true, updatedAt: true });

export type Conversation = typeof conversationsTable.$inferSelect;
export type ConversationParticipant = typeof conversationParticipantsTable.$inferSelect;
export type Message = typeof messagesTable.$inferSelect;
export type Translation = typeof translationsTable.$inferSelect;

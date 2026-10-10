import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  conversationsTable,
  db,
  messagesTable,
  translationsTable,
  usersTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { persistSuccessfulTranslation } from "../src/lib/translation-cache";

test("the first completed message-target translation stays authoritative", async () => {
  const [user] = await db.insert(usersTable).values({
    email: `translation-cache-${randomUUID()}@example.com`,
    passwordHash: "x",
    name: "Translation Cache Test",
    isTest: true,
  }).returning();
  const [conversation] = await db.insert(conversationsTable).values({
    type: "direct",
    ownerId: user.id,
  }).returning();
  const [message] = await db.insert(messagesTable).values({
    conversationId: conversation.id,
    senderId: user.id,
    content: "hola",
    contentType: "text",
  }).returning();

  try {
    const [firstResult, secondResult] = await Promise.all([
      persistSuccessfulTranslation(message.id, "en", "es", "hello-one"),
      persistSuccessfulTranslation(message.id, "en", "es", "hello-two"),
    ]);
    assert.equal(firstResult.translatedContent, secondResult.translatedContent);
    assert.ok(["hello-one", "hello-two"].includes(firstResult.translatedContent));

    await persistSuccessfulTranslation(message.id, "en", "es", "must-not-replace");
    const [cached] = await db.select().from(translationsTable).where(and(
      eq(translationsTable.messageId, message.id),
      eq(translationsTable.targetLanguage, "en"),
    ));
    assert.equal(cached.translatedContent, firstResult.translatedContent);
    assert.notEqual(cached.translatedContent, "must-not-replace");
  } finally {
    await db.delete(conversationsTable).where(eq(conversationsTable.id, conversation.id));
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
  }
});
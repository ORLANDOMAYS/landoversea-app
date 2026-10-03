import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  bookingsTable,
  coachCredentialsTable,
  coachesTable,
  conversationsTable,
  db,
  messagesTable,
  paymentsTable,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

test("user deletion cascades authored messages, coach credentials, bookings, and payment metadata", async () => {
  const suffix = randomUUID();
  const [owner] = await db.insert(usersTable).values({
    email: `cascade-owner-${suffix}@example.com`,
    passwordHash: "not-used",
    name: "Cascade Owner",
    isTest: true,
  }).returning();
  const [client] = await db.insert(usersTable).values({
    email: `cascade-client-${suffix}@example.com`,
    passwordHash: "not-used",
    name: "Cascade Client",
    isTest: true,
  }).returning();

  let conversationId: number | undefined;
  try {
    const [conversation] = await db.insert(conversationsTable).values({
      ownerId: owner.id,
      directKey: `cascade-${suffix}`,
    }).returning();
    conversationId = conversation.id;
    const [message] = await db.insert(messagesTable).values({
      conversationId: conversation.id,
      senderId: owner.id,
      content: "deleted with its author",
    }).returning();
    const [coach] = await db.insert(coachesTable).values({
      userId: owner.id,
      displayName: "Cascade Coach",
    }).returning();
    const [credential] = await db.insert(coachCredentialsTable).values({
      coachId: coach.id,
      kind: "certification",
      objectPath: `/objects/cascade-${suffix}`,
      originalName: "certificate.pdf",
      contentType: "application/pdf",
      size: 9,
    }).returning();
    const [booking] = await db.insert(bookingsTable).values({
      coachId: coach.id,
      clientId: client.id,
      scheduledAt: new Date(Date.now() + 86_400_000),
      durationMinutes: 60,
    }).returning();
    const [payment] = await db.insert(paymentsTable).values({
      bookingId: booking.id,
      clientId: client.id,
      coachId: coach.id,
      amount: 5000,
      metadata: { test: "cascade" },
    }).returning();

    await db.delete(usersTable).where(eq(usersTable.id, owner.id));

    assert.equal((await db.select().from(messagesTable).where(eq(messagesTable.id, message.id))).length, 0);
    assert.equal((await db.select().from(coachCredentialsTable).where(eq(coachCredentialsTable.id, credential.id))).length, 0);
    assert.equal((await db.select().from(bookingsTable).where(eq(bookingsTable.id, booking.id))).length, 0);
    assert.equal((await db.select().from(paymentsTable).where(eq(paymentsTable.id, payment.id))).length, 0);

    const [preservedConversation] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, conversation.id));
    assert.ok(preservedConversation, "shared conversation row is preserved");
    assert.equal(preservedConversation.ownerId, null);
  } finally {
    if (conversationId !== undefined) {
      await db.delete(conversationsTable).where(eq(conversationsTable.id, conversationId));
    }
    await db.delete(usersTable).where(eq(usersTable.id, client.id));
    await db.delete(usersTable).where(eq(usersTable.id, owner.id));
  }
});
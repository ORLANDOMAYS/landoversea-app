/**
 * Deterministic unit tests for the notification outbox + dispatcher.
 *
 * These talk to the database directly and inject fake providers — no running
 * server, no real email/push credentials required.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  db,
  usersTable,
  notificationsTable,
  notificationDeliveriesTable,
  notificationPreferencesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  enqueueBookingNotification,
  enqueueNotification,
  processDeliveries,
} from "../src/lib/notificationDispatch";
import {
  setNotificationProvidersForTest,
  type NotificationProviders,
} from "../src/lib/notificationProviders";

async function makeUser(): Promise<number> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: `notif-${randomUUID()}@example.com`,
      passwordHash: "x",
      name: "Notify Test",
      isTest: true,
    })
    .returning();
  return u.id;
}

function fakeProviders(behavior: {
  emailFail?: boolean;
  pushFail?: boolean;
  sent?: string[];
}): NotificationProviders {
  return {
    email: {
      name: "fake-email",
      async sendEmail() {
        if (behavior.emailFail) throw new Error("transient email error");
        behavior.sent?.push("email");
        return { providerMessageId: "email-msg-1" };
      },
    },
    push: {
      name: "fake-push",
      async sendPush() {
        if (behavior.pushFail) throw new Error("transient push error");
        behavior.sent?.push("push");
        return { providerMessageId: "push-msg-1" };
      },
    },
    webhook: null,
  };
}

after(() => setNotificationProvidersForTest(null));

test("new booking enqueues in-app notification + email/push outbox rows", async () => {
  const userId = await makeUser();
  const key = `booking:new:test:${randomUUID()}`;
  await enqueueBookingNotification({
    userId,
    type: "booking",
    title: "New booking request",
    body: "You have a new booking",
    relatedId: 12345,
    relatedType: "booking",
    idempotencyKey: key,
  });

  const notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.userId, userId));
  assert.equal(notifs.length, 1, "in-app notification created");
  assert.equal(notifs[0].type, "booking");

  const deliveries = await db
    .select()
    .from(notificationDeliveriesTable)
    .where(eq(notificationDeliveriesTable.idempotencyKey, key));
  const channels = deliveries.map((d) => d.channel).sort();
  assert.deepEqual(channels, ["email", "push"], "outbox rows for email + push");
  assert.ok(deliveries.every((d) => d.status === "pending"), "start pending");
});

test("new message enqueues one in-app notification and durable email/push rows", async () => {
  const userId = await makeUser();
  const key = `message:test:${randomUUID()}`;
  await enqueueNotification({
    userId,
    type: "message",
    title: "New message",
    body: "A new chat message",
    relatedId: 456,
    relatedType: "conversation",
    idempotencyKey: key,
  });
  await enqueueNotification({
    userId,
    type: "message",
    title: "New message",
    body: "A new chat message",
    relatedId: 456,
    relatedType: "conversation",
    idempotencyKey: key,
  });

  const notifications = await db.select().from(notificationsTable)
    .where(eq(notificationsTable.idempotencyKey, key));
  const deliveries = await db.select().from(notificationDeliveriesTable)
    .where(eq(notificationDeliveriesTable.idempotencyKey, key));
  assert.equal(notifications.length, 1);
  assert.deepEqual(deliveries.map((row) => row.channel).sort(), ["email", "push"]);
});

test("enqueue is idempotent on the idempotency key", async () => {
  const userId = await makeUser();
  const key = `idem:${randomUUID()}`;
  const input = {
    userId,
    type: "booking",
    title: "t",
    body: "b",
    idempotencyKey: key,
  };
  await enqueueBookingNotification(input);
  await enqueueBookingNotification(input); // replay

  const notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.userId, userId));
  assert.equal(notifs.length, 1, "no duplicate in-app notification");
  const deliveries = await db
    .select()
    .from(notificationDeliveriesTable)
    .where(eq(notificationDeliveriesTable.idempotencyKey, key));
  assert.equal(deliveries.length, 2, "exactly one row per channel");
});

test("booking notification preference disables in-app and out-of-band delivery", async () => {
  const userId = await makeUser();
  await db.insert(notificationPreferencesTable).values({
    userId,
    bookingEnabled: false,
  });
  const key = `disabled:${randomUUID()}`;
  await enqueueBookingNotification({
    userId,
    type: "booking",
    title: "Should not appear",
    body: "Booking notification disabled",
    idempotencyKey: key,
  });

  const notifications = await db.select().from(notificationsTable)
    .where(eq(notificationsTable.userId, userId));
  const deliveries = await db.select().from(notificationDeliveriesTable)
    .where(eq(notificationDeliveriesTable.idempotencyKey, key));
  assert.equal(notifications.length, 0);
  assert.equal(deliveries.length, 0);
});

test("missing provider leaves a truthful skipped state (never fake success)", async () => {
  setNotificationProvidersForTest({ email: null, push: null, webhook: null });
  const userId = await makeUser();
  const key = `skip:${randomUUID()}`;
  await enqueueBookingNotification({ userId, type: "booking", title: "t", body: "b", idempotencyKey: key });
  await processDeliveries({ ignoreSchedule: true, limit: 100 });

  const deliveries = await db
    .select()
    .from(notificationDeliveriesTable)
    .where(eq(notificationDeliveriesTable.idempotencyKey, key));
  assert.ok(deliveries.every((d) => d.status === "skipped"), "all skipped, not sent");
  assert.ok(deliveries.every((d) => d.sentAt === null), "nothing marked sent");
});

test("configured provider with no destination -> unavailable (no push token)", async () => {
  const sent: string[] = [];
  setNotificationProvidersForTest(fakeProviders({ sent }));
  const userId = await makeUser(); // has email, but no push token
  const key = `dest:${randomUUID()}`;
  await enqueueBookingNotification({ userId, type: "booking", title: "t", body: "b", idempotencyKey: key });
  await processDeliveries({ ignoreSchedule: true, limit: 100 });

  const deliveries = await db
    .select()
    .from(notificationDeliveriesTable)
    .where(eq(notificationDeliveriesTable.idempotencyKey, key));
  const email = deliveries.find((d) => d.channel === "email")!;
  const push = deliveries.find((d) => d.channel === "push")!;
  assert.equal(email.status, "sent", "email sent (user has an address)");
  assert.equal(push.status, "unavailable", "push unavailable (no registered token)");
});

test("transient failure records retry state with bounded backoff", async () => {
  setNotificationProvidersForTest(fakeProviders({ emailFail: true }));
  const userId = await makeUser();
  const key = `retry:${randomUUID()}`;
  await enqueueBookingNotification({ userId, type: "booking", title: "t", body: "b", idempotencyKey: key });
  await processDeliveries({ ignoreSchedule: true, limit: 100 });

  const [email] = await db
    .select()
    .from(notificationDeliveriesTable)
    .where(eq(notificationDeliveriesTable.idempotencyKey, key))
    .then((rows) => rows.filter((r) => r.channel === "email"));
  assert.equal(email.status, "pending", "still pending for retry");
  assert.equal(email.attempts, 1, "attempt recorded");
  assert.ok(email.lastError && email.lastError.includes("transient"), "error recorded");
  assert.ok(email.nextRetryAt instanceof Date, "next retry scheduled");
});

test("in-app notification is visible/queryable after enqueue", async () => {
  const userId = await makeUser();
  const key = `vis:${randomUUID()}`;
  await enqueueBookingNotification({ userId, type: "booking", title: "Visible", body: "b", idempotencyKey: key });
  const notifs = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, userId));
  assert.equal(notifs.length, 1);
  assert.equal(notifs[0].isRead, false, "starts unread");
  assert.equal(notifs[0].title, "Visible");
});

/**
 * Notification dispatch: durable in-app notification + delivery outbox creation
 * and idempotent, retrying delivery through provider abstractions.
 *
 * Design guarantees:
 * - Creating the notification + outbox rows never throws into the caller's
 *   booking transaction path (best-effort, guarded).
 * - Outbox rows are idempotent per (idempotencyKey, channel).
 * - Delivery retries transient failures with bounded exponential backoff and
 *   records attempts / status / lastError / nextRetryAt.
 * - When a provider is absent, the row is left in a truthful skipped/unavailable
 *   state; we never pretend a send succeeded.
 * - We never log secrets or full private payloads — only non-secret metadata.
 */
import {
  db,
  notificationsTable,
  notificationDeliveriesTable,
  notificationPreferencesTable,
  pushTokensTable,
  usersTable,
} from "@workspace/db";
import { and, eq, lte, or, isNull } from "drizzle-orm";
import { getNotificationProviders, type DeliveryChannel } from "./notificationProviders";
import { logger } from "./logger";

const OUT_OF_BAND_CHANNELS: DeliveryChannel[] = ["email", "push"];
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30_000; // 30s, doubling per attempt, capped

function backoffMs(attempts: number): number {
  const ms = BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempts - 1));
  return Math.min(ms, 60 * 60 * 1000); // cap at 1h
}

export interface NotificationInput {
  userId: number;
  type: string;
  title: string;
  body: string;
  relatedId?: number | null;
  relatedType?: string | null;
  /** Stable per-event key; drives idempotency across notification + deliveries. */
  idempotencyKey: string;
}

/**
 * Create the durable in-app notification and the delivery outbox rows for
 * out-of-band channels. Idempotent and non-throwing.
 *
 * Runs its own transaction; call it AFTER the booking transaction commits so a
 * notification failure can never roll the booking back.
 */
export async function enqueueNotification(input: NotificationInput): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const [prefs] = await tx
        .select()
        .from(notificationPreferencesTable)
        .where(eq(notificationPreferencesTable.userId, input.userId))
        .limit(1);

      // bookingEnabled governs the booking event itself, including the in-app
      // row. A user who opts out must not receive a quieter channel anyway.
      if (input.type === "booking" && prefs && !prefs.bookingEnabled) {
        return;
      }

      const [notification] = await tx
        .insert(notificationsTable)
        .values({
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          relatedId: input.relatedId ?? null,
          relatedType: input.relatedType ?? null,
          idempotencyKey: input.idempotencyKey,
        })
        .onConflictDoNothing()
        .returning();

      // If the notification already existed (idempotent replay), find it so we
      // can still ensure outbox rows exist.
      let notificationId = notification?.id ?? null;
      if (!notificationId) {
        const [existing] = await tx
          .select({ id: notificationsTable.id })
          .from(notificationsTable)
          .where(eq(notificationsTable.idempotencyKey, input.idempotencyKey))
          .limit(1);
        notificationId = existing?.id ?? null;
      }

      for (const channel of OUT_OF_BAND_CHANNELS) {
        if (channel === "email" && prefs && !prefs.emailEnabled) continue;
        if (channel === "push" && prefs && !prefs.pushEnabled) continue;
        await tx
          .insert(notificationDeliveriesTable)
          .values({
            userId: input.userId,
            notificationId,
            channel,
            status: "pending",
            maxAttempts: MAX_ATTEMPTS,
            idempotencyKey: input.idempotencyKey,
            // Non-secret metadata only: type + rendering fields for out-of-band.
            metadata: {
              type: input.type,
              relatedType: input.relatedType ?? null,
              title: input.title,
              body: input.body,
            },
          })
          .onConflictDoNothing();
      }
    });
  } catch (err) {
    // Never fail the caller's flow because a notification could not be enqueued.
    logger.error({ err: (err as Error).message, type: input.type }, "enqueueNotification failed");
  }
}

/** Recipient email lookup (best-effort, non-throwing). */
async function recipientEmail(userId: number): Promise<string | null> {
  const [u] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return u?.email ?? null;
}

async function activePushTokens(userId: number): Promise<string[]> {
  const rows = await db
    .select({ token: pushTokensTable.token })
    .from(pushTokensTable)
    .where(and(eq(pushTokensTable.userId, userId), eq(pushTokensTable.isActive, true)));
  return rows.map((r) => r.token);
}

interface ProcessOptions {
  /** Process only a specific delivery row (used by tests / targeted runs). */
  deliveryId?: number;
  /** Ignore nextRetryAt scheduling (used by tests). */
  ignoreSchedule?: boolean;
  limit?: number;
}

/**
 * Process due delivery rows once. Returns the number of rows attempted.
 * Safe to run repeatedly (e.g. from a cron/worker). Idempotent per row.
 */
export async function processDeliveries(opts: ProcessOptions = {}): Promise<number> {
  const now = new Date();
  const providers = getNotificationProviders();

  const due = await db
    .select()
    .from(notificationDeliveriesTable)
    .where(
      and(
        eq(notificationDeliveriesTable.status, "pending"),
        opts.deliveryId ? eq(notificationDeliveriesTable.id, opts.deliveryId) : undefined,
        opts.ignoreSchedule
          ? undefined
          : or(isNull(notificationDeliveriesTable.nextRetryAt), lte(notificationDeliveriesTable.nextRetryAt, now)),
      ),
    )
    .limit(opts.limit ?? 50);

  let attempted = 0;
  for (const row of due) {
    attempted += 1;
    await processOne(row, providers);
  }
  return attempted;
}

type DeliveryRow = typeof notificationDeliveriesTable.$inferSelect;

async function processOne(
  row: DeliveryRow,
  providers: ReturnType<typeof getNotificationProviders>,
): Promise<void> {
  const provider = row.channel === "email" ? providers.email : row.channel === "push" ? providers.push : providers.webhook;

  // No provider configured → truthful skipped state (terminal, not a failure).
  if (!provider) {
    await db
      .update(notificationDeliveriesTable)
      .set({ status: "skipped", lastError: "provider_not_configured" })
      .where(eq(notificationDeliveriesTable.id, row.id));
    return;
  }

  // Resolve destination. Missing destination → unavailable (terminal, truthful).
  let destinationMissing = false;
  let email: string | null = null;
  let tokens: string[] = [];
  if (row.channel === "email") {
    email = await recipientEmail(row.userId);
    destinationMissing = !email;
  } else if (row.channel === "push") {
    tokens = await activePushTokens(row.userId);
    destinationMissing = tokens.length === 0;
  }
  if (destinationMissing) {
    await db
      .update(notificationDeliveriesTable)
      .set({ status: "unavailable", lastError: "no_destination", lastAttemptAt: new Date() })
      .where(eq(notificationDeliveriesTable.id, row.id));
    return;
  }

  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const title = typeof meta.title === "string" ? meta.title : "You have a new notification";
  const body = typeof meta.body === "string" ? meta.body : "";

  const attempts = row.attempts + 1;
  try {
    let providerMessageId = row.idempotencyKey;
    if (row.channel === "email" && providers.email) {
      const r = await providers.email.sendEmail({
        to: email!,
        subject: title,
        body,
        idempotencyKey: `${row.idempotencyKey}:email`,
      });
      providerMessageId = r.providerMessageId;
    } else if (row.channel === "push" && providers.push) {
      const r = await providers.push.sendPush({
        tokens,
        title,
        body,
        idempotencyKey: `${row.idempotencyKey}:push`,
      });
      providerMessageId = r.providerMessageId;
    }
    await db
      .update(notificationDeliveriesTable)
      .set({
        status: "sent",
        attempts,
        sentAt: new Date(),
        lastAttemptAt: new Date(),
        providerMessageId,
        lastError: null,
        nextRetryAt: null,
      })
      .where(eq(notificationDeliveriesTable.id, row.id));
  } catch (err) {
    const message = (err as Error).message?.slice(0, 500) ?? "unknown_error";
    const exhausted = attempts >= row.maxAttempts;
    await db
      .update(notificationDeliveriesTable)
      .set({
        status: exhausted ? "failed" : "pending",
        attempts,
        lastAttemptAt: new Date(),
        lastError: message,
        nextRetryAt: exhausted ? null : new Date(Date.now() + backoffMs(attempts)),
      })
      .where(eq(notificationDeliveriesTable.id, row.id));
    logger.warn({ deliveryId: row.id, channel: row.channel, attempts, exhausted }, "notification delivery attempt failed");
  }
}

/**
 * Booking notifications reuse the general enqueue path; the delivery metadata
 * already carries title/body for out-of-band rendering. Kept as a named export
 * for call-site clarity at the booking creation site.
 */
export const enqueueBookingNotification = enqueueNotification;

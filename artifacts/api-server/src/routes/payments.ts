import { Router, type IRouter } from "express";
import {
  db,
  bookingsTable,
  coachesTable,
  paymentsTable,
  refundsTable,
  coachTransfersTable,
  processedWebhookEventsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import {
  getPaymentProvider,
  isPaymentProviderConfigured,
  verifyStripeWebhook,
} from "../lib/paymentProvider";
import { parsePositiveSafeInteger } from "../lib/positiveSafeInteger";
import { getPublicAppUrl } from "../lib/publicAppUrl";

const router: IRouter = Router();

// Platform commission retained; the remainder is transferred to the coach.
const PLATFORM_FEE_BPS = 2000; // 20%

// Compute the server-owned amount (minor units) for a booking. Never trust the
// client for amount/currency.
function bookingAmountMinor(rateAtBooking: number | null, durationMinutes: number): number {
  const rate = rateAtBooking ?? 0;
  const hours = durationMinutes / 60;
  return Math.max(0, Math.round(rate * hours * 100));
}

function coachShareMinor(amount: number): number {
  return Math.max(0, amount - Math.round((amount * PLATFORM_FEE_BPS) / 10000));
}

function providerUnavailable(res: any): void {
  res.status(503).json({
    error: "Payment processing is not yet configured.",
    stripeRequired: true,
    providerUnavailable: true,
  });
}

function safeReturnUrl(req: any, rawPath: unknown, state: "success" | "cancelled"): string {
  const requested =
    typeof rawPath === "string" &&
    rawPath.startsWith("/") &&
    !rawPath.startsWith("//") &&
    !rawPath.includes("\\") &&
    !/[\u0000-\u001f]/.test(rawPath)
      ? rawPath
      : "/coaching";
  const url = new URL(requested, getPublicAppUrl(req));
  url.searchParams.set("payment", state);
  if (state === "success") {
    url.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
  }
  return url.toString();
}

// --- Client: hosted Stripe Checkout for real browser/mobile payment capture ---
router.post("/bookings/:bookingId/checkout", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const bId = parsePositiveSafeInteger(Array.isArray(req.params.bookingId) ? req.params.bookingId[0] : req.params.bookingId);
  if (bId === null) { res.status(400).json({ error: "Invalid booking id" }); return; }

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bId)).limit(1);
  if (!booking || booking.clientId !== user.id) { res.status(404).json({ error: "Booking not found" }); return; }
  if (!["pending", "confirmed"].includes(booking.status)) {
    res.status(409).json({ error: "This booking is not eligible for payment" });
    return;
  }

  const amount = bookingAmountMinor(booking.rateAtBooking, booking.durationMinutes);
  if (amount <= 0) { res.status(409).json({ error: "This booking has no payable amount" }); return; }
  const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.id, booking.coachId)).limit(1);
  if (!coach) { res.status(404).json({ error: "Coach not found" }); return; }

  const [existing] = await db.select().from(paymentsTable).where(eq(paymentsTable.bookingId, bId)).limit(1);
  if (existing?.status === "succeeded") {
    res.status(409).json({ error: "This booking is already paid" });
    return;
  }
  if (
    existing?.stripePaymentIntentId &&
    !existing.stripeCheckoutSessionId &&
    ["requires_payment", "processing"].includes(existing.status)
  ) {
    res.status(409).json({
      error: "A legacy payment attempt is still active and must be reconciled before checkout.",
    });
    return;
  }
  const provider = getPaymentProvider();
  if (!provider) {
    if (!existing) {
      await db.insert(paymentsTable).values({
        bookingId: bId,
        clientId: user.id,
        coachId: booking.coachId,
        amount,
        currency: booking.currency,
        status: "provider_unavailable",
      });
    }
    providerUnavailable(res);
    return;
  }

  try {
    if (
      existing?.stripeCheckoutSessionId &&
      ["requires_payment", "processing"].includes(existing.status)
    ) {
      // A cancelled browser session does not emit a webhook immediately. Expire
      // the old hosted session before creating another so two live Checkout
      // links can never charge the same booking.
      await provider.expireCheckoutSession(existing.stripeCheckoutSessionId);
    }
    const customerId =
      existing?.stripeCustomerId ??
      (await provider.ensureCustomer({ userId: user.id, email: user.email }));
    const checkoutAttempt =
      Math.max(
        0,
        Number((existing?.metadata as Record<string, unknown> | undefined)?.checkoutAttempt ?? 0),
      ) + 1;
    const values = {
      bookingId: bId,
      clientId: user.id,
      coachId: booking.coachId,
      amount,
      currency: booking.currency,
      status: "requires_payment",
      stripeCustomerId: customerId,
      lastError: null,
      metadata: {
        ...(existing?.metadata ?? {}),
        checkoutAttempt,
      },
    };
    let payment = existing;
    if (existing) {
      [payment] = await db.update(paymentsTable).set(values).where(eq(paymentsTable.id, existing.id)).returning();
    } else {
      [payment] = await db.insert(paymentsTable).values(values).returning();
    }

    const session = await provider.createCheckoutSession({
      amount,
      currency: booking.currency,
      customerId,
      bookingId: bId,
      paymentId: payment!.id,
      description: `LandOverSEA coaching session`,
      successUrl: safeReturnUrl(req, req.body?.returnPath, "success"),
      cancelUrl: safeReturnUrl(req, req.body?.returnPath, "cancelled"),
      metadata: {
        bookingId: String(bId),
        clientId: String(user.id),
        coachId: String(booking.coachId),
      },
      idempotencyKey: `checkout:booking:${bId}:attempt:${checkoutAttempt}`,
    });
    await db.update(paymentsTable)
      .set({
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId: session.paymentIntentId,
        stripeCustomerId: session.customerId ?? customerId,
      })
      .where(eq(paymentsTable.id, payment!.id));
    res.status(201).json({
      paymentId: payment!.id,
      checkoutUrl: session.url,
      amount,
      currency: booking.currency,
      status: "requires_payment",
    });
  } catch (err: any) {
    req.log.error({ err: err?.message, bookingId: bId }, "checkout creation failed");
    res.status(502).json({ error: "Could not start checkout" });
  }
});

// PaymentIntent confirmation was replaced by hosted Checkout. Keeping this
// explicit tombstone prevents old clients from creating a competing provider
// attempt for the same booking.
router.post("/bookings/:bookingId/payment-intent", requireAuth, (req, res): void => {
  const bookingId = parsePositiveSafeInteger(
    Array.isArray(req.params.bookingId) ? req.params.bookingId[0] : req.params.bookingId,
  );
  if (bookingId === null) {
    res.status(400).json({ error: "Invalid booking id" });
    return;
  }
  res.status(410).json({
    error: "Direct payment intents are no longer supported. Use hosted checkout.",
  });
});

// --- Client: view payment status for a booking ---
router.get("/bookings/:bookingId/payment", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const bId = parsePositiveSafeInteger(Array.isArray(req.params.bookingId) ? req.params.bookingId[0] : req.params.bookingId);
  if (bId === null) { res.status(400).json({ error: "Invalid booking id" }); return; }
  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bId)).limit(1);
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.id, booking.coachId)).limit(1);
  const isClient = booking.clientId === user.id;
  if (!isClient) { res.status(404).json({ error: "Booking not found" }); return; }

  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.bookingId, bId)).limit(1);
  const [refund] = payment ? await db.select().from(refundsTable).where(eq(refundsTable.paymentId, payment.id)).limit(1) : [];
  const [transfer] = payment ? await db.select().from(coachTransfersTable).where(eq(coachTransfersTable.paymentId, payment.id)).limit(1) : [];

  res.json({
    configured: isPaymentProviderConfigured(),
    amount: payment?.amount ?? bookingAmountMinor(booking.rateAtBooking, booking.durationMinutes),
    currency: payment?.currency ?? booking.currency,
    status: payment?.status ?? "none",
    lastError: payment?.lastError ?? null,
    refund: refund ? { status: refund.status, amount: refund.amount } : null,
    payout: transfer ? { status: transfer.status, payoutStatus: transfer.payoutStatus, amount: transfer.amount } : null,
  });
});

// --- Client: request a refund (respects booking state) ---
router.post("/bookings/:bookingId/refund", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const bId = parsePositiveSafeInteger(Array.isArray(req.params.bookingId) ? req.params.bookingId[0] : req.params.bookingId);
  if (bId === null) { res.status(400).json({ error: "Invalid booking id" }); return; }
  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bId)).limit(1);
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.id, booking.coachId)).limit(1);
  const isClient = booking.clientId === user.id;
  const isCoach = coach?.userId === user.id;
  if (!isClient && !isCoach) { res.status(404).json({ error: "Booking not found" }); return; }

  // Refunds are not allowed for completed sessions (they were delivered).
  if (booking.status === "completed") {
    res.status(409).json({ error: "Completed sessions cannot be refunded here" });
    return;
  }

  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.bookingId, bId)).limit(1);
  if (!payment || payment.status !== "succeeded") {
    res.status(409).json({ error: "There is no captured payment to refund" });
    return;
  }
  const [existingRefund] = await db.select().from(refundsTable).where(eq(refundsTable.paymentId, payment.id)).limit(1);
  if (existingRefund) { res.status(409).json({ error: "A refund already exists for this payment" }); return; }

  const provider = getPaymentProvider();
  if (!provider) { providerUnavailable(res); return; }

  try {
    const idempotencyKey = `refund:payment:${payment.id}`;
    const refund = await provider.createRefund({
      paymentIntentId: payment.stripePaymentIntentId!,
      amount: payment.amount,
      reason: "requested_by_customer",
      idempotencyKey,
    });
    const [row] = await db.transaction(async (tx) => {
      const [r] = await tx.insert(refundsTable).values({
        paymentId: payment.id,
        bookingId: bId,
        amount: payment.amount,
        currency: payment.currency,
        status: refund.status === "succeeded" ? "succeeded" : "pending",
        reason: "requested_by_customer",
        stripeRefundId: refund.id,
      }).returning();
      await tx.update(paymentsTable)
        .set({ status: refund.status === "succeeded" ? "refunded" : payment.status })
        .where(eq(paymentsTable.id, payment.id));
      return [r];
    });
    res.status(201).json({ refundId: row.id, status: row.status, amount: row.amount });
  } catch (err: any) {
    req.log.error({ err: err?.message, bookingId: bId }, "refund failed");
    res.status(502).json({ error: "Could not process refund", details: err?.message });
  }
});

// --- Admin: reconciliation — compare/repair pending provider state ---
router.get("/admin/payments/reconcile", requireAdmin, async (req, res): Promise<void> => {
  const pendingPayments = await db.select().from(paymentsTable)
    .where(inArray(paymentsTable.status, ["requires_payment", "processing"]));
  const pendingTransfers = await db.select().from(coachTransfersTable)
    .where(inArray(coachTransfersTable.status, ["pending", "failed"]));
  const pendingRefunds = await db.select().from(refundsTable)
    .where(eq(refundsTable.status, "pending"));
  res.json({
    configured: isPaymentProviderConfigured(),
    pendingPayments: pendingPayments.map((p) => ({ id: p.id, bookingId: p.bookingId, status: p.status, amount: p.amount })),
    pendingTransfers: pendingTransfers.map((t) => ({ id: t.id, bookingId: t.bookingId, status: t.status, attempts: t.attempts, lastError: t.lastError })),
    pendingRefunds: pendingRefunds.map((r) => ({ id: r.id, paymentId: r.paymentId, status: r.status })),
  });
});

// Admin: retry an eligible coach transfer that previously failed. Uses the
// existing idempotency key so no double payment occurs.
router.post("/admin/payments/transfers/:transferId/retry", requireAdmin, async (req, res): Promise<void> => {
  const tId = parsePositiveSafeInteger(Array.isArray(req.params.transferId) ? req.params.transferId[0] : req.params.transferId);
  if (tId === null) { res.status(400).json({ error: "Invalid transfer id" }); return; }
  const [transfer] = await db.select().from(coachTransfersTable).where(eq(coachTransfersTable.id, tId)).limit(1);
  if (!transfer) { res.status(404).json({ error: "Transfer not found" }); return; }
  if (transfer.status === "succeeded") { res.status(409).json({ error: "Transfer already completed" }); return; }
  const result = await attemptCoachTransfer(transfer.id);
  res.json(result);
});

// --- Stripe Connect webhook (raw body verified) ---
// Registered in app.ts BEFORE express.json() with express.raw().
router.post("/payments/webhook", async (req, res): Promise<void> => {
  if (!isPaymentProviderConfigured()) { res.status(503).json({ error: "Stripe not configured" }); return; }
  const sig = req.headers["stripe-signature"];
  if (!sig) { res.status(400).json({ error: "Missing signature" }); return; }
  const signature = Array.isArray(sig) ? sig[0] : sig;

  let event;
  try {
    event = await verifyStripeWebhook(req.body as Buffer, signature);
  } catch (err: any) {
    res.status(400).json({ error: `Webhook signature verification failed: ${err?.message}` });
    return;
  }

  // Idempotent: record processed event IDs; short-circuit replays.
  const [inserted] = await db.insert(processedWebhookEventsTable)
    .values({ eventId: event.id, eventType: event.type, source: "stripe_connect" })
    .onConflictDoNothing()
    .returning();
  if (!inserted) { res.json({ received: true, duplicate: true }); return; }

  try {
    await handleWebhookEvent(event.type, event.data.object);
  } catch (err: any) {
    req.log.error({ err: err?.message, eventType: event.type }, "webhook handling failed");
    // Remove the ledger row so Stripe's retry can reprocess.
    await db.delete(processedWebhookEventsTable).where(eq(processedWebhookEventsTable.eventId, event.id));
    res.status(500).json({ error: "Webhook processing failed" });
    return;
  }
  res.json({ received: true });
});

async function handleWebhookEvent(type: string, object: Record<string, any>): Promise<void> {
  switch (type) {
    case "payment_intent.succeeded":
      await onPaymentSucceeded(object);
      break;
    case "payment_intent.payment_failed":
      await onPaymentFailed(object);
      break;
    case "charge.refunded":
      await onChargeRefunded(object);
      break;
    case "transfer.created":
    case "transfer.updated":
      await onTransferUpdated(object);
      break;
    case "payout.paid":
    case "payout.failed":
      await onPayoutUpdated(type, object);
      break;
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await onCheckoutCompleted(object);
      break;
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed":
      await onCheckoutFailed(object);
      break;
    default:
      break;
  }
}

async function onCheckoutCompleted(session: Record<string, any>): Promise<void> {
  const sessionId = session.id as string;
  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : null;
  const paid = session.payment_status === "paid";
  await db.transaction(async (tx) => {
    const [payment] = await tx.select().from(paymentsTable)
      .where(eq(paymentsTable.stripeCheckoutSessionId, sessionId))
      .limit(1);
    if (!payment) return;
    await tx.update(paymentsTable)
      .set({
        status: paid ? "succeeded" : "processing",
        stripePaymentIntentId: paymentIntentId ?? payment.stripePaymentIntentId,
        lastError: null,
      })
      .where(eq(paymentsTable.id, payment.id));
    if (paid) {
      await tx.update(bookingsTable)
        .set({ status: "confirmed" })
        .where(and(eq(bookingsTable.id, payment.bookingId), eq(bookingsTable.status, "pending")));
    }
  });
}

async function onCheckoutFailed(session: Record<string, any>): Promise<void> {
  const sessionId = session.id as string;
  await db.update(paymentsTable)
    .set({ status: "failed", lastError: "checkout_not_completed" })
    .where(eq(paymentsTable.stripeCheckoutSessionId, sessionId));
}

async function onPaymentSucceeded(pi: Record<string, any>): Promise<void> {
  const intentId = pi.id as string;
  await db.transaction(async (tx) => {
    const [payment] = await tx.select().from(paymentsTable)
      .where(eq(paymentsTable.stripePaymentIntentId, intentId)).limit(1);
    if (!payment) return;
    if (payment.status === "succeeded" || payment.status === "refunded") return; // idempotent
    const chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : null;
    await tx.update(paymentsTable)
      .set({ status: "succeeded", stripeChargeId: chargeId, lastError: null })
      .where(eq(paymentsTable.id, payment.id));
    // Payment success confirms the booking (transactional).
    await tx.update(bookingsTable)
      .set({ status: "confirmed" })
      .where(and(eq(bookingsTable.id, payment.bookingId), eq(bookingsTable.status, "pending")));
  });
}

async function onPaymentFailed(pi: Record<string, any>): Promise<void> {
  const intentId = pi.id as string;
  const message = (pi.last_payment_error?.message as string | undefined)?.slice(0, 500) ?? "payment_failed";
  await db.update(paymentsTable)
    .set({ status: "failed", lastError: message })
    .where(and(eq(paymentsTable.stripePaymentIntentId, intentId)));
}

async function onChargeRefunded(charge: Record<string, any>): Promise<void> {
  const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  if (!intentId) return;
  await db.transaction(async (tx) => {
    const [payment] = await tx.select().from(paymentsTable)
      .where(eq(paymentsTable.stripePaymentIntentId, intentId)).limit(1);
    if (!payment) return;
    const fullyRefunded = charge.amount_refunded >= charge.amount;
    await tx.update(paymentsTable)
      .set({ status: fullyRefunded ? "refunded" : "partially_refunded" })
      .where(eq(paymentsTable.id, payment.id));
    // Reflect refund row if a Stripe-initiated refund carries an id.
    const refundId = charge.refunds?.data?.[0]?.id as string | undefined;
    if (refundId) {
      await tx.insert(refundsTable).values({
        paymentId: payment.id,
        bookingId: payment.bookingId,
        amount: charge.amount_refunded ?? payment.amount,
        currency: payment.currency,
        status: "succeeded",
        stripeRefundId: refundId,
      }).onConflictDoNothing();
    }
  });
}

async function onTransferUpdated(transfer: Record<string, any>): Promise<void> {
  const transferId = transfer.id as string;
  await db.update(coachTransfersTable)
    .set({ status: "succeeded", stripeTransferId: transferId })
    .where(eq(coachTransfersTable.stripeTransferId, transferId));
}

async function onPayoutUpdated(type: string, payout: Record<string, any>): Promise<void> {
  const payoutId = payout.id as string;
  const status = type === "payout.paid" ? "paid" : "failed";
  await db.update(coachTransfersTable)
    .set({ payoutStatus: status, stripePayoutId: payoutId })
    .where(eq(coachTransfersTable.stripePayoutId, payoutId));
}

/**
 * Attempt a coach transfer for a completed & paid session. Called after a coach
 * marks a session completed (see coaching.ts) and by the admin retry endpoint.
 *
 * Guarantees:
 * - Only completed sessions with a succeeded payment are eligible.
 * - Only approved & connected coach accounts are paid.
 * - Uses a per-booking idempotency key; records failures for reconciliation.
 */
export async function attemptCoachTransfer(transferOrBookingId: number, byBooking = false): Promise<{ status: string; reason?: string }> {
  const [transfer] = byBooking
    ? await db.select().from(coachTransfersTable).where(eq(coachTransfersTable.bookingId, transferOrBookingId)).limit(1)
    : await db.select().from(coachTransfersTable).where(eq(coachTransfersTable.id, transferOrBookingId)).limit(1);
  if (!transfer) return { status: "not_found" };
  if (transfer.status === "succeeded") return { status: "succeeded" };

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, transfer.bookingId)).limit(1);
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, transfer.paymentId)).limit(1);
  const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.id, transfer.coachId)).limit(1);

  if (!booking || booking.status !== "completed") return { status: "ineligible", reason: "session_not_completed" };
  if (!payment || payment.status !== "succeeded") return { status: "ineligible", reason: "payment_not_captured" };
  if (!coach || !coach.isPayoutReady || !coach.stripeAccountId) {
    await db.update(coachTransfersTable)
      .set({ status: "failed", lastError: "coach_not_connected", attempts: transfer.attempts + 1 })
      .where(eq(coachTransfersTable.id, transfer.id));
    return { status: "failed", reason: "coach_not_connected" };
  }

  const provider = getPaymentProvider();
  if (!provider) {
    await db.update(coachTransfersTable)
      .set({ status: "provider_unavailable" })
      .where(eq(coachTransfersTable.id, transfer.id));
    return { status: "provider_unavailable" };
  }

  try {
    const result = await provider.createTransfer({
      amount: transfer.amount,
      currency: transfer.currency,
      destinationAccountId: coach.stripeAccountId,
      metadata: { bookingId: String(transfer.bookingId), coachId: String(transfer.coachId) },
      idempotencyKey: transfer.idempotencyKey,
    });
    await db.update(coachTransfersTable)
      .set({ status: "succeeded", stripeTransferId: result.id, destinationAccountId: coach.stripeAccountId, lastError: null, attempts: transfer.attempts + 1 })
      .where(eq(coachTransfersTable.id, transfer.id));
    return { status: "succeeded" };
  } catch (err: any) {
    await db.update(coachTransfersTable)
      .set({ status: "failed", lastError: (err?.message ?? "transfer_error").slice(0, 500), attempts: transfer.attempts + 1 })
      .where(eq(coachTransfersTable.id, transfer.id));
    return { status: "failed", reason: err?.message };
  }
}

/**
 * Create (if needed) the pending coach transfer row for a completed session.
 * Idempotent per booking. Called from the booking status transition to
 * "completed". The actual transfer is attempted afterwards.
 */
export async function ensureCoachTransferForCompletedBooking(bookingId: number): Promise<void> {
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.bookingId, bookingId)).limit(1);
  if (!payment || payment.status !== "succeeded") return; // only paid sessions
  const share = coachShareMinor(payment.amount);
  if (share <= 0) return;
  await db.insert(coachTransfersTable).values({
    paymentId: payment.id,
    bookingId,
    coachId: payment.coachId,
    amount: share,
    currency: payment.currency,
    status: "pending",
    idempotencyKey: `transfer:booking:${bookingId}`,
  }).onConflictDoNothing();
}

export default router;

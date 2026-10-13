/**
 * Deterministic unit tests for the coach payment lifecycle.
 *
 * Uses an injected fake payment provider — no real Stripe credentials. Talks to
 * the database directly and exercises the transfer/refund/webhook state machine
 * helpers exported from routes/payments.ts.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  db,
  usersTable,
  coachesTable,
  bookingsTable,
  paymentsTable,
  coachTransfersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  setPaymentProviderForTest,
  isPaymentProviderConfigured,
  type PaymentProvider,
} from "../src/lib/paymentProvider";
import {
  ensureCoachTransferForCompletedBooking,
  attemptCoachTransfer,
} from "../src/routes/payments";

async function makeUser(): Promise<number> {
  const [u] = await db.insert(usersTable).values({
    email: `pay-${randomUUID()}@example.com`,
    passwordHash: "x",
    name: "Pay Test",
    isTest: true,
  }).returning();
  return u.id;
}

async function makeCoach(connected: boolean): Promise<{ coachId: number; userId: number }> {
  const userId = await makeUser();
  const [c] = await db.insert(coachesTable).values({
    userId,
    displayName: "Payout Coach",
    isVerified: true,
    verificationStatus: "approved",
    isPayoutReady: connected,
    payoutStatus: connected ? "verified" : "not_started",
    stripeAccountId: connected ? `acct_${randomUUID().slice(0, 8)}` : null,
  }).returning();
  return { coachId: c.id, userId };
}

async function makeBooking(coachId: number, clientId: number, status: string): Promise<number> {
  const [b] = await db.insert(bookingsTable).values({
    coachId,
    clientId,
    status,
    scheduledAt: new Date(Date.now() - 3600_000),
    durationMinutes: 60,
    rateAtBooking: 100,
    currency: "USD",
  }).returning();
  return b.id;
}

async function makePayment(bookingId: number, clientId: number, coachId: number, status: string): Promise<number> {
  const [p] = await db.insert(paymentsTable).values({
    bookingId,
    clientId,
    coachId,
    amount: 10000, // $100
    currency: "USD",
    status,
    stripePaymentIntentId: `pi_${randomUUID().slice(0, 10)}`,
  }).returning();
  return p.id;
}

function fakeProvider(behavior: { transferFail?: boolean; calls?: string[] }): PaymentProvider {
  return {
    name: "fake-stripe",
    async ensureCustomer() { return "cus_fake"; },
    async createPaymentIntent(input) {
      behavior.calls?.push(`intent:${input.idempotencyKey}`);
      return { id: `pi_${randomUUID().slice(0, 8)}`, clientSecret: "cs_fake", customerId: "cus_fake", status: "requires_payment_method" };
    },
    async createCheckoutSession(input) {
      behavior.calls?.push(`checkout:${input.idempotencyKey}`);
      return {
        id: `cs_${randomUUID().slice(0, 8)}`,
        url: "https://checkout.stripe.test/session",
        customerId: "cus_fake",
        paymentIntentId: `pi_${randomUUID().slice(0, 8)}`,
      };
    },
    async expireCheckoutSession() {},
    async createRefund() { return { id: `re_${randomUUID().slice(0, 8)}`, status: "succeeded" }; },
    async createTransfer(input) {
      behavior.calls?.push(`transfer:${input.idempotencyKey}`);
      if (behavior.transferFail) throw new Error("insufficient funds");
      return { id: `tr_${randomUUID().slice(0, 8)}`, status: "succeeded" };
    },
    verifyWebhook() { throw new Error("not used"); },
  };
}

after(() => setPaymentProviderForTest(null));

test("a Stripe secret without a webhook signing secret is not payment-ready", () => {
  setPaymentProviderForTest(null);
  const previousSecret = process.env.STRIPE_SECRET_KEY;
  const previousConnectWebhook = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  const previousWebhook = process.env.STRIPE_WEBHOOK_SECRET;
  try {
    process.env.STRIPE_SECRET_KEY = "sk_test_configuration_probe";
    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    assert.equal(isPaymentProviderConfigured(), false);
  } finally {
    if (previousSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousSecret;
    if (previousConnectWebhook === undefined) delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    else process.env.STRIPE_CONNECT_WEBHOOK_SECRET = previousConnectWebhook;
    if (previousWebhook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previousWebhook;
  }
});

test("no coach transfer is created for an unpaid completed session", async () => {
  const { coachId } = await makeCoach(true);
  const clientId = await makeUser();
  const bookingId = await makeBooking(coachId, clientId, "completed");
  await makePayment(bookingId, clientId, coachId, "requires_payment"); // NOT paid
  await ensureCoachTransferForCompletedBooking(bookingId);
  const rows = await db.select().from(coachTransfersTable).where(eq(coachTransfersTable.bookingId, bookingId));
  assert.equal(rows.length, 0, "no transfer for unpaid session");
});

test("coach transfer requires a connected & approved coach", async () => {
  const { coachId } = await makeCoach(false); // NOT connected
  const clientId = await makeUser();
  const bookingId = await makeBooking(coachId, clientId, "completed");
  await makePayment(bookingId, clientId, coachId, "succeeded");
  await ensureCoachTransferForCompletedBooking(bookingId);

  setPaymentProviderForTest(fakeProvider({}));
  const result = await attemptCoachTransfer(bookingId, true);
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "coach_not_connected");
  const [row] = await db.select().from(coachTransfersTable).where(eq(coachTransfersTable.bookingId, bookingId));
  assert.equal(row.status, "failed", "failure recorded for reconciliation");
});

test("eligible completed + paid session transfers the coach share once", async () => {
  const calls: string[] = [];
  setPaymentProviderForTest(fakeProvider({ calls }));
  const { coachId } = await makeCoach(true);
  const clientId = await makeUser();
  const bookingId = await makeBooking(coachId, clientId, "completed");
  await makePayment(bookingId, clientId, coachId, "succeeded");

  await ensureCoachTransferForCompletedBooking(bookingId);
  const first = await attemptCoachTransfer(bookingId, true);
  assert.equal(first.status, "succeeded");

  const [row] = await db.select().from(coachTransfersTable).where(eq(coachTransfersTable.bookingId, bookingId));
  assert.equal(row.status, "succeeded");
  assert.equal(row.amount, 8000, "coach share is amount minus 20% platform fee");
  assert.ok(row.stripeTransferId, "transfer id persisted");

  // Idempotency: re-attempt does not create a second transfer.
  const second = await attemptCoachTransfer(bookingId, true);
  assert.equal(second.status, "succeeded");
  const rows = await db.select().from(coachTransfersTable).where(eq(coachTransfersTable.bookingId, bookingId));
  assert.equal(rows.length, 1, "still exactly one transfer row");
  const transferCalls = calls.filter((c) => c.startsWith("transfer:"));
  assert.equal(transferCalls.length, 1, "provider transfer called once");
});

test("transfer failure is recorded and retryable with same idempotency key", async () => {
  const calls: string[] = [];
  setPaymentProviderForTest(fakeProvider({ transferFail: true, calls }));
  const { coachId } = await makeCoach(true);
  const clientId = await makeUser();
  const bookingId = await makeBooking(coachId, clientId, "completed");
  await makePayment(bookingId, clientId, coachId, "succeeded");
  await ensureCoachTransferForCompletedBooking(bookingId);

  const fail = await attemptCoachTransfer(bookingId, true);
  assert.equal(fail.status, "failed");
  const [row] = await db.select().from(coachTransfersTable).where(eq(coachTransfersTable.bookingId, bookingId));
  assert.equal(row.status, "failed");
  assert.equal(row.attempts, 1);
  assert.ok(row.lastError && row.lastError.includes("insufficient"), "failure reason recorded");
  const idemKey = row.idempotencyKey;

  // Retry succeeds and reuses the SAME idempotency key (no double payment).
  setPaymentProviderForTest(fakeProvider({ calls }));
  const retry = await attemptCoachTransfer(row.id, false);
  assert.equal(retry.status, "succeeded");
  assert.ok(calls.some((c) => c === `transfer:${idemKey}`), "retry reuses idempotency key");
});

test("provider-unavailable is reported (never a fake success)", async () => {
  setPaymentProviderForTest(null); // fall back to env (no STRIPE_SECRET_KEY in tests)
  if (isPaymentProviderConfigured()) return; // skip if a real key is present
  const { coachId } = await makeCoach(true);
  const clientId = await makeUser();
  const bookingId = await makeBooking(coachId, clientId, "completed");
  await makePayment(bookingId, clientId, coachId, "succeeded");
  await ensureCoachTransferForCompletedBooking(bookingId);
  const result = await attemptCoachTransfer(bookingId, true);
  assert.equal(result.status, "provider_unavailable");
  const [row] = await db.select().from(coachTransfersTable).where(eq(coachTransfersTable.bookingId, bookingId));
  assert.equal(row.status, "provider_unavailable");
});

import { Router, type IRouter } from "express";
import { timingSafeEqual } from "node:crypto";
import {
  db,
  externalIdentitiesTable,
  nativePremiumEntitlementsTable,
  premiumSubscriptionsTable,
  processedWebhookEventsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { getSupabaseRequestAuth, requireAuth } from "../lib/auth";
import { getPublicAppUrl } from "../lib/publicAppUrl";
import {
  expireStaleNativePremium,
  hasPremiumAccess,
  reconcileNativePremium,
  revenueCatAppUserId,
  RevenueCatUnavailableError,
  SUPABASE_UUID_PATTERN,
} from "../lib/revenueCatPremium";

const router: IRouter = Router();

const PLANS = [
  {
    id: "weekly",
    name: "Weekly",
    interval: "weekly",
    price: 9.99,
    currency: "USD",
    features: ["Unlimited likes", "5 superlikes/day", "Live translation", "Advanced filters", "Read receipts"],
    superlikesPerDay: 5,
  },
  {
    id: "monthly",
    name: "Monthly",
    interval: "monthly",
    price: 24.99,
    currency: "USD",
    features: ["Unlimited likes", "10 superlikes/day", "Live translation", "Advanced filters", "Read receipts", "Boost once/month", "See who liked you"],
    superlikesPerDay: 10,
  },
  {
    id: "annual",
    name: "Annual",
    interval: "annual",
    price: 179.99,
    currency: "USD",
    features: ["Unlimited likes", "Unlimited superlikes", "Live translation", "Advanced filters", "Read receipts", "2 boosts/month", "See who liked you", "Priority support"],
    superlikesPerDay: 999,
  },
];

const STRIPE_ACCESS_STATUSES = new Set(["active", "trialing", "past_due", "canceled"]);
const REVENUECAT_WEBHOOK_SOURCE = "revenuecat_premium";

export type RevenueCatWebhookEvent = {
  id: string;
  type: string;
  appUserId: string;
};

function secureStringEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function isRevenueCatWebhookAuthorized(
  authorization: string | undefined,
  secret: string,
): boolean {
  if (!authorization || !secret) return false;
  return secureStringEqual(authorization, secret)
    || secureStringEqual(authorization, `Bearer ${secret}`);
}

export function parseRevenueCatWebhookEnvelope(body: unknown): RevenueCatWebhookEvent | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const event = (body as Record<string, unknown>).event;
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const record = event as Record<string, unknown>;
  if (
    typeof record.id !== "string"
    || record.id.length === 0
    || record.id.length > 500
    || typeof record.type !== "string"
    || record.type.length === 0
    || record.type.length > 200
  ) {
    return null;
  }
  return {
    id: record.id,
    type: record.type,
    appUserId: typeof record.app_user_id === "string" ? record.app_user_id : "",
  };
}

export function userIdFromRevenueCatAppUserId(appUserId: string): number | null {
  const match = /^los_user_([1-9]\d*)$/.exec(appUserId);
  if (!match) return null;
  const userId = Number(match[1]);
  return Number.isSafeInteger(userId) ? userId : null;
}

type ResolvedRevenueCatUser = { userId: number; appUserId: string };

async function resolveRevenueCatUser(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  appUserId: string,
): Promise<ResolvedRevenueCatUser | null> {
  const subject = appUserId.startsWith("los_user_")
    ? appUserId.slice("los_user_".length)
    : "";
  if (SUPABASE_UUID_PATTERN.test(subject)) {
    const [identity] = await tx
      .select({ userId: externalIdentitiesTable.userId })
      .from(externalIdentitiesTable)
      .where(and(
        eq(externalIdentitiesTable.provider, "supabase"),
        eq(externalIdentitiesTable.subject, subject),
      ))
      .limit(1);
    return identity ? { userId: identity.userId, appUserId } : null;
  }

  // Backwards compatibility for purchases created before the immutable
  // Supabase subject became the RevenueCat identity.
  const legacyUserId = userIdFromRevenueCatAppUserId(appUserId);
  if (!legacyUserId) return null;
  const [user] = await tx.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.id, legacyUserId)).limit(1);
  if (!user) return null;
  const [supabaseIdentity] = await tx
    .select({ subject: externalIdentitiesTable.subject })
    .from(externalIdentitiesTable)
    .where(and(
      eq(externalIdentitiesTable.provider, "supabase"),
      eq(externalIdentitiesTable.userId, user.id),
    ))
    .limit(1);
  if (
    supabaseIdentity
    && !SUPABASE_UUID_PATTERN.test(supabaseIdentity.subject)
  ) {
    return null;
  }
  return {
    userId: user.id,
    appUserId: supabaseIdentity
      ? revenueCatAppUserId(supabaseIdentity.subject)
      : appUserId,
  };
}

export async function syncRevenueCatWebhook(
  event: RevenueCatWebhookEvent,
): Promise<{ duplicate: boolean; ignored: boolean; userId: number | null }> {
  let providerError: RevenueCatUnavailableError | undefined;
  const result = await db.transaction(async (tx) => {
    // Serialize attempts for this provider event without creating a durable
    // in-progress claim. PostgreSQL releases this transaction lock on rollback
    // or process disconnect, allowing a later delivery to retry safely.
    await tx.execute(sql`
      select pg_advisory_xact_lock(
        73024,
        hashtext(${`${REVENUECAT_WEBHOOK_SOURCE}:${event.id}`})
      )
    `);
    const [alreadyProcessed] = await tx.select({ id: processedWebhookEventsTable.id })
      .from(processedWebhookEventsTable)
      .where(and(
        eq(processedWebhookEventsTable.source, REVENUECAT_WEBHOOK_SOURCE),
        eq(processedWebhookEventsTable.eventId, event.id),
      )).limit(1);
    if (alreadyProcessed) return { duplicate: true, ignored: false, userId: null };

    const resolved = await resolveRevenueCatUser(tx, event.appUserId);

    // Anonymous, malformed, and deleted users are acknowledged, but never
    // translated into an entitlement or a newly-created local identity.
    if (!resolved) {
      await tx.insert(processedWebhookEventsTable).values({
        eventId: event.id,
        eventType: event.type,
        source: REVENUECAT_WEBHOOK_SOURCE,
      });
      return { duplicate: false, ignored: true, userId: null };
    }

    // Delivery order is not authoritative. This call reads RevenueCat's current
    // active-entitlements endpoint, so old cancellation and renewal deliveries
    // both converge on the same current provider state.
    try {
      await reconcileNativePremium(
        resolved.userId,
        resolved.appUserId,
        tx,
      );
    } catch (error) {
      if (error instanceof RevenueCatUnavailableError) {
        // Commit the failed-attempt audit written through this transaction, but
        // leave the webhook event unclaimed so RevenueCat can retry it.
        providerError = error;
        return { duplicate: false, ignored: false, userId: resolved.userId };
      }
      throw error;
    }
    await tx.insert(processedWebhookEventsTable).values({
      eventId: event.id,
      eventType: event.type,
      source: REVENUECAT_WEBHOOK_SOURCE,
    });
    return { duplicate: false, ignored: false, userId: resolved.userId };
  });
  if (providerError) throw providerError;
  return result;
}

function stripeId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as any).id === "string") return (value as any).id;
  return null;
}

export function subscriptionPeriodEnd(subscription: any): Date | null {
  const itemEnds = Array.isArray(subscription.items?.data)
    ? subscription.items.data.map((item: any) => item.current_period_end).filter(Number.isFinite)
    : [];
  const seconds = Number.isFinite(subscription.current_period_end)
    ? subscription.current_period_end
    : itemEnds.length > 0 ? Math.max(...itemEnds) : null;
  return seconds === null ? null : new Date(seconds * 1000);
}

function planIdForSubscription(subscription: any): string | null {
  if (PLANS.some((plan) => plan.id === subscription.metadata?.planId)) return subscription.metadata.planId;
  const priceId = stripeId(subscription.items?.data?.[0]?.price);
  const configured = {
    weekly: process.env.STRIPE_PRICE_WEEKLY,
    monthly: process.env.STRIPE_PRICE_MONTHLY,
    annual: process.env.STRIPE_PRICE_ANNUAL,
  };
  return (Object.entries(configured).find(([, id]) => id === priceId)?.[0] ?? null);
}

function subscriptionIdFromEvent(type: string, object: any): string | null {
  if (type.startsWith("customer.subscription.")) return stripeId(object);
  if (type.startsWith("checkout.session.")) return stripeId(object.subscription);
  if (type.startsWith("invoice.")) {
    return stripeId(object.subscription)
      ?? stripeId(object.parent?.subscription_details?.subscription);
  }
  return null;
}

export async function syncStripeSubscription(
  event: any,
  object: any,
  stripe: any,
): Promise<{ duplicate: boolean; userId: number | null }> {
  const [alreadyProcessed] = await db.select({ id: processedWebhookEventsTable.id })
    .from(processedWebhookEventsTable)
    .where(and(
      eq(processedWebhookEventsTable.source, "stripe_premium"),
      eq(processedWebhookEventsTable.eventId, event.id),
    )).limit(1);
  if (alreadyProcessed) return { duplicate: true, userId: null };

  const subscriptionId = subscriptionIdFromEvent(event.type, object);
  let subscription: any = null;
  if (subscriptionId) {
    // Webhook payload order is not authoritative. Retrieving the subscription
    // makes an old invoice/update event converge on Stripe's current state.
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  }

  return db.transaction(async (tx) => {
    const [ledger] = await tx.insert(processedWebhookEventsTable)
      .values({ eventId: event.id, eventType: event.type, source: "stripe_premium" })
      .onConflictDoNothing()
      .returning();
    if (!ledger) return { duplicate: true, userId: null };
    if (!subscription) return { duplicate: false, userId: null };

    const customerId = stripeId(subscription.customer) ?? stripeId(object.customer);
    const metadataUserId = Number.parseInt(
      subscription.metadata?.userId ?? object.metadata?.userId ?? "0",
      10,
    );
    let userId = Number.isInteger(metadataUserId) && metadataUserId > 0 ? metadataUserId : null;
    let current = null;
    if (userId) {
      [current] = await tx.select().from(premiumSubscriptionsTable)
        .where(eq(premiumSubscriptionsTable.userId, userId)).limit(1);
    }
    if (!current) {
      [current] = await tx.select().from(premiumSubscriptionsTable)
        .where(eq(premiumSubscriptionsTable.stripeSubscriptionId, subscriptionId!)).limit(1);
      userId ??= current?.userId ?? null;
    }
    if (!current && customerId) {
      [current] = await tx.select().from(premiumSubscriptionsTable)
        .where(eq(premiumSubscriptionsTable.stripeCustomerId, customerId)).limit(1);
      userId ??= current?.userId ?? null;
    }
    if (!userId) return { duplicate: false, userId: null };
    await tx.execute(sql`select pg_advisory_xact_lock(73022, ${userId})`);
    [current] = await tx.select().from(premiumSubscriptionsTable)
      .where(eq(premiumSubscriptionsTable.userId, userId)).limit(1);

    const subscriptionCreatedAt = Number.isFinite(subscription.created)
      ? new Date(subscription.created * 1000)
      : null;
    const eventCreatedAt = Number.isFinite(event.created) ? new Date(event.created * 1000) : null;

    // A terminal event for an old subscription must never revoke its
    // replacement. A different subscription may replace the row only if it is
    // non-terminal and is not older than the current provider identity.
    if (current?.stripeSubscriptionId && current.stripeSubscriptionId !== subscriptionId) {
      const isTerminal = ["canceled", "incomplete_expired"].includes(subscription.status);
      const isOlder = Boolean(
        current.stripeSubscriptionCreatedAt
        && subscriptionCreatedAt
        && subscriptionCreatedAt < current.stripeSubscriptionCreatedAt,
      );
      if (isTerminal || isOlder) return { duplicate: false, userId };
    }

    const currentPeriodEnd = subscriptionPeriodEnd(subscription);
    const values = {
      planId: planIdForSubscription(subscription) ?? current?.planId ?? null,
      status: String(subscription.status),
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      currentPeriodEnd,
      nextBillingDate: subscription.cancel_at_period_end ? null : currentPeriodEnd,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: customerId,
      stripeSubscriptionCreatedAt: subscriptionCreatedAt ?? current?.stripeSubscriptionCreatedAt ?? null,
      stripeLastEventCreatedAt: current?.stripeLastEventCreatedAt && eventCreatedAt
        && current.stripeLastEventCreatedAt > eventCreatedAt
        ? current.stripeLastEventCreatedAt
        : eventCreatedAt ?? current?.stripeLastEventCreatedAt ?? null,
      platform: "web",
    };
    if (current) {
      await tx.update(premiumSubscriptionsTable).set(values)
        .where(eq(premiumSubscriptionsTable.id, current.id));
    } else {
      await tx.insert(premiumSubscriptionsTable).values({ userId, ...values });
    }

    const stripeActive = Boolean(
      STRIPE_ACCESS_STATUSES.has(values.status)
      && currentPeriodEnd
      && currentPeriodEnd > new Date(),
    );
    const [native] = await tx.select({ id: nativePremiumEntitlementsTable.id })
      .from(nativePremiumEntitlementsTable)
      .where(and(
        eq(nativePremiumEntitlementsTable.userId, userId),
        eq(nativePremiumEntitlementsTable.isActive, true),
        gt(nativePremiumEntitlementsTable.cacheValidUntil, new Date()),
      )).limit(1);
    await tx.update(usersTable).set({ isPremium: stripeActive || Boolean(native) })
      .where(eq(usersTable.id, userId));
    return { duplicate: false, userId };
  });
}

export function constructPremiumWebhookEvent(
  stripe: any,
  body: Buffer,
  signature: string | string[],
  secret: string,
): any {
  return stripe.webhooks.constructEvent(body, signature, secret);
}

router.get("/premium/plans", requireAuth, async (req, res): Promise<void> => {
  res.json(PLANS);
});

router.get("/premium/subscription", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  await expireStaleNativePremium(user.id);
  const [sub] = await db.select().from(premiumSubscriptionsTable)
    .where(eq(premiumSubscriptionsTable.userId, user.id)).limit(1);

  if (!sub) {
    const active = await hasPremiumAccess(user.id);
    res.json({ id: 0, userId: user.id, planId: null, status: active ? "active" : "none", cancelAtPeriodEnd: false, currentPeriodEnd: null, nextBillingDate: null, createdAt: null, provider: active ? "revenuecat" : null });
    return;
  }
  const stripeStillGrantsAccess = STRIPE_ACCESS_STATUSES.has(sub.status)
    && Boolean(sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) > new Date());
  if (!stripeStillGrantsAccess && await hasPremiumAccess(user.id)) {
    res.json({
      id: 0,
      userId: user.id,
      planId: null,
      status: "active",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      nextBillingDate: null,
      createdAt: null,
      provider: "revenuecat",
    });
    return;
  }
  res.json({
    id: sub.id,
    userId: sub.userId,
    planId: sub.planId ?? null,
    status: sub.status,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    currentPeriodEnd: sub.currentPeriodEnd ?? null,
    nextBillingDate: sub.nextBillingDate ?? null,
    createdAt: sub.createdAt,
    provider: "stripe",
  });
});

router.post("/premium/native/reconcile", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const supabaseAuth = getSupabaseRequestAuth(req);
  if (!supabaseAuth || !SUPABASE_UUID_PATTERN.test(supabaseAuth.subject)) {
    res.status(403).json({
      error: "A verified Supabase identity is required for native subscription reconciliation",
    });
    return;
  }
  try {
    const entitlement = await reconcileNativePremium(
      user.id,
      revenueCatAppUserId(supabaseAuth.subject),
    );
    const isPremium = await hasPremiumAccess(user.id);
    res.json({
      appUserId: entitlement.appUserId,
      entitlementId: entitlement.entitlementId,
      provider: entitlement.provider,
      isActive: entitlement.isActive,
      isPremium,
      expiresAt: entitlement.expiresAt,
      verifiedAt: entitlement.verifiedAt,
      cacheValidUntil: entitlement.cacheValidUntil,
    });
  } catch (error) {
    if (error instanceof RevenueCatUnavailableError) {
      req.log.warn({ userId: user.id }, "RevenueCat premium reconciliation unavailable");
      res.status(503).json({
        error: "Native subscription verification is temporarily unavailable",
        retryable: true,
      });
      return;
    }
    throw error;
  }
});

router.post("/premium/revenuecat/webhook", async (req, res): Promise<void> => {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret?.trim()) {
    res.status(503).json({ error: "RevenueCat webhook is not configured", retryable: true });
    return;
  }
  const authorization = req.headers.authorization;
  if (!isRevenueCatWebhookAuthorized(authorization, secret)) {
    res.status(401).json({ error: "Invalid webhook authorization" });
    return;
  }
  const event = parseRevenueCatWebhookEnvelope(req.body);
  if (!event) {
    res.status(400).json({ error: "Invalid RevenueCat webhook event" });
    return;
  }
  try {
    const result = await syncRevenueCatWebhook(event);
    if (result.ignored && !result.duplicate) {
      req.log.info({ eventType: event.type }, "RevenueCat webhook ignored unmapped app user");
    }
    res.json({
      received: true,
      duplicate: result.duplicate,
      ignored: result.ignored,
    });
  } catch (error) {
    if (error instanceof RevenueCatUnavailableError) {
      req.log.warn(
        { eventType: event.type },
        "RevenueCat webhook reconciliation temporarily unavailable",
      );
      res.status(503).json({
        error: "RevenueCat subscription synchronization is temporarily unavailable",
        retryable: true,
      });
      return;
    }
    throw error;
  }
});

router.post("/premium/subscription", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const { planId, platform = "web" } = req.body;
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) { res.status(400).json({ error: "Invalid plan" }); return; }

  if (platform === "ios" || platform === "android") {
    res.json({
      success: false,
      checkoutUrl: null,
      subscription: null,
      message: "Purchase through the App Store or Google Play to subscribe.",
    });
    return;
  }

  const { isStripeConfigured, getStripeClient } = await import("../lib/stripeClient");
  if (!isStripeConfigured()) {
    res.status(503).json({
      error: "Payment processing is not yet configured. Please contact support to subscribe.",
      stripeRequired: true,
      checkoutUrl: null,
    });
    return;
  }
  // Stripe IS configured: create checkout session
  try {
    const stripe = await getStripeClient();
    // Map plan to price ID (these are created in Stripe dashboard)
    const priceEnvMap: Record<string, string | undefined> = {
      weekly: process.env.STRIPE_PRICE_WEEKLY,
      monthly: process.env.STRIPE_PRICE_MONTHLY,
      annual: process.env.STRIPE_PRICE_ANNUAL,
    };
    const priceId = priceEnvMap[planId];
    if (!priceId) {
      res.status(503).json({ error: "Payment plan not configured yet.", stripeRequired: true, checkoutUrl: null });
      return;
    }
    const baseUrl = getPublicAppUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/premium?success=1`,
      cancel_url: `${baseUrl}/premium?cancelled=1`,
      metadata: { userId: String(user.id), planId },
      subscription_data: {
        metadata: { userId: String(user.id), planId },
      },
    });
    res.json({ success: true, checkoutUrl: session.url, subscription: null });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to create checkout session", details: err.message });
  }
});

// NOTE: The webhook route below needs raw body parsing.
// In app.ts, register BEFORE express.json():
//   app.use("/api/premium/webhook", express.raw({ type: "application/json" }));
router.post("/premium/webhook", async (req, res): Promise<void> => {
  const { isStripeConfigured, getStripeClient } = await import("../lib/stripeClient");
  if (!isStripeConfigured()) { res.status(503).json({ error: "Stripe not configured" }); return; }
  const sig = req.headers["stripe-signature"];
  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) { res.status(400).json({ error: "Missing signature" }); return; }
  const stripe = await getStripeClient();
  let event: any;
  try {
    event = constructPremiumWebhookEvent(stripe, req.body as Buffer, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
    return;
  }

  const handledTypes = new Set([
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.payment_succeeded",
    "invoice.payment_failed",
  ]);
  try {
    if (!handledTypes.has(event.type)) {
      const [inserted] = await db.insert(processedWebhookEventsTable)
        .values({ eventId: event.id, eventType: event.type, source: "stripe_premium" })
        .onConflictDoNothing().returning();
      res.json({ received: true, duplicate: !inserted });
      return;
    }
    const result = await syncStripeSubscription(event, event.data.object, stripe);
    if (!result.userId && !result.duplicate) {
      req.log.warn({ eventType: event.type }, "Stripe premium webhook could not resolve user or subscription");
    }
    res.json({ received: true, duplicate: result.duplicate });
  } catch (err: any) {
    req.log.error({ errorType: err?.constructor?.name, eventType: event.type }, "Stripe premium synchronization unavailable");
    res.status(503).json({ error: "Stripe subscription synchronization is temporarily unavailable", retryable: true });
  }
});

router.delete("/premium/subscription", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const [sub] = await db.select().from(premiumSubscriptionsTable)
    .where(eq(premiumSubscriptionsTable.userId, user.id)).limit(1);
  if (!sub) { res.status(404).json({ error: "No active subscription" }); return; }
  if (!sub.stripeSubscriptionId) {
    res.status(409).json({ error: "Subscription is not managed by Stripe" });
    return;
  }
  const { isStripeConfigured, getStripeClient } = await import("../lib/stripeClient");
  if (!isStripeConfigured()) {
    res.status(503).json({ error: "Stripe is temporarily unavailable", retryable: true });
    return;
  }
  let providerSubscription: any;
  try {
    const stripe = await getStripeClient();
    providerSubscription = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  } catch (err: any) {
    req.log.error({ errorType: err?.constructor?.name }, "Stripe subscription cancellation unavailable");
    res.status(503).json({ error: "Stripe is temporarily unavailable", retryable: true });
    return;
  }
  const periodEnd = subscriptionPeriodEnd(providerSubscription);
  const [updated] = await db.update(premiumSubscriptionsTable).set({
    status: String(providerSubscription.status),
    cancelAtPeriodEnd: Boolean(providerSubscription.cancel_at_period_end),
    currentPeriodEnd: periodEnd,
    nextBillingDate: null,
    stripeCustomerId: stripeId(providerSubscription.customer),
  }).where(eq(premiumSubscriptionsTable.id, sub.id)).returning();
  res.json({
    ...updated,
    planId: updated.planId ?? null,
    currentPeriodEnd: updated.currentPeriodEnd ?? null,
    nextBillingDate: updated.nextBillingDate ?? null,
    createdAt: updated.createdAt,
  });
});

router.get("/premium/superlikes", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const [sub] = await db.select().from(premiumSubscriptionsTable).where(eq(premiumSubscriptionsTable.userId, user.id)).limit(1);
  const plan = PLANS.find((p) => p.id === sub?.planId);
  const limit = plan?.superlikesPerDay ?? (await hasPremiumAccess(user.id) ? 10 : 1);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(0, 0, 0, 0);
  res.json({ remaining: limit, dailyLimit: limit, resetAt: tomorrow });
});

export async function requirePremium(req: any, res: any, next: any): Promise<void> {
  const user = req.user;
  await expireStaleNativePremium(user.id);
  if (!(await hasPremiumAccess(user.id))) {
    res.status(403).json({ error: "Premium required", premiumRequired: true });
    return;
  }
  next();
}

export default router;

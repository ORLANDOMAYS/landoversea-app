import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import {
  db,
  premiumSubscriptionsTable,
  processedWebhookEventsTable,
  usersTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { hasPremiumAccess } from "../src/lib/revenueCatPremium";
import {
  constructPremiumWebhookEvent,
  syncStripeSubscription,
} from "../src/routes/premium";

const createdUsers: number[] = [];

async function createUser(): Promise<number> {
  const [user] = await db.insert(usersTable).values({
    email: `stripe-premium-${randomUUID()}@example.com`,
    passwordHash: "unused",
    name: "Stripe Premium Test",
    isTest: true,
  }).returning();
  createdUsers.push(user.id);
  return user.id;
}

function subscription(
  id: string,
  userId: number,
  status: string,
  periodEnd: number,
  created: number,
) {
  return {
    id,
    customer: `cus_${userId}`,
    status,
    created,
    cancel_at_period_end: false,
    metadata: { userId: String(userId), planId: "monthly" },
    items: { data: [{ current_period_end: periodEnd, price: { id: "price_test" } }] },
  };
}

function event(id: string, type: string, object: any, created: number) {
  return { id, type, created, data: { object } };
}

function provider(states: Map<string, any>) {
  return {
    subscriptions: {
      async retrieve(id: string) {
        const value = states.get(id);
        if (!value) throw new Error("provider unavailable");
        return value;
      },
    },
  };
}

afterEach(async () => {
  await db.delete(processedWebhookEventsTable)
    .where(eq(processedWebhookEventsTable.source, "stripe_premium"));
  for (const userId of createdUsers.splice(0)) {
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("rejects an invalid Stripe signature", () => {
  const stripe = new Stripe("sk_test_not_a_real_secret");
  assert.throws(
    () => constructPremiumWebhookEvent(
      stripe,
      Buffer.from("{}"),
      "t=1,v1=invalid",
      "whsec_test",
    ),
    /signature/i,
  );
});

test("replay is persisted and processed exactly once", async () => {
  const userId = await createUser();
  const now = Math.floor(Date.now() / 1000);
  const sub = subscription("sub_replay", userId, "active", now + 3600, now);
  const stripe = provider(new Map([[sub.id, sub]]));
  const webhook = event("evt_replay", "customer.subscription.created", sub, now);
  assert.equal((await syncStripeSubscription(webhook, sub, stripe)).duplicate, false);
  assert.equal((await syncStripeSubscription(webhook, sub, stripe)).duplicate, true);
  const ledger = await db.select().from(processedWebhookEventsTable).where(and(
    eq(processedWebhookEventsTable.eventId, webhook.id),
    eq(processedWebhookEventsTable.source, "stripe_premium"),
  ));
  assert.equal(ledger.length, 1);
});

test("an old event converges on the authoritative current provider period", async () => {
  const userId = await createUser();
  const now = Math.floor(Date.now() / 1000);
  const current = subscription("sub_order", userId, "active", now + 9876, now);
  const stalePayload = { ...current, status: "canceled", current_period_end: now - 10 };
  const stripe = provider(new Map([[current.id, current]]));
  await syncStripeSubscription(
    event("evt_old", "customer.subscription.deleted", stalePayload, now - 100),
    stalePayload,
    stripe,
  );
  const [stored] = await db.select().from(premiumSubscriptionsTable)
    .where(eq(premiumSubscriptionsTable.userId, userId));
  assert.equal(stored.status, "active");
  assert.equal(stored.currentPeriodEnd?.getTime(), (now + 9876) * 1000);
});

test("failed payment retains period access and a succeeding retry recovers", async () => {
  const userId = await createUser();
  const now = Math.floor(Date.now() / 1000);
  const pastDue = subscription("sub_retry", userId, "past_due", now + 3600, now);
  const states = new Map([[pastDue.id, pastDue]]);
  const stripe = provider(states);
  const invoice = { subscription: pastDue.id, customer: pastDue.customer };
  await syncStripeSubscription(event("evt_failed", "invoice.payment_failed", invoice, now), invoice, stripe);
  assert.equal(await hasPremiumAccess(userId), true);
  states.set(pastDue.id, { ...pastDue, status: "active" });
  await syncStripeSubscription(
    event("evt_succeeded", "invoice.payment_succeeded", invoice, now + 1),
    invoice,
    stripe,
  );
  const [stored] = await db.select().from(premiumSubscriptionsTable)
    .where(eq(premiumSubscriptionsTable.userId, userId));
  assert.equal(stored.status, "active");
  assert.equal(await hasPremiumAccess(userId), true);
});

test("deletion of a replaced subscription cannot revoke the replacement", async () => {
  const userId = await createUser();
  const now = Math.floor(Date.now() / 1000);
  const oldSub = subscription("sub_old", userId, "active", now + 100, now - 100);
  const newSub = subscription("sub_new", userId, "active", now + 7200, now);
  const states = new Map([[oldSub.id, oldSub], [newSub.id, newSub]]);
  const stripe = provider(states);
  await syncStripeSubscription(event("evt_old_active", "customer.subscription.created", oldSub, now - 100), oldSub, stripe);
  await syncStripeSubscription(event("evt_new_active", "customer.subscription.created", newSub, now), newSub, stripe);
  states.set(oldSub.id, { ...oldSub, status: "canceled" });
  await syncStripeSubscription(
    event("evt_old_deleted", "customer.subscription.deleted", oldSub, now + 1),
    oldSub,
    stripe,
  );
  const [stored] = await db.select().from(premiumSubscriptionsTable)
    .where(eq(premiumSubscriptionsTable.userId, userId));
  assert.equal(stored.stripeSubscriptionId, newSub.id);
  assert.equal(stored.status, "active");
  assert.equal(stored.currentPeriodEnd?.getTime(), (now + 7200) * 1000);
});
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  db,
  externalIdentitiesTable,
  nativePremiumEntitlementsTable,
  premiumSubscriptionsTable,
  processedWebhookEventsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  hasPremiumAccess,
  reconcileNativePremium,
  RevenueCatUnavailableError,
  setRevenueCatProviderForTest,
} from "../src/lib/revenueCatPremium";
import {
  isRevenueCatWebhookAuthorized,
  parseRevenueCatWebhookEnvelope,
  syncRevenueCatWebhook,
  type RevenueCatWebhookEvent,
} from "../src/routes/premium";

const createdUsers: number[] = [];

async function createUser(
  linkSupabase = true,
): Promise<{ userId: number; subject: string }> {
  const subject = randomUUID();
  const [user] = await db.insert(usersTable).values({
    email: `revenuecat-webhook-${randomUUID()}@example.com`,
    passwordHash: "unused",
    name: "RevenueCat Webhook Test",
    isTest: true,
  }).returning();
  createdUsers.push(user.id);
  if (linkSupabase) {
    await db.insert(externalIdentitiesTable).values({
      provider: "supabase",
      subject,
      userId: user.id,
    });
  }
  return { userId: user.id, subject };
}

function event(subject: string, id = `rc_${randomUUID()}`, type = "RENEWAL"): RevenueCatWebhookEvent {
  const parsed = parseRevenueCatWebhookEnvelope({
    api_version: "1.0",
    event: { id, type, app_user_id: `los_user_${subject}` },
  });
  assert.ok(parsed);
  return parsed;
}

async function ledgerCount(eventId: string): Promise<number> {
  const rows = await db.select({ id: processedWebhookEventsTable.id })
    .from(processedWebhookEventsTable).where(and(
      eq(processedWebhookEventsTable.source, "revenuecat_premium"),
      eq(processedWebhookEventsTable.eventId, eventId),
    ));
  return rows.length;
}

afterEach(async () => {
  setRevenueCatProviderForTest(null);
  await db.delete(processedWebhookEventsTable)
    .where(eq(processedWebhookEventsTable.source, "revenuecat_premium"));
  for (const userId of createdUsers.splice(0)) {
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("RevenueCat webhook authorization rejects absent and incorrect credentials", () => {
  assert.equal(isRevenueCatWebhookAuthorized(undefined, "expected-secret"), false);
  assert.equal(isRevenueCatWebhookAuthorized("wrong-secret", "expected-secret"), false);
  assert.equal(isRevenueCatWebhookAuthorized("Bearer expected-secret", "expected-secret"), true);
});

test("duplicate RevenueCat delivery is reconciled exactly once", async () => {
  const { userId, subject } = await createUser();
  let providerCalls = 0;
  setRevenueCatProviderForTest({
    async getPremiumEntitlement() {
      providerCalls += 1;
      return { active: true, expiresAt: new Date(Date.now() + 60_000), productId: "monthly" };
    },
  });
  const webhook = event(subject);
  assert.equal((await syncRevenueCatWebhook(webhook)).duplicate, false);
  assert.equal((await syncRevenueCatWebhook(webhook)).duplicate, true);
  assert.equal(providerCalls, 1);
  assert.equal(await ledgerCount(webhook.id), 1);
});

test("parallel RevenueCat deliveries make one provider call and one ledger row", async () => {
  const { userId, subject } = await createUser();
  let providerCalls = 0;
  setRevenueCatProviderForTest({
    async getPremiumEntitlement() {
      providerCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { active: true, expiresAt: new Date(Date.now() + 60_000), productId: "monthly" };
    },
  });
  const webhook = event(subject);
  const results = await Promise.all([
    syncRevenueCatWebhook(webhook),
    syncRevenueCatWebhook(webhook),
    syncRevenueCatWebhook(webhook),
  ]);
  assert.equal(results.filter((result) => result.duplicate).length, 2);
  assert.equal(providerCalls, 1);
  assert.equal(await ledgerCount(webhook.id), 1);
});

test("distinct webhooks at pool capacity settle without nested-connection deadlock", {
  timeout: 8_000,
}, async () => {
  const identities = await Promise.all(
    Array.from({ length: 12 }, () => createUser()),
  );
  let providerCalls = 0;
  setRevenueCatProviderForTest({
    async getPremiumEntitlement() {
      providerCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return {
        active: true,
        expiresAt: new Date(Date.now() + 60_000),
        productId: "stress-native",
      };
    },
  });

  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error("RevenueCat webhook pool stress timed out")),
      5_000,
    );
  });
  let results;
  try {
    results = await Promise.race([
      Promise.all(identities.map(({ subject }) =>
        syncRevenueCatWebhook(event(subject))
      )),
      timeout,
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  assert.equal(results.length, identities.length);
  assert.equal(providerCalls, identities.length);
  assert.ok(results.every((result) => !result.duplicate && !result.ignored));
  const userIds = identities.map(({ userId }) => userId);
  const rows = await db.select().from(nativePremiumEntitlementsTable)
    .where(inArray(nativePremiumEntitlementsTable.userId, userIds));
  assert.equal(rows.length, identities.length);
  assert.ok(rows.every((row) =>
    row.isActive
    && row.appUserId === `los_user_${identities.find(
      ({ userId }) => userId === row.userId,
    )?.subject}`
  ));
  const users = await db.select({
    id: usersTable.id,
    isPremium: usersTable.isPremium,
  }).from(usersTable).where(inArray(usersTable.id, userIds));
  assert.equal(users.length, identities.length);
  assert.ok(users.every((user) => user.isPremium));
});

test("stale RevenueCat delivery converges on current active entitlements", async () => {
  const { userId, subject } = await createUser();
  setRevenueCatProviderForTest({
    async getPremiumEntitlement() {
      return { active: true, expiresAt: new Date(Date.now() + 60_000), productId: "annual" };
    },
  });
  await syncRevenueCatWebhook(event(subject, undefined, "EXPIRATION"));
  assert.equal(await hasPremiumAccess(userId), true);
});

test("RevenueCat inactive state revokes native premium", async () => {
  const { userId, subject } = await createUser();
  let active = true;
  setRevenueCatProviderForTest({
    async getPremiumEntitlement() {
      return {
        active,
        expiresAt: active ? new Date(Date.now() + 60_000) : null,
        productId: active ? "monthly" : null,
      };
    },
  });
  await reconcileNativePremium(userId, `los_user_${subject}`);
  active = false;
  await syncRevenueCatWebhook(event(subject, undefined, "EXPIRATION"));
  const [native] = await db.select().from(nativePremiumEntitlementsTable)
    .where(eq(nativePremiumEntitlementsTable.userId, userId));
  assert.equal(native.isActive, false);
  assert.equal(await hasPremiumAccess(userId), false);
});

test("provider-unavailable RevenueCat event remains retryable and unprocessed", async () => {
  const { subject } = await createUser();
  let unavailable = true;
  setRevenueCatProviderForTest({
    async getPremiumEntitlement() {
      if (unavailable) throw new Error("provider unavailable");
      return { active: true, expiresAt: new Date(Date.now() + 60_000), productId: null };
    },
  });
  const webhook = event(subject);
  await assert.rejects(() => syncRevenueCatWebhook(webhook), RevenueCatUnavailableError);
  assert.equal(await ledgerCount(webhook.id), 0);
  unavailable = false;
  assert.equal((await syncRevenueCatWebhook(webhook)).duplicate, false);
  assert.equal(await ledgerCount(webhook.id), 1);
});

test("RevenueCat revocation preserves valid Stripe web premium", async () => {
  const { userId, subject } = await createUser();
  await db.insert(premiumSubscriptionsTable).values({
    userId,
    planId: "monthly",
    status: "active",
    currentPeriodEnd: new Date(Date.now() + 60_000),
    platform: "web",
  });
  setRevenueCatProviderForTest({
    async getPremiumEntitlement() {
      return { active: false, expiresAt: null, productId: null };
    },
  });
  await syncRevenueCatWebhook(event(subject, undefined, "EXPIRATION"));
  assert.equal(await hasPremiumAccess(userId), true);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  assert.equal(user.isPremium, true);
});

test("anonymous and unknown RevenueCat users are ignored without reconciliation", async () => {
  let providerCalls = 0;
  setRevenueCatProviderForTest({
    async getPremiumEntitlement() {
      providerCalls += 1;
      return { active: true, expiresAt: null, productId: null };
    },
  });
  const anonymous = {
    id: `rc_${randomUUID()}`,
    type: "INITIAL_PURCHASE",
    appUserId: "$RCAnonymousID:untrusted",
  };
  const result = await syncRevenueCatWebhook(anonymous);
  assert.equal(result.ignored, true);
  assert.equal(providerCalls, 0);
  assert.equal(await ledgerCount(anonymous.id), 1);
});

test("unlinked Supabase subject cannot grant premium through a webhook", async () => {
  let providerCalls = 0;
  setRevenueCatProviderForTest({
    async getPremiumEntitlement() {
      providerCalls += 1;
      return { active: true, expiresAt: null, productId: "untrusted" };
    },
  });
  const webhook = event(randomUUID());
  const result = await syncRevenueCatWebhook(webhook);
  assert.equal(result.ignored, true);
  assert.equal(providerCalls, 0);
  assert.equal(await ledgerCount(webhook.id), 1);
});

test("legacy numeric RevenueCat identities remain safely resolvable by user id", async () => {
  const { userId } = await createUser(false);
  let requestedId = "";
  setRevenueCatProviderForTest({
    async getPremiumEntitlement(appUserId) {
      requestedId = appUserId;
      return { active: true, expiresAt: new Date(Date.now() + 60_000), productId: "legacy" };
    },
  });
  const webhook = event(String(userId));
  await syncRevenueCatWebhook(webhook);
  assert.equal(requestedId, `los_user_${userId}`);
  assert.equal(await hasPremiumAccess(userId), true);
});

test("legacy webhook for a linked user reconciles the canonical Supabase customer", async () => {
  const { userId, subject } = await createUser();
  const requestedIds: string[] = [];
  setRevenueCatProviderForTest({
    async getPremiumEntitlement(appUserId) {
      requestedIds.push(appUserId);
      return {
        active: true,
        expiresAt: new Date(Date.now() + 60_000),
        productId: "canonical",
      };
    },
  });

  await syncRevenueCatWebhook(event(String(userId)));
  await syncRevenueCatWebhook(event(subject));

  assert.deepEqual(requestedIds, [
    `los_user_${subject}`,
    `los_user_${subject}`,
  ]);
  const [native] = await db.select().from(nativePremiumEntitlementsTable)
    .where(eq(nativePremiumEntitlementsTable.userId, userId));
  assert.equal(native.appUserId, `los_user_${subject}`);
  assert.equal(native.isActive, true);
});

test("concurrent legacy and canonical webhooks cannot oscillate app user identity", async () => {
  const { userId, subject } = await createUser();
  const requestedIds: string[] = [];
  setRevenueCatProviderForTest({
    async getPremiumEntitlement(appUserId) {
      requestedIds.push(appUserId);
      await new Promise((resolve) => setTimeout(resolve, 25));
      return {
        active: true,
        expiresAt: new Date(Date.now() + 60_000),
        productId: "canonical",
      };
    },
  });

  await Promise.all([
    syncRevenueCatWebhook(event(String(userId))),
    syncRevenueCatWebhook(event(subject)),
  ]);

  assert.equal(requestedIds.length, 2);
  assert.ok(requestedIds.every((id) => id === `los_user_${subject}`));
  const rows = await db.select().from(nativePremiumEntitlementsTable)
    .where(eq(nativePremiumEntitlementsTable.userId, userId));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.appUserId, `los_user_${subject}`);
  assert.equal(rows[0]?.isActive, true);
});
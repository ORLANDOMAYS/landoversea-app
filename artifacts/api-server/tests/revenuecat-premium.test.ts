import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  db,
  nativePremiumEntitlementsTable,
  premiumSubscriptionsTable,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  hasPremiumAccess,
  parseVerifiedRevenueCatPremium,
  reconcileNativePremium,
  revenueCatAppUserId,
  RevenueCatUnavailableError,
  setRevenueCatProviderForTest,
} from "../src/lib/revenueCatPremium";

const createdUsers: number[] = [];

const entitlementResourceId = "entitlement-resource";
const productResourceId = "product-resource";
const future = "2030-02-01T00:00:00.000Z";
const past = "2029-12-01T00:00:00.000Z";
const parserNow = new Date("2030-01-01T00:00:00.000Z");

function activeEntitlement(expiresAt = future): unknown {
  return {
    items: [{
      id: "active-entitlement-instance",
      entitlement_id: entitlementResourceId,
      object: "customer.active_entitlement",
      expires_at: expiresAt,
    }],
  };
}

function subscription(
  store: string,
  environment: string,
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    items: [{
      product_id: productResourceId,
      gives_access: true,
      store,
      environment,
      current_period_ends_at: future,
      entitlements: {
        items: [{
          id: entitlementResourceId,
          object: "entitlement",
          lookup_key: "premium",
        }],
        next_page: null,
      },
      ...overrides,
    }],
  };
}

async function createUser(): Promise<number> {
  const [user] = await db.insert(usersTable).values({
    email: `revenuecat-${randomUUID()}@example.com`,
    passwordHash: "not-used",
    name: "RevenueCat Test",
    isTest: true,
  }).returning();
  createdUsers.push(user.id);
  return user.id;
}

afterEach(async () => {
  setRevenueCatProviderForTest(null);
  for (const userId of createdUsers.splice(0)) {
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("App Store subscriptions in sandbox and production verify Premium", () => {
  for (const environment of ["sandbox", "production"]) {
    const state = parseVerifiedRevenueCatPremium(
      activeEntitlement(),
      subscription("app_store", environment),
      entitlementResourceId,
      parserNow,
    );
    assert.equal(state.active, true);
    assert.equal(state.productId, productResourceId);
    assert.equal(state.expiresAt?.toISOString(), future);
  }
});

test("Test Store, promotional, and missing subscriptions never verify Premium", () => {
  for (const supportingSubscriptions of [
    subscription("test_store", "sandbox"),
    subscription("promotional", "production"),
    { items: [] },
  ]) {
    const state = parseVerifiedRevenueCatPremium(
      activeEntitlement(),
      supportingSubscriptions,
      entitlementResourceId,
      parserNow,
    );
    assert.equal(state.active, false);
  }
});

test("subscription must explicitly include the resolved Premium entitlement", () => {
  const state = parseVerifiedRevenueCatPremium(
    activeEntitlement(),
    subscription("app_store", "sandbox", {
      entitlements: { items: [] },
    }),
    entitlementResourceId,
    parserNow,
  );
  assert.equal(state.active, false);
});

test("verified state derives product and the earliest authoritative expiry from subscription", () => {
  const subscriptionExpiry = "2030-01-15T00:00:00.000Z";
  const state = parseVerifiedRevenueCatPremium(
    activeEntitlement(),
    subscription("app_store", "sandbox", {
      current_period_ends_at: subscriptionExpiry,
    }),
    entitlementResourceId,
    parserNow,
  );
  assert.equal(state.active, true);
  assert.equal(state.productId, productResourceId);
  assert.equal(state.expiresAt?.toISOString(), subscriptionExpiry);
});

test("inactive or expired provider state is rejected", () => {
  const validSubscription = subscription("app_store", "production");
  assert.equal(parseVerifiedRevenueCatPremium(
    { items: [] },
    validSubscription,
    entitlementResourceId,
    parserNow,
  ).active, false);
  assert.equal(parseVerifiedRevenueCatPremium(
    activeEntitlement(past),
    validSubscription,
    entitlementResourceId,
    parserNow,
  ).active, false);
  assert.equal(parseVerifiedRevenueCatPremium(
    activeEntitlement(),
    subscription("app_store", "production", {
      current_period_ends_at: past,
    }),
    entitlementResourceId,
    parserNow,
  ).active, false);
});

test("active native entitlement grants server premium using the deterministic opaque id", async () => {
  const userId = await createUser();
  const subject = randomUUID();
  let requestedId = "";
  setRevenueCatProviderForTest({
    async getPremiumEntitlement(appUserId) {
      requestedId = appUserId;
      return { active: true, expiresAt: new Date(Date.now() + 86_400_000), productId: "provider-product" };
    },
  });
  const result = await reconcileNativePremium(userId, revenueCatAppUserId(subject));
  assert.equal(requestedId, revenueCatAppUserId(subject));
  assert.equal(result.appUserId, `los_user_${subject}`);
  assert.equal(await hasPremiumAccess(userId), true);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  assert.equal(user.isPremium, true);
});

test("native restore reconciliation is idempotent for one Supabase subject", async () => {
  const userId = await createUser();
  const appUserId = revenueCatAppUserId(randomUUID());
  setRevenueCatProviderForTest({
    async getPremiumEntitlement() {
      return {
        active: true,
        expiresAt: new Date(Date.now() + 86_400_000),
        productId: "annual",
      };
    },
  });

  await reconcileNativePremium(userId, appUserId);
  await reconcileNativePremium(userId, appUserId);

  const rows = await db.select().from(nativePremiumEntitlementsTable)
    .where(eq(nativePremiumEntitlementsTable.userId, userId));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.appUserId, appUserId);
  assert.equal(rows[0]?.isActive, true);
});

test("inactive native entitlement revokes native access", async () => {
  const userId = await createUser();
  setRevenueCatProviderForTest({
    async getPremiumEntitlement() {
      return { active: false, expiresAt: null, productId: null };
    },
  });
  await reconcileNativePremium(userId, revenueCatAppUserId(randomUUID()));
  assert.equal(await hasPremiumAccess(userId), false);
  const [cached] = await db.select().from(nativePremiumEntitlementsTable)
    .where(eq(nativePremiumEntitlementsTable.userId, userId));
  assert.equal(cached.isActive, false);
});

test("expired provider entitlement fails closed", async () => {
  const userId = await createUser();
  setRevenueCatProviderForTest({
    async getPremiumEntitlement() {
      return { active: true, expiresAt: new Date(Date.now() - 1_000), productId: "expired-product" };
    },
  });
  await reconcileNativePremium(userId, revenueCatAppUserId(randomUUID()));
  assert.equal(await hasPremiumAccess(userId), false);
});

test("provider failure is truthful, preserves audit state, and can be retried", async () => {
  const userId = await createUser();
  let fail = true;
  setRevenueCatProviderForTest({
    async getPremiumEntitlement() {
      if (fail) throw new Error("provider offline");
      return { active: true, expiresAt: new Date(Date.now() + 86_400_000), productId: null };
    },
  });
  const appUserId = revenueCatAppUserId(randomUUID());
  await assert.rejects(() => reconcileNativePremium(userId, appUserId), RevenueCatUnavailableError);
  assert.equal(await hasPremiumAccess(userId), false);
  const [failedAttempt] = await db.select().from(nativePremiumEntitlementsTable)
    .where(eq(nativePremiumEntitlementsTable.userId, userId));
  assert.match(failedAttempt.lastError ?? "", /provider offline/);
  assert.equal(failedAttempt.verifiedAt.getTime(), 0, "an outage must not be recorded as provider verification");
  fail = false;
  await reconcileNativePremium(userId, appUserId);
  assert.equal(await hasPremiumAccess(userId), true);
});

test("inactive native reconciliation preserves a valid Stripe subscription", async () => {
  const userId = await createUser();
  await db.insert(premiumSubscriptionsTable).values({
    userId,
    planId: "monthly",
    status: "active",
    currentPeriodEnd: new Date(Date.now() + 86_400_000),
    platform: "web",
  });
  setRevenueCatProviderForTest({
    async getPremiumEntitlement() {
      return { active: false, expiresAt: null, productId: null };
    },
  });
  await reconcileNativePremium(userId, revenueCatAppUserId(randomUUID()));
  assert.equal(await hasPremiumAccess(userId), true);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  assert.equal(user.isPremium, true);
});
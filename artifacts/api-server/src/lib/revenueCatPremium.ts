import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  db,
  nativePremiumEntitlementsTable,
  premiumSubscriptionsTable,
  usersTable,
  type NativePremiumEntitlement,
} from "@workspace/db";
import { and, eq, gt, inArray, lte, or, sql } from "drizzle-orm";

export const REVENUECAT_PREMIUM_ENTITLEMENT = "premium";
const CACHE_TTL_MS = 15 * 60_000;

export const SUPABASE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function revenueCatAppUserId(supabaseSubject: string): string {
  if (!SUPABASE_UUID_PATTERN.test(supabaseSubject)) {
    throw new Error("Invalid Supabase subject");
  }
  return `los_user_${supabaseSubject}`;
}

export type RevenueCatEntitlementState = {
  active: boolean;
  expiresAt: Date | null;
  productId: string | null;
};

type RevenueCatProvider = {
  getPremiumEntitlement(appUserId: string): Promise<RevenueCatEntitlementState>;
};

let testProvider: RevenueCatProvider | null = null;
export function setRevenueCatProviderForTest(provider: RevenueCatProvider | null): void {
  testProvider = provider;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function parseEntitlementPayload(
  payload: unknown,
  entitlementResourceId: string,
  now: Date,
): RevenueCatEntitlementState {
  const root = payload as Record<string, unknown> | null;
  const items = Array.isArray(root?.items) ? root.items : [];
  const entitlement = items.find((raw) => {
    const item = raw as Record<string, unknown>;
    return item.entitlement_id === entitlementResourceId
      || item.lookup_key === REVENUECAT_PREMIUM_ENTITLEMENT
      || item.identifier === REVENUECAT_PREMIUM_ENTITLEMENT
      || item.id === REVENUECAT_PREMIUM_ENTITLEMENT;
  }) as Record<string, unknown> | undefined;
  if (!entitlement) return { active: false, expiresAt: null, productId: null };
  const expiresAt = parseDate(entitlement.expires_at ?? entitlement.expiresAt);
  return {
    active: expiresAt === null || expiresAt > now,
    expiresAt,
    // Product identity is supplied only by a verified subscription below.
    productId: null,
  };
}

const REAL_NATIVE_STORES = new Set(["app_store", "play_store"]);

/**
 * RevenueCat's active-entitlements endpoint is authoritative for the
 * entitlement, while subscriptions supplies the supporting store transaction.
 * Backend access always requires both. Sandbox App Store subscriptions are
 * intentionally accepted because TestFlight is represented as app_store +
 * sandbox; RevenueCat Test Store and promotional grants use different stores.
 */
export function parseVerifiedRevenueCatPremium(
  entitlementPayload: unknown,
  subscriptionPayload: unknown,
  entitlementResourceId: string,
  now = new Date(),
): RevenueCatEntitlementState {
  const entitlement = parseEntitlementPayload(
    entitlementPayload,
    entitlementResourceId,
    now,
  );
  if (!entitlement.active) {
    return {
      active: false,
      expiresAt: entitlement.expiresAt,
      productId: null,
    };
  }

  const root = subscriptionPayload as Record<string, unknown> | null;
  const items = Array.isArray(root?.items) ? root.items : [];
  const verifiedSubscription = items.find((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const subscription = raw as Record<string, unknown>;
    if (
      subscription.gives_access !== true
      || typeof subscription.store !== "string"
      || !REAL_NATIVE_STORES.has(subscription.store)
      || typeof subscription.product_id !== "string"
      || subscription.product_id.length === 0
    ) {
      return false;
    }
    const subscriptionEntitlements =
      subscription.entitlements
      && typeof subscription.entitlements === "object"
      && Array.isArray(
        (subscription.entitlements as Record<string, unknown>).items,
      )
        ? (subscription.entitlements as { items: unknown[] }).items
        : [];
    const grantsPremium = subscriptionEntitlements.some((rawEntitlement) => {
      if (!rawEntitlement || typeof rawEntitlement !== "object") return false;
      const record = rawEntitlement as Record<string, unknown>;
      return record.id === entitlementResourceId
        || record.entitlement_id === entitlementResourceId
        || record.lookup_key === REVENUECAT_PREMIUM_ENTITLEMENT
        || record.identifier === REVENUECAT_PREMIUM_ENTITLEMENT;
    });
    if (!grantsPremium) {
      return false;
    }
    const periodEndsAt = parseDate(
      subscription.current_period_ends_at
        ?? subscription.current_period_end
        ?? subscription.expires_at,
    );
    return periodEndsAt !== null && periodEndsAt > now;
  }) as Record<string, unknown> | undefined;

  if (!verifiedSubscription) {
    return {
      active: false,
      expiresAt: entitlement.expiresAt,
      productId: null,
    };
  }
  const subscriptionExpiresAt = parseDate(
    verifiedSubscription.current_period_ends_at
      ?? verifiedSubscription.current_period_end
      ?? verifiedSubscription.expires_at,
  )!;
  const expiresAt = entitlement.expiresAt
    ? new Date(Math.min(
        entitlement.expiresAt.getTime(),
        subscriptionExpiresAt.getTime(),
      ))
    : subscriptionExpiresAt;
  return {
    active: true,
    expiresAt,
    productId: typeof verifiedSubscription.product_id === "string"
      ? verifiedSubscription.product_id
      : null,
  };
}

let entitlementResourceCache: { projectId: string; id: string; validUntil: number } | null = null;

async function resolvePremiumEntitlementId(connectors: ReplitConnectors, projectId: string): Promise<string> {
  if (entitlementResourceCache?.projectId === projectId && entitlementResourceCache.validUntil > Date.now()) {
    return entitlementResourceCache.id;
  }
  const response = await connectors.proxy(
    "revenuecat",
    `/v2/projects/${encodeURIComponent(projectId)}/entitlements`,
    { method: "GET" },
  );
  if (!response.ok) throw new Error(`RevenueCat entitlement configuration request failed (${response.status})`);
  const payload = await response.json() as { items?: Array<{ id?: unknown; lookup_key?: unknown }> };
  const configured = payload.items?.find((item) => item.lookup_key === REVENUECAT_PREMIUM_ENTITLEMENT);
  if (!configured || typeof configured.id !== "string") {
    throw new Error("RevenueCat premium entitlement is not configured");
  }
  entitlementResourceCache = { projectId, id: configured.id, validUntil: Date.now() + 5 * 60_000 };
  return configured.id;
}

const connectorProvider: RevenueCatProvider = {
  async getPremiumEntitlement(appUserId) {
    const projectId = process.env.REVENUECAT_PROJECT_ID?.trim();
    if (!projectId) throw new Error("RevenueCat project is not configured");
    const connectors = new ReplitConnectors();
    const entitlementResourceId = await resolvePremiumEntitlementId(connectors, projectId);
    const customerPath = `/v2/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(appUserId)}`;
    const entitlementResponse = await connectors.proxy(
      "revenuecat",
      `${customerPath}/active_entitlements`,
      { method: "GET" },
    );
    if (entitlementResponse.status === 404) {
      return { active: false, expiresAt: null, productId: null };
    }
    if (!entitlementResponse.ok) {
      throw new Error(`RevenueCat request failed (${entitlementResponse.status})`);
    }
    const entitlementPayload = await entitlementResponse.json();
    const subscriptionResponse = await connectors.proxy(
      "revenuecat",
      `${customerPath}/subscriptions?limit=100`,
      { method: "GET" },
    );
    if (subscriptionResponse.status !== 404 && !subscriptionResponse.ok) {
      throw new Error(
        `RevenueCat subscription request failed (${subscriptionResponse.status})`,
      );
    }
    const subscriptionPayload: unknown = subscriptionResponse.ok
      ? await subscriptionResponse.json()
      : { items: [] };
    return parseVerifiedRevenueCatPremium(
      entitlementPayload,
      subscriptionPayload,
      entitlementResourceId,
    );
  },
};

function provider(): RevenueCatProvider {
  return testProvider ?? connectorProvider;
}

function activeStripeWhere(userId: number, now: Date) {
  return and(
    eq(premiumSubscriptionsTable.userId, userId),
    inArray(premiumSubscriptionsTable.status, ["active", "trialing", "past_due", "canceled"]),
    gt(premiumSubscriptionsTable.currentPeriodEnd, now),
  );
}

async function hasValidStripe(userId: number, now: Date): Promise<boolean> {
  const [row] = await db.select({ id: premiumSubscriptionsTable.id })
    .from(premiumSubscriptionsTable).where(activeStripeWhere(userId, now)).limit(1);
  return Boolean(row);
}

export async function hasPremiumAccess(userId: number, now = new Date()): Promise<boolean> {
  if (await hasValidStripe(userId, now)) return true;
  const [native] = await db.select({ id: nativePremiumEntitlementsTable.id })
    .from(nativePremiumEntitlementsTable)
    .where(and(
      eq(nativePremiumEntitlementsTable.userId, userId),
      eq(nativePremiumEntitlementsTable.isActive, true),
      gt(nativePremiumEntitlementsTable.cacheValidUntil, now),
      or(
        sql`${nativePremiumEntitlementsTable.expiresAt} is null`,
        gt(nativePremiumEntitlementsTable.expiresAt, now),
      ),
    )).limit(1);
  return Boolean(native);
}

async function syncLegacyPremiumFlag(userId: number, nativeActive: boolean, now: Date): Promise<void> {
  const stripeActive = await hasValidStripe(userId, now);
  await db.update(usersTable).set({ isPremium: stripeActive || nativeActive }).where(eq(usersTable.id, userId));
}

export class RevenueCatUnavailableError extends Error {}

type PremiumTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function syncLegacyPremiumFlagInTransaction(
  tx: PremiumTransaction,
  userId: number,
  nativeActive: boolean,
  now: Date,
): Promise<void> {
  const [stripe] = await tx.select({ id: premiumSubscriptionsTable.id })
    .from(premiumSubscriptionsTable)
    .where(activeStripeWhere(userId, now))
    .limit(1);
  await tx.update(usersTable)
    .set({ isPremium: Boolean(stripe) || nativeActive })
    .where(eq(usersTable.id, userId));
}

function withPremiumTransaction<T>(
  transaction: PremiumTransaction | undefined,
  work: (tx: PremiumTransaction) => Promise<T>,
): Promise<T> {
  return transaction ? work(transaction) : db.transaction(work);
}

export async function reconcileNativePremium(
  userId: number,
  appUserId: string,
  transaction?: PremiumTransaction,
): Promise<NativePremiumEntitlement> {
  if (
    !/^los_user_(?:[1-9]\d*|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
      .test(appUserId)
  ) {
    throw new Error("Invalid RevenueCat app user id");
  }
  const startedAt = new Date();
  let state: RevenueCatEntitlementState;
  try {
    state = await provider().getPremiumEntitlement(appUserId);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "RevenueCat request failed";
    await withPremiumTransaction(transaction, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(73021, ${userId})`);
      const [current] = await tx.select().from(nativePremiumEntitlementsTable)
        .where(eq(nativePremiumEntitlementsTable.userId, userId)).limit(1);
      if (current?.lastAttemptAt && current.lastAttemptAt > startedAt) return;
      if (current) {
        await tx.update(nativePremiumEntitlementsTable).set({
          lastAttemptAt: startedAt,
          lastError: message,
        }).where(eq(nativePremiumEntitlementsTable.userId, userId));
      } else {
        await tx.insert(nativePremiumEntitlementsTable).values({
          userId,
          appUserId,
          provider: "revenuecat",
          entitlementId: REVENUECAT_PREMIUM_ENTITLEMENT,
          isActive: false,
          expiresAt: null,
          cacheValidUntil: new Date(0),
          verifiedAt: new Date(0),
          lastAttemptAt: startedAt,
          lastError: message,
        }).onConflictDoNothing();
      }
    });
    throw new RevenueCatUnavailableError(message);
  }

  const verifiedAt = new Date();
  const cacheDeadline = new Date(verifiedAt.getTime() + CACHE_TTL_MS);
  const cacheValidUntil = state.expiresAt && state.expiresAt < cacheDeadline ? state.expiresAt : cacheDeadline;
  let result!: NativePremiumEntitlement;
  await withPremiumTransaction(transaction, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(73021, ${userId})`);
    const [current] = await tx.select().from(nativePremiumEntitlementsTable)
      .where(eq(nativePremiumEntitlementsTable.userId, userId)).limit(1);
    if (current && current.verifiedAt > startedAt) {
      result = current;
    } else {
      const values = {
        provider: "revenuecat",
        appUserId,
        entitlementId: REVENUECAT_PREMIUM_ENTITLEMENT,
        productId: state.productId,
        isActive: state.active,
        expiresAt: state.expiresAt,
        cacheValidUntil,
        verifiedAt,
        lastAttemptAt: verifiedAt,
        lastError: null,
      };
      [result] = await tx.insert(nativePremiumEntitlementsTable)
        .values({ userId, ...values })
        .onConflictDoUpdate({
          target: nativePremiumEntitlementsTable.userId,
          set: values,
        }).returning();
    }
    const premiumNow = new Date();
    await syncLegacyPremiumFlagInTransaction(
      tx,
      userId,
      result.isActive
        && result.cacheValidUntil > premiumNow
        && (!result.expiresAt || result.expiresAt > premiumNow),
      premiumNow,
    );
  });
  return result;
}

export async function expireStaleNativePremium(userId: number, now = new Date()): Promise<void> {
  await db.update(nativePremiumEntitlementsTable).set({ isActive: false })
    .where(and(
      eq(nativePremiumEntitlementsTable.userId, userId),
      eq(nativePremiumEntitlementsTable.isActive, true),
      or(
        lte(nativePremiumEntitlementsTable.cacheValidUntil, now),
        lte(nativePremiumEntitlementsTable.expiresAt, now),
      ),
    ));
  await syncLegacyPremiumFlag(userId, await hasPremiumAccess(userId, now), now);
}
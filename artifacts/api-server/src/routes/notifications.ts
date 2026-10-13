import { Router, type IRouter } from "express";
import {
  db,
  notificationsTable,
  messagesTable,
  conversationParticipantsTable,
  pushTokensTable,
  notificationPreferencesTable,
  notificationDeliveriesTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { z } from "zod";
import { parsePositiveSafeInteger } from "../lib/positiveSafeInteger";

const router: IRouter = Router();

// --- Push token registration / removal (authenticated) ---
router.post("/notifications/push-tokens", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const { token, platform, provider } = req.body as { token?: string; platform?: string; provider?: string };
  if (typeof token !== "string" || token.trim().length < 8) {
    res.status(400).json({ error: "A valid push token is required" });
    return;
  }
  const validPlatforms = ["ios", "android", "web"];
  const validProviders = ["expo", "fcm", "apns"];
  const plat = validPlatforms.includes(String(platform)) ? String(platform) : "web";
  const prov = validProviders.includes(String(provider)) ? String(provider) : "expo";
  const [row] = await db.insert(pushTokensTable).values({
    userId: user.id,
    token: token.trim(),
    platform: plat,
    provider: prov,
    isActive: true,
  }).onConflictDoUpdate({
    target: pushTokensTable.token,
    set: { userId: user.id, platform: plat, provider: prov, isActive: true, lastSeenAt: new Date() },
  }).returning();
  // Never echo the token back in full.
  res.status(201).json({ id: row.id, platform: row.platform, provider: row.provider, isActive: row.isActive });
});

router.delete("/notifications/push-tokens", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!token) { res.status(400).json({ error: "token is required" }); return; }
  const [row] = await db.update(pushTokensTable)
    .set({ isActive: false })
    .where(and(eq(pushTokensTable.token, token), eq(pushTokensTable.userId, user.id)))
    .returning();
  if (!row) { res.status(404).json({ error: "Token not found" }); return; }
  res.json({ message: "Token removed" });
});

// --- Server-side notification preferences ---
router.get("/notifications/preferences", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  if (Object.keys(req.query).length > 0) {
    res.status(400).json({ error: "Query parameters are not supported" });
    return;
  }
  const [prefs] = await db.select().from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.userId, user.id)).limit(1);
  res.json({
    pushEnabled: prefs?.pushEnabled ?? true,
    emailEnabled: prefs?.emailEnabled ?? true,
    bookingEnabled: prefs?.bookingEnabled ?? true,
    showOnlineStatus: prefs?.showOnlineStatus ?? true,
    readReceipts: prefs?.readReceipts ?? true,
  });
});

router.put("/notifications/preferences", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const parsed = z.strictObject({
    pushEnabled: z.boolean(),
    emailEnabled: z.boolean(),
    bookingEnabled: z.boolean(),
    showOnlineStatus: z.boolean().optional(),
    readReceipts: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ issues: parsed.error.issues }, "Invalid notification preferences update");
    res.status(400).json({ error: "Invalid notification preferences", issues: parsed.error.issues });
    return;
  }
  const [current] = await db.select().from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.userId, user.id)).limit(1);
  const set = {
    pushEnabled: parsed.data.pushEnabled,
    emailEnabled: parsed.data.emailEnabled,
    bookingEnabled: parsed.data.bookingEnabled,
    showOnlineStatus: parsed.data.showOnlineStatus ?? current?.showOnlineStatus ?? true,
    readReceipts: parsed.data.readReceipts ?? current?.readReceipts ?? true,
  };
  const [row] = await db.insert(notificationPreferencesTable)
    .values({ userId: user.id, ...set })
    .onConflictDoUpdate({ target: notificationPreferencesTable.userId, set })
    .returning();
  res.json({
    pushEnabled: row.pushEnabled,
    emailEnabled: row.emailEnabled,
    bookingEnabled: row.bookingEnabled,
    showOnlineStatus: row.showOnlineStatus,
    readReceipts: row.readReceipts,
  });
});

// --- Delivery status visibility (own deliveries only) ---
router.get("/notifications/deliveries", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const rows = await db.select().from(notificationDeliveriesTable)
    .where(eq(notificationDeliveriesTable.userId, user.id))
    .orderBy(desc(notificationDeliveriesTable.createdAt)).limit(50);
  res.json(rows.map((r) => ({
    id: r.id,
    notificationId: r.notificationId,
    channel: r.channel,
    status: r.status,
    attempts: r.attempts,
    lastError: r.lastError,
    nextRetryAt: r.nextRetryAt,
    sentAt: r.sentAt,
  })));
});

router.get("/notifications", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const limit = parseInt(String(req.query.limit ?? "30"));
  const unreadOnly = req.query.unreadOnly === "true";
  const where = unreadOnly
    ? and(eq(notificationsTable.userId, user.id), eq(notificationsTable.isRead, false))
    : eq(notificationsTable.userId, user.id);
  const notifs = await db.select().from(notificationsTable).where(where).orderBy(desc(notificationsTable.createdAt)).limit(limit);
  res.json(notifs);
});

router.post("/notifications/read-all", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  await db.update(notificationsTable).set({ isRead: true }).where(eq(notificationsTable.userId, user.id));
  res.json({ message: "All marked as read" });
});

router.patch("/notifications/:notificationId/read", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const nId = parsePositiveSafeInteger(Array.isArray(req.params.notificationId) ? req.params.notificationId[0] : req.params.notificationId);
  if (nId === null) { res.status(400).json({ error: "Invalid notification id" }); return; }
  const [n] = await db.update(notificationsTable).set({ isRead: true })
    .where(and(eq(notificationsTable.id, nId), eq(notificationsTable.userId, user.id))).returning();
  if (!n) { res.status(404).json({ error: "Not found" }); return; }
  res.json(n);
});

router.get("/notifications/unread-count", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const [{ n: notifCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(notificationsTable)
    .where(and(eq(notificationsTable.userId, user.id), eq(notificationsTable.isRead, false)));

  // Unread messages: conversations I'm in with messages after my lastReadAt
  const participations = await db.select().from(conversationParticipantsTable).where(eq(conversationParticipantsTable.userId, user.id));
  let msgCount = 0;
  for (const p of participations) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(messagesTable)
      .where(and(
        eq(messagesTable.conversationId, p.conversationId),
        sql`${messagesTable.senderId} != ${user.id}`,
        sql`${messagesTable.isDeleted} = false`,
        p.lastReadAt ? sql`${messagesTable.createdAt} > ${p.lastReadAt}` : sql`1=1`,
      ));
    msgCount += n;
  }

  const [{ n: matchCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(notificationsTable)
    .where(and(eq(notificationsTable.userId, user.id), eq(notificationsTable.type, "match"), eq(notificationsTable.isRead, false)));

  res.json({ notifications: notifCount, messages: msgCount, matches: matchCount });
});

export default router;

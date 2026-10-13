import { Router, type IRouter } from "express";
import {
  db,
  blocksTable,
  reportsTable,
  safetyTipsTable,
  profilesTable,
  profilePhotosTable,
  matchesTable,
  conversationsTable,
  usersTable,
  externalIdentitiesTable,
} from "@workspace/db";
import { eq, and, or, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { parsePositiveSafeInteger } from "../lib/positiveSafeInteger";

const router: IRouter = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.get("/safety/users/resolve/:supabaseUserId", requireAuth, async (req, res): Promise<void> => {
  const supabaseUserId = Array.isArray(req.params.supabaseUserId)
    ? req.params.supabaseUserId[0]
    : req.params.supabaseUserId;
  if (!UUID_PATTERN.test(supabaseUserId)) {
    res.status(400).json({ error: "Invalid Supabase user ID" });
    return;
  }

  const [linked] = await db
    .select({ userId: externalIdentitiesTable.userId })
    .from(externalIdentitiesTable)
    .innerJoin(usersTable, eq(externalIdentitiesTable.userId, usersTable.id))
    .where(and(
      eq(externalIdentitiesTable.provider, "supabase"),
      eq(externalIdentitiesTable.subject, supabaseUserId),
    ))
    .limit(1);
  if (!linked) {
    res.status(404).json({ error: "Supabase user has no linked safety identity" });
    return;
  }

  res.json({ userId: linked.userId });
});

router.post("/safety/block", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const { blockedUserId, reason } = req.body;
  if (!blockedUserId) { res.status(400).json({ error: "blockedUserId required" }); return; }

  const blockerId = user.id;
  const blockedId = parsePositiveSafeInteger(
    typeof blockedUserId === "number" ? String(blockedUserId) : blockedUserId,
  );
  if (blockedId === null) { res.status(400).json({ error: "blockedUserId must be a valid user id" }); return; }
  if (blockerId === blockedId) { res.status(400).json({ error: "You cannot block yourself" }); return; }

  const blocked = await db.transaction(async (tx) => {
    const [low, high] = [blockerId, blockedId].sort((a, b) => a - b);
    await tx.execute(sql`select pg_advisory_xact_lock(${low}, ${high})`);
    const [target] = await tx.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.id, blockedId)).limit(1).for("key share");
    if (!target) return false;
    // An explicit block upgrades an auto-created reverse row. The reverse insert
    // never overwrites another user's explicit reason/intent.
    await tx.insert(blocksTable).values({ blockerId, blockedId, reason: reason ?? null, isExplicit: true })
      .onConflictDoUpdate({
        target: [blocksTable.blockerId, blocksTable.blockedId],
        set: { reason: reason ?? null, isExplicit: true },
      });
    await tx.insert(blocksTable)
      .values({ blockerId: blockedId, blockedId: blockerId, reason: "auto: symmetric block", isExplicit: false })
      .onConflictDoNothing();

    const matchRows = await tx.select().from(matchesTable).where(
      or(
        and(eq(matchesTable.userId1, blockerId), eq(matchesTable.userId2, blockedId)),
        and(eq(matchesTable.userId1, blockedId), eq(matchesTable.userId2, blockerId)),
      )
    );

    if (matchRows.length > 0) {
      const matchIds = matchRows.map((m) => m.id);
      await tx.delete(matchesTable).where(inArray(matchesTable.id, matchIds));
    }
    // Only the pair's canonical direct conversation is removed. Shared group
    // conversations and their messages belong to all members and must survive.
    const directKey = `${low}:${high}`;
    await tx.delete(conversationsTable).where(and(
      eq(conversationsTable.type, "direct"),
      eq(conversationsTable.directKey, directKey),
    ));
    return true;
  });
  if (!blocked) { res.status(404).json({ error: "User not found" }); return; }

  res.json({ message: "User blocked" });
});

router.delete("/safety/block/:blockedUserId", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const blockedId = parsePositiveSafeInteger(Array.isArray(req.params.blockedUserId) ? req.params.blockedUserId[0] : req.params.blockedUserId);
  if (blockedId === null) { res.status(400).json({ error: "blockedUserId must be a valid user id" }); return; }
  if (blockedId === user.id) { res.status(400).json({ error: "You cannot unblock yourself" }); return; }
  // Only the auto-created reverse block is cleared; if the other user placed
  // their own explicit block, that stands.
  const unblocked = await db.transaction(async (tx) => {
    const [low, high] = [user.id, blockedId].sort((a, b) => a - b);
    await tx.execute(sql`select pg_advisory_xact_lock(${low}, ${high})`);
    const [target] = await tx.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.id, blockedId)).limit(1).for("key share");
    if (!target) return false;
    await tx.delete(blocksTable).where(and(eq(blocksTable.blockerId, user.id), eq(blocksTable.blockedId, blockedId)));
    await tx.delete(blocksTable).where(and(
      eq(blocksTable.blockerId, blockedId),
      eq(blocksTable.blockedId, user.id),
      or(
        eq(blocksTable.isExplicit, false),
        // Rows created before isExplicit existed receive the column default
        // during publish-time schema sync. Their reserved reason still proves
        // they are automatic and safe to remove.
        eq(blocksTable.reason, "auto: symmetric block"),
      ),
    ));
    return true;
  });
  if (!unblocked) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ message: "User unblocked" });
});

router.get("/safety/blocks", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const blocks = await db.select().from(blocksTable).where(eq(blocksTable.blockerId, user.id));
  const result = await Promise.all(blocks.map(async (b) => {
    const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, b.blockedId)).limit(1);
    const photos = profile ? await db.select().from(profilePhotosTable).where(eq(profilePhotosTable.userId, b.blockedId)) : [];
    return { id: b.id, blockedUserId: b.blockedId, blockedUser: profile ? { ...profile, photos } : null, createdAt: b.createdAt };
  }));
  res.json(result);
});

router.post("/safety/report", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const { reportedUserId, reason, description, messageId } = req.body;
  if (!reportedUserId || !reason) { res.status(400).json({ error: "reportedUserId and reason required" }); return; }
  if (reportedUserId === user.id) { res.status(400).json({ error: "You cannot report yourself" }); return; }

  // Deduplicate: collapse into any existing open (pending) report from this
  // reporter against the same user so the moderation queue is not spammed.
  const [existing] = await db.select().from(reportsTable).where(and(
    eq(reportsTable.reporterId, user.id),
    eq(reportsTable.reportedId, reportedUserId),
    eq(reportsTable.status, "pending"),
  )).limit(1);
  if (existing) {
    res.status(200).json({ message: "Report already received", reportId: existing.id, deduplicated: true });
    return;
  }

  const [report] = await db.insert(reportsTable).values({
    reporterId: user.id,
    reportedId: reportedUserId,
    reason,
    description: description ?? null,
    messageId: messageId ?? null,
  }).returning();
  res.status(201).json({ message: "Report submitted", reportId: report.id });
});

router.get("/safety/tips", requireAuth, async (req, res): Promise<void> => {
  const tips = await db.select().from(safetyTipsTable).limit(20);
  if (tips.length === 0) {
    // Return built-in tips if none seeded
    res.json([
      { id: 1, title: "Meet in public first", body: "For your first in-person meeting, always choose a busy public place.", category: "meeting" },
      { id: 2, title: "Protect personal info", body: "Don't share your home address, workplace, or financial information early on.", category: "privacy" },
      { id: 3, title: "Trust your instincts", body: "If something feels off, it probably is. Use the safety controls currently available for that profile, or contact support if an action is temporarily unavailable.", category: "general" },
      { id: 4, title: "Use in-app communication", body: "Keep conversations on LandOverSEA until you feel comfortable and trust the other person.", category: "privacy" },
      { id: 5, title: "Video call before meeting", body: "A video call is a great way to verify someone's identity before meeting in person.", category: "verification" },
    ]);
    return;
  }
  res.json(tips);
});

export default router;

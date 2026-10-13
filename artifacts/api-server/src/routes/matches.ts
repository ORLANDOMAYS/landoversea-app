import { Router, type IRouter } from "express";
import {
  db, matchesTable, profilesTable, profilePhotosTable, swipesTable,
  conversationsTable, conversationParticipantsTable, messagesTable,
} from "@workspace/db";
import { eq, or, and, count } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { parsePositiveSafeInteger } from "../lib/positiveSafeInteger";

const router: IRouter = Router();

async function buildMatchResponse(match: any, currentUserId: number) {
  const otherUserId = match.userId1 === currentUserId ? match.userId2 : match.userId1;
  const [otherProfile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, otherUserId)).limit(1);
  const photos = otherProfile
    ? await db.select().from(profilePhotosTable).where(eq(profilePhotosTable.userId, otherUserId))
    : [];
  photos.sort((a, b) => a.position - b.position);
  return {
    id: match.id,
    userId1: match.userId1,
    userId2: match.userId2,
    conversationId: match.conversationId ?? null,
    otherUser: otherProfile ? { ...otherProfile, photos } : null,
    createdAt: match.createdAt,
  };
}

router.get("/matches", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const limit = parseInt(String(req.query.limit ?? "50"));
  const offset = parseInt(String(req.query.offset ?? "0"));

  const matches = await db.select().from(matchesTable)
    .where(or(eq(matchesTable.userId1, user.id), eq(matchesTable.userId2, user.id)))
    .limit(limit).offset(offset);

  const result = await Promise.all(matches.map((m) => buildMatchResponse(m, user.id)));
  res.json(result);
});

router.get("/matches/stats", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const allMatches = await db.select().from(matchesTable).where(
    or(eq(matchesTable.userId1, user.id), eq(matchesTable.userId2, user.id))
  );
  const newThisWeek = allMatches.filter((m) => new Date(m.createdAt) > oneWeekAgo).length;
  const withConversations = allMatches.filter((m) => m.conversationId != null).length;
  const superlikesSent = await db.select({ n: count() }).from(swipesTable)
    .where(and(eq(swipesTable.swiperId, user.id), eq(swipesTable.action, "superlike")));

  res.json({
    totalMatches: allMatches.length,
    newMatchesThisWeek: newThisWeek,
    activeConversations: withConversations,
    superlikesSent: superlikesSent[0]?.n ?? 0,
  });
});

router.get("/matches/:matchId", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const matchId = parsePositiveSafeInteger(Array.isArray(req.params.matchId) ? req.params.matchId[0] : req.params.matchId);
  if (matchId === null) { res.status(400).json({ error: "Invalid match id" }); return; }
  const [match] = await db.select().from(matchesTable).where(
    and(eq(matchesTable.id, matchId),
      or(eq(matchesTable.userId1, user.id), eq(matchesTable.userId2, user.id)))
  ).limit(1);
  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }
  res.json(await buildMatchResponse(match, user.id));
});

router.delete("/matches/:matchId", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const matchId = parsePositiveSafeInteger(Array.isArray(req.params.matchId) ? req.params.matchId[0] : req.params.matchId);
  if (matchId === null) { res.status(400).json({ error: "Invalid match id" }); return; }
  const [match] = await db.select().from(matchesTable).where(
    and(eq(matchesTable.id, matchId),
      or(eq(matchesTable.userId1, user.id), eq(matchesTable.userId2, user.id)))
  ).limit(1);
  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }
  await db.transaction(async (tx) => {
    // Tear down the reusable direct conversation so it can be recreated cleanly
    // on a future re-match (unique directKey stays consistent).
    if (match.conversationId) {
      await tx.delete(messagesTable).where(eq(messagesTable.conversationId, match.conversationId));
      await tx.delete(conversationParticipantsTable).where(eq(conversationParticipantsTable.conversationId, match.conversationId));
      await tx.delete(conversationsTable).where(eq(conversationsTable.id, match.conversationId));
    }
    await tx.delete(matchesTable).where(eq(matchesTable.id, matchId));
  });
  res.json({ message: "Unmatched" });
});

export default router;

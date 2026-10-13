import { Router, type IRouter } from "express";
import {
  db, conversationsTable, conversationParticipantsTable,
  messagesTable, profilesTable, profilePhotosTable,
} from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import {
  getBlockedUserIds,
  getConversationAccessPolicy,
  hasBlockedPair,
  lockUserPairs,
} from "../lib/blockedParticipants";
import { isCanonicalLanguage, normalizeLanguage } from "../lib/translation-languages";
import { parsePositiveSafeInteger } from "../lib/positiveSafeInteger";

const router: IRouter = Router();

function parsePathId(raw: unknown, res: any, resource: "conversation" | "member"): number | null {
  const id = parsePositiveSafeInteger(raw);
  if (id === null) res.status(400).json({ error: `Invalid ${resource} ID` });
  return id;
}

async function buildConversation(conv: any, currentUserId: number) {
  const policy = await getConversationAccessPolicy(db, conv.id, currentUserId);
  const { participants, blockedUserIds } = policy;
  const myParticipant = policy.participant;

  const participantProfiles = await Promise.all(
    participants.filter((p: any) => p.userId !== currentUserId && !blockedUserIds.has(p.userId)).map(async (p: any) => {
      const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, p.userId)).limit(1);
      const photos = profile ? await db.select().from(profilePhotosTable).where(eq(profilePhotosTable.userId, p.userId)) : [];
      return profile ? { ...profile, role: p.role, photos: photos.sort((a, b) => a.position - b.position) } : null;
    })
  );
  const visibleProfiles = participantProfiles.filter(Boolean);
  const otherParticipant = conv.type === "direct"
    ? participants.find((p: any) => p.userId !== currentUserId && !blockedUserIds.has(p.userId))
    : null;
  const otherProfile = conv.type === "direct" ? visibleProfiles[0] as any : null;
  const configuredRecipientLanguage = otherParticipant?.translationEnabled
    && isCanonicalLanguage(otherParticipant.translationLanguage)
    ? otherParticipant.translationLanguage
    : null;

  const [lastMsg] = await db.select().from(messagesTable)
    .where(and(
      eq(messagesTable.conversationId, conv.id),
      blockedUserIds.size > 0
        ? sql`${messagesTable.senderId} NOT IN (${sql.join([...blockedUserIds].map((id) => sql`${id}`), sql`, `)})`
        : undefined,
    ))
    .orderBy(desc(messagesTable.createdAt)).limit(1);

  let unreadCount = 0;
  if (myParticipant?.lastReadAt) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(messagesTable)
      .where(and(
        eq(messagesTable.conversationId, conv.id),
        sql`${messagesTable.createdAt} > ${myParticipant.lastReadAt}`,
        sql`${messagesTable.senderId} != ${currentUserId}`,
        blockedUserIds.size > 0
          ? sql`${messagesTable.senderId} NOT IN (${sql.join([...blockedUserIds].map((id) => sql`${id}`), sql`, `)})`
          : undefined,
      ));
    unreadCount = n;
  } else {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(messagesTable)
      .where(and(
        eq(messagesTable.conversationId, conv.id),
        sql`${messagesTable.senderId} != ${currentUserId}`,
        blockedUserIds.size > 0
          ? sql`${messagesTable.senderId} NOT IN (${sql.join([...blockedUserIds].map((id) => sql`${id}`), sql`, `)})`
          : undefined,
      ));
    unreadCount = n;
  }

  return {
    id: conv.id,
    type: conv.type,
    matchId: conv.matchId ?? null,
    title: conv.title ?? null,
    ownerId: conv.ownerId ?? null,
    myRole: myParticipant?.role ?? null,
    participants: visibleProfiles,
    lastMessage: lastMsg ? {
      ...lastMsg,
      reactions: ((lastMsg.reactions as any[]) ?? []).filter(
        (reaction) => !blockedUserIds.has(reaction.userId),
      ),
    } : null,
    unreadCount,
    isPinned: myParticipant?.isPinned ?? false,
    isMuted: myParticipant?.isMuted ?? false,
    translationEnabled: myParticipant?.translationEnabled ?? false,
    translationLanguage: isCanonicalLanguage(myParticipant?.translationLanguage)
      ? myParticipant.translationLanguage
      : null,
    ...(conv.type === "direct"
      ? { recipientTranslationLanguage: configuredRecipientLanguage }
      : {}),
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
  };
}

router.get("/conversations", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const myParticipations = await db.select().from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.userId, user.id));
  const convIds = myParticipations.map((p) => p.conversationId);
  if (convIds.length === 0) { res.json([]); return; }

  const convs = await db.select().from(conversationsTable)
    .where(inArray(conversationsTable.id, convIds));

  const result = await Promise.all(convs.map((c) => buildConversation(c, user.id)));
  result.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  res.json(result);
});

// ── GROUP CREATION ──────────────────────────────────────────────────────────
router.post("/conversations/group", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const { title, participantIds } = req.body as { title?: string; participantIds?: number[] };
  const members = Array.from(new Set((participantIds ?? []).filter((id) => Number.isInteger(id) && id !== user.id)));
  if (!title || !title.trim()) { res.status(400).json({ error: "title required" }); return; }

  let convId!: number;
  const created = await db.transaction(async (tx) => {
    await lockUserPairs(tx, [user.id, ...members]);
    if (await hasBlockedPair(tx, [user.id, ...members])) return false;
    const [conv] = await tx.insert(conversationsTable).values({
      type: "group",
      title: title.trim(),
      ownerId: user.id,
    }).returning();
    convId = conv.id;
    await tx.insert(conversationParticipantsTable).values([
      { conversationId: conv.id, userId: user.id, role: "owner" },
      ...members.map((id) => ({ conversationId: conv.id, userId: id, role: "member" as const })),
    ]).onConflictDoNothing();
    return true;
  });
  if (!created) {
    res.status(400).json({ error: "Group cannot contain users who have blocked each other" });
    return;
  }

  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, convId)).limit(1);
  res.status(201).json(await buildConversation(conv, user.id));
});

router.get("/conversations/:conversationId", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const convId = parsePathId(req.params.conversationId, res, "conversation");
  if (convId === null) return;
  const [participant] = await db.select().from(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.conversationId, convId), eq(conversationParticipantsTable.userId, user.id))).limit(1);
  if (!participant) { res.status(404).json({ error: "Conversation not found" }); return; }
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, convId)).limit(1);
  res.json(await buildConversation(conv, user.id));
});

// ── GROUP MEMBER MANAGEMENT ─────────────────────────────────────────────────
async function requireGroupAdmin(convId: number, userId: number, res: any) {
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, convId)).limit(1);
  if (!conv || conv.type !== "group") { res.status(404).json({ error: "Group not found" }); return null; }
  const [me] = await db.select().from(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.conversationId, convId), eq(conversationParticipantsTable.userId, userId))).limit(1);
  if (!me) { res.status(403).json({ error: "Not a participant" }); return null; }
  if (me.role !== "owner" && me.role !== "admin") { res.status(403).json({ error: "Admin privileges required" }); return null; }
  return { conv, me };
}

router.post("/conversations/:conversationId/members", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const convId = parsePathId(req.params.conversationId, res, "conversation");
  if (convId === null) return;
  const ctx = await requireGroupAdmin(convId, user.id, res);
  if (!ctx) return;
  const { userId } = req.body as { userId?: number };
  if (!Number.isInteger(userId)) { res.status(400).json({ error: "userId required" }); return; }
  const added = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(1196575047, ${convId})`);
    const existingParticipants = await tx.select({ userId: conversationParticipantsTable.userId })
      .from(conversationParticipantsTable)
      .where(eq(conversationParticipantsTable.conversationId, convId));
    const memberIds = existingParticipants.map((p: { userId: number }) => p.userId);
    await lockUserPairs(tx, [...memberIds, userId!]);
    const candidateBlocks = await getBlockedUserIds(tx, userId!, memberIds);
    if (candidateBlocks.size > 0) return false;
    await tx.insert(conversationParticipantsTable)
      .values({ conversationId: convId, userId: userId!, role: "member" })
      .onConflictDoNothing();
    return true;
  });
  if (!added) {
    res.status(400).json({ error: "Group cannot contain users who have blocked each other" });
    return;
  }
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, convId)).limit(1);
  res.json(await buildConversation(conv, user.id));
});

router.delete("/conversations/:conversationId/members/:userId", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const convId = parsePathId(req.params.conversationId, res, "conversation");
  if (convId === null) return;
  const targetId = parsePathId(req.params.userId, res, "member");
  if (targetId === null) return;
  const ctx = await requireGroupAdmin(convId, user.id, res);
  if (!ctx) return;
  const [target] = await db.select().from(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.conversationId, convId), eq(conversationParticipantsTable.userId, targetId))).limit(1);
  if (!target) { res.status(404).json({ error: "Member not found" }); return; }
  if (target.role === "owner") { res.status(400).json({ error: "Cannot remove the owner" }); return; }
  // Admins cannot remove other admins; only the owner can.
  if (target.role === "admin" && ctx.me.role !== "owner") { res.status(403).json({ error: "Only the owner can remove an admin" }); return; }
  await db.delete(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.conversationId, convId), eq(conversationParticipantsTable.userId, targetId)));
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, convId)).limit(1);
  res.json(await buildConversation(conv, user.id));
});

// Promote/demote a member (owner only).
router.patch("/conversations/:conversationId/members/:userId/role", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const convId = parsePathId(req.params.conversationId, res, "conversation");
  if (convId === null) return;
  const targetId = parsePathId(req.params.userId, res, "member");
  if (targetId === null) return;
  const { role } = req.body as { role?: string };
  if (role !== "admin" && role !== "member") { res.status(400).json({ error: "role must be admin or member" }); return; }
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, convId)).limit(1);
  if (!conv || conv.type !== "group") { res.status(404).json({ error: "Group not found" }); return; }
  const [me] = await db.select().from(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.conversationId, convId), eq(conversationParticipantsTable.userId, user.id))).limit(1);
  if (!me || me.role !== "owner") { res.status(403).json({ error: "Only the owner can change roles" }); return; }
  const [target] = await db.select().from(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.conversationId, convId), eq(conversationParticipantsTable.userId, targetId))).limit(1);
  if (!target) { res.status(404).json({ error: "Member not found" }); return; }
  if (target.role === "owner") { res.status(400).json({ error: "Cannot change the owner's role" }); return; }
  await db.update(conversationParticipantsTable).set({ role })
    .where(and(eq(conversationParticipantsTable.conversationId, convId), eq(conversationParticipantsTable.userId, targetId)));
  res.json(await buildConversation(conv, user.id));
});

// Leave a group. Owner leaving transfers ownership to the oldest remaining member,
// or deletes the group if empty.
router.post("/conversations/:conversationId/leave", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const convId = parsePathId(req.params.conversationId, res, "conversation");
  if (convId === null) return;
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, convId)).limit(1);
  if (!conv || conv.type !== "group") { res.status(400).json({ error: "Can only leave group conversations" }); return; }
  const [me] = await db.select().from(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.conversationId, convId), eq(conversationParticipantsTable.userId, user.id))).limit(1);
  if (!me) { res.status(404).json({ error: "Not a participant" }); return; }

  await db.transaction(async (tx) => {
    await tx.delete(conversationParticipantsTable)
      .where(and(eq(conversationParticipantsTable.conversationId, convId), eq(conversationParticipantsTable.userId, user.id)));
    const remaining = await tx.select().from(conversationParticipantsTable)
      .where(eq(conversationParticipantsTable.conversationId, convId)).orderBy(conversationParticipantsTable.joinedAt);
    if (remaining.length === 0) {
      await tx.delete(conversationsTable).where(eq(conversationsTable.id, convId));
      return;
    }
    if (me.role === "owner") {
      const next = remaining[0];
      await tx.update(conversationParticipantsTable).set({ role: "owner" })
        .where(and(eq(conversationParticipantsTable.conversationId, convId), eq(conversationParticipantsTable.userId, next.userId)));
      await tx.update(conversationsTable).set({ ownerId: next.userId }).where(eq(conversationsTable.id, convId));
    }
  });

  res.json({ message: "Left conversation" });
});

router.patch("/conversations/:conversationId/pin", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const convId = parsePathId(req.params.conversationId, res, "conversation");
  if (convId === null) return;
  const { pinned } = req.body;
  const policy = await getConversationAccessPolicy(db, convId, user.id);
  if (!policy.participant) {
    res.status(403).json({ error: "Not a participant in this conversation" });
    return;
  }
  const [participant] = await db.update(conversationParticipantsTable).set({ isPinned: pinned })
    .where(and(eq(conversationParticipantsTable.conversationId, convId), eq(conversationParticipantsTable.userId, user.id)))
    .returning();
  if (!participant) {
    res.status(403).json({ error: "Not a participant in this conversation" });
    return;
  }
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, convId)).limit(1);
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
  res.json(await buildConversation(conv, user.id));
});

router.patch("/conversations/:conversationId/mute", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const convId = parsePathId(req.params.conversationId, res, "conversation");
  if (convId === null) return;
  const { muted } = req.body;
  const policy = await getConversationAccessPolicy(db, convId, user.id);
  if (!policy.participant) {
    res.status(403).json({ error: "Not a participant in this conversation" });
    return;
  }
  const [participant] = await db.update(conversationParticipantsTable).set({ isMuted: muted })
    .where(and(eq(conversationParticipantsTable.conversationId, convId), eq(conversationParticipantsTable.userId, user.id)))
    .returning();
  if (!participant) {
    res.status(403).json({ error: "Not a participant in this conversation" });
    return;
  }
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, convId)).limit(1);
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
  res.json(await buildConversation(conv, user.id));
});

router.patch("/conversations/:conversationId/translation-preferences", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const convId = parsePathId(req.params.conversationId, res, "conversation");
  if (convId === null) return;
  const { enabled, targetLanguage } = req.body as { enabled?: unknown; targetLanguage?: unknown };
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be a boolean" });
    return;
  }
  if (enabled && !isCanonicalLanguage(targetLanguage)) {
    res.status(400).json({ error: "targetLanguage must be a supported canonical language code" });
    return;
  }
  if (targetLanguage != null && !isCanonicalLanguage(targetLanguage)) {
    res.status(400).json({ error: "targetLanguage must be a supported canonical language code" });
    return;
  }
  const policy = await getConversationAccessPolicy(db, convId, user.id);
  if (!policy.participant) {
    res.status(403).json({ error: "Not a participant in this conversation" });
    return;
  }
  const [participant] = await db.update(conversationParticipantsTable).set({
    translationEnabled: enabled,
    translationLanguage: targetLanguage ?? policy.participant.translationLanguage ?? null,
  }).where(and(
    eq(conversationParticipantsTable.conversationId, convId),
    eq(conversationParticipantsTable.userId, user.id),
  )).returning();
  res.json({
    conversationId: convId,
    translationEnabled: participant.translationEnabled,
    translationLanguage: participant.translationLanguage,
  });
});

router.post("/conversations/:conversationId/read", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const convId = parsePathId(req.params.conversationId, res, "conversation");
  if (convId === null) return;
  const policy = await getConversationAccessPolicy(db, convId, user.id);
  if (!policy.participant) { res.status(403).json({ error: "Not a participant in this conversation" }); return; }
  await db.update(conversationParticipantsTable).set({ lastReadAt: new Date() })
    .where(and(eq(conversationParticipantsTable.conversationId, convId), eq(conversationParticipantsTable.userId, user.id)));
  res.json({ message: "Marked as read" });
});

// ── SSE LIVE UPDATES (with client-side polling fallback) ─────────────────────
router.get("/conversations/:conversationId/stream", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const convId = parsePathId(req.params.conversationId, res, "conversation");
  if (convId === null) return;
  const policy = await getConversationAccessPolicy(db, convId, user.id);
  if (!policy.participant) { res.status(403).json({ error: "Not a participant" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let lastSeen = new Date(0);
  const [latest] = await db.select().from(messagesTable)
    .where(eq(messagesTable.conversationId, convId)).orderBy(desc(messagesTable.createdAt)).limit(1);
  if (latest) lastSeen = new Date(latest.createdAt);

  res.write(`event: ready\ndata: ${JSON.stringify({ conversationId: convId })}\n\n`);

  const interval = setInterval(async () => {
    try {
      const currentPolicy = await getConversationAccessPolicy(db, convId, user.id);
      if (!currentPolicy.participant) {
        clearInterval(interval);
        res.end();
        return;
      }
      const fresh = await db.select().from(messagesTable)
        .where(and(
          eq(messagesTable.conversationId, convId),
          sql`${messagesTable.createdAt} > ${lastSeen}`,
          currentPolicy.blockedUserIds.size > 0
            ? sql`${messagesTable.senderId} NOT IN (${sql.join([...currentPolicy.blockedUserIds].map((id) => sql`${id}`), sql`, `)})`
            : undefined,
        ))
        .orderBy(messagesTable.createdAt).limit(50);
      if (fresh.length > 0) {
        lastSeen = new Date(fresh[fresh.length - 1].createdAt);
        const visible = fresh.map((message) => ({
          ...message,
          reactions: ((message.reactions as any[]) ?? []).filter(
            (reaction) => !currentPolicy.blockedUserIds.has(reaction.userId),
          ),
        }));
        res.write(`event: messages\ndata: ${JSON.stringify(visible)}\n\n`);
      } else {
        res.write(`event: ping\ndata: {}\n\n`);
      }
    } catch {
      res.write(`event: ping\ndata: {}\n\n`);
    }
  }, 3000);

  req.on("close", () => { clearInterval(interval); res.end(); });
});

export default router;

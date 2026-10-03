import { Router, type IRouter } from "express";
import {
  db, messagesTable, conversationParticipantsTable, translationsTable,
  conversationsTable, notificationPreferencesTable,
} from "@workspace/db";
import { eq, and, or, lt, desc, sql, ne, inArray, notInArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { ensureCompatibleFormat, speechToText } from "@workspace/integrations-openai-ai-server/audio";
import { ObjectStorageService } from "../lib/objectStorage";
import { ObjectAccessGroupType, ObjectPermission } from "../lib/objectAcl";
import { verifyUploadToken } from "../lib/uploadToken";
import { getBlockedUserIds, getConversationAccessPolicy } from "../lib/blockedParticipants";
import { isCanonicalLanguage, type CanonicalLanguageCode } from "../lib/translation-languages";
import { TRANSLATION_INPUT_MAX, translationService } from "../lib/translation-service";
import { persistSuccessfulTranslation } from "../lib/translation-cache";
import { enqueueNotification } from "../lib/notificationDispatch";
import { parsePositiveSafeInteger } from "../lib/positiveSafeInteger";

const router: IRouter = Router();

function parsePathId(raw: unknown, res: any, resource: "conversation" | "message"): number | null {
  const id = parsePositiveSafeInteger(raw);
  if (id === null) res.status(400).json({ error: `Invalid ${resource} ID` });
  return id;
}

async function getParticipant(convId: number, userId: number) {
  const [p] = await db.select().from(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.conversationId, convId), eq(conversationParticipantsTable.userId, userId))).limit(1);
  return p ?? null;
}

async function assertParticipant(convId: number, userId: number, res: any): Promise<boolean> {
  const policy = await getConversationAccessPolicy(db, convId, userId);
  if (!policy.participant) {
    res.status(403).json({ error: "Not a participant in this conversation" });
    return false;
  }
  return true;
}

/**
 * Resolve an attachment object path and require BOTH:
 *  - the requesting user has READ access under the object ACL, and
 *  - the object's ACL carries a CONVERSATION rule exactly matching `convId`.
 * This blocks sending/transcribing an attachment that belongs to a different
 * conversation even if the user could read it. Returns null on any failure.
 */
async function resolveConversationAttachment(
  storage: ObjectStorageService,
  objectPath: string,
  userId: number,
  convId: number,
) {
  const file = await storage.getObjectEntityFile(objectPath);
  const canRead = await storage.canAccessObjectEntity({
    userId: String(userId),
    objectFile: file,
    requestedPermission: ObjectPermission.READ,
  });
  if (!canRead) return null;

  const policy = await storage.getObjectEntityAclPolicy(file);
  if (policy?.owner && policy.owner !== String(userId)) {
    const blockedOwners = await getBlockedUserIds(db, userId, [Number(policy.owner)]);
    if (blockedOwners.has(Number(policy.owner))) return null;
  }
  const boundToConversation = (policy?.aclRules ?? []).some(
    (rule) =>
      rule.group?.type === ObjectAccessGroupType.CONVERSATION &&
      rule.group?.id === String(convId),
  );
  if (!boundToConversation) return null;
  return file;
}

async function detectAndPersist(messageId: number, content: string) {
  const result = await translationService.detect(content, String(messageId));
  const now = new Date();
  if (result.ok) {
    await db.update(messagesTable).set({
      detectedLanguage: result.value,
      detectionStatus: "done",
      detectedLanguageAt: now,
      detectionError: null,
    }).where(eq(messagesTable.id, messageId));
    return result.value;
  }
  await db.update(messagesTable).set({
    detectionStatus: "failed",
    detectedLanguageAt: now,
    detectionError: result.error,
  }).where(eq(messagesTable.id, messageId));
  return null;
}

async function cacheTranslation(
  messageId: number,
  content: string,
  targetLanguage: CanonicalLanguageCode,
  sourceLanguage: CanonicalLanguageCode | null,
) {
  if (sourceLanguage === targetLanguage) return { sameLanguage: true as const };
  const [cached] = await db.select().from(translationsTable).where(and(
    eq(translationsTable.messageId, messageId),
    eq(translationsTable.targetLanguage, targetLanguage),
  )).limit(1);
  if (cached?.status === "done") return { row: cached };

  const result = await translationService.translate(content, targetLanguage, sourceLanguage, String(messageId));
  if (!result.ok) {
    const [row] = await db.insert(translationsTable).values({
      messageId, targetLanguage, sourceLanguage, translatedContent: "", status: "failed", error: result.error,
    }).onConflictDoUpdate({
      target: [translationsTable.messageId, translationsTable.targetLanguage],
      set: {
        status: sql`CASE WHEN ${translationsTable.status} = 'done' THEN ${translationsTable.status} ELSE 'failed' END`,
        error: sql`CASE WHEN ${translationsTable.status} = 'done' THEN ${translationsTable.error} ELSE ${result.error} END`,
        updatedAt: new Date(),
      },
    }).returning();
    return { row, error: result.error };
  }
  const row = await persistSuccessfulTranslation(
    messageId,
    targetLanguage,
    sourceLanguage,
    result.value,
  );
  return { row };
}

router.get("/conversations/:conversationId/messages", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const convId = parsePathId(req.params.conversationId, res, "conversation");
  if (convId === null) return;
  if (!(await assertParticipant(convId, user.id, res))) return;
  const access = await getConversationAccessPolicy(db, convId, user.id);

  const limit = Math.min(parseInt(String(req.query.limit ?? "50")), 100);
  const before = req.query.before as string | undefined;

  // `before` is either a legacy ISO timestamp or the stable composite
  // `<ISO timestamp>|<message id>`. The id tiebreaker prevents messages that
  // share a timestamp from being skipped at page boundaries.
  let beforeDate: Date | null = null;
  let beforeId: number | null = null;
  if (before) {
    const [datePart, idPart, extra] = before.split("|");
    const parsed = new Date(datePart);
    const parsedId = idPart === undefined ? null : parsePositiveSafeInteger(idPart);
    if (
      extra !== undefined
      || !/^\d{4}-\d{2}-\d{2}T/.test(datePart)
      || Number.isNaN(parsed.getTime())
      || (idPart !== undefined && parsedId === null)
    ) {
      res.status(400).json({ error: "before must be an ISO date or ISO|messageId cursor" });
      return;
    }
    beforeDate = parsed;
    beforeId = parsedId;
  }

  let msgs;
  if (beforeDate) {
    const cursorCondition = beforeId === null
      ? lt(messagesTable.createdAt, beforeDate)
      : or(
          lt(messagesTable.createdAt, beforeDate),
          and(eq(messagesTable.createdAt, beforeDate), lt(messagesTable.id, beforeId)),
        );
    msgs = await db.select().from(messagesTable)
      .where(and(
        eq(messagesTable.conversationId, convId),
        cursorCondition,
        access.blockedUserIds.size > 0
          ? notInArray(messagesTable.senderId, [...access.blockedUserIds])
          : undefined,
      ))
      .orderBy(desc(messagesTable.createdAt), desc(messagesTable.id)).limit(limit);
  } else {
    msgs = await db.select().from(messagesTable)
      .where(and(
        eq(messagesTable.conversationId, convId),
        access.blockedUserIds.size > 0
          ? notInArray(messagesTable.senderId, [...access.blockedUserIds])
          : undefined,
      ))
      .orderBy(desc(messagesTable.createdAt), desc(messagesTable.id)).limit(limit);
  }

  const msgIds = msgs.map((m) => m.id);
  let translations: any[] = [];
  if (msgIds.length > 0) {
    translations = await db.select().from(translationsTable)
      .where(inArray(translationsTable.messageId, msgIds));
  }

  // Seen/read status: a message I sent is "read" once every OTHER participant's
  // lastReadAt is >= the message createdAt.
  const others = (await db.select().from(conversationParticipantsTable)
    .where(and(
      eq(conversationParticipantsTable.conversationId, convId),
      ne(conversationParticipantsTable.userId, user.id),
    ))).filter((participant) => !access.blockedUserIds.has(participant.userId));
  const minOtherRead = others.length === 0
    ? null
    : others.reduce<Date | null>((acc, p) => {
        if (!p.lastReadAt) return null; // if we already hit null once, stays null
        if (acc === undefined) return p.lastReadAt;
        if (acc === null) return null;
        return p.lastReadAt < acc ? p.lastReadAt : acc;
      }, undefined as any);
  const otherIds = others.map((participant) => participant.userId);
  const otherPreferences = otherIds.length === 0
    ? []
    : await db.select({
        userId: notificationPreferencesTable.userId,
        readReceipts: notificationPreferencesTable.readReceipts,
      }).from(notificationPreferencesTable)
        .where(inArray(notificationPreferencesTable.userId, otherIds));
  const hiddenReadReceiptUserIds = new Set(
    otherPreferences
      .filter((preference) => !preference.readReceipts)
      .map((preference) => preference.userId),
  );
  const allOthersShareReadReceipts = others.every(
    (participant) => !hiddenReadReceiptUserIds.has(participant.userId),
  );

  const result = msgs.reverse().map((msg) => {
    const isMine = msg.senderId === user.id;
    const isRead = isMine
      ? (allOthersShareReadReceipts && minOtherRead != null && new Date(msg.createdAt) <= new Date(minOtherRead))
      : true; // incoming messages are, by definition, read once I fetch them
    return {
      ...msg,
      reactions: ((msg.reactions as any[]) ?? []).filter(
        (reaction) => !access.blockedUserIds.has(reaction.userId),
      ),
      translations: translations.filter((t) => t.messageId === msg.id),
      isRead,
    };
  });

  res.json(result);
});

router.post("/conversations/:conversationId/messages", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const convId = parsePathId(req.params.conversationId, res, "conversation");
  if (convId === null) return;
  if (!(await assertParticipant(convId, user.id, res))) return;

  const { content, contentType = "text", attachmentUrl, idempotencyKey, clientRequestId } = req.body;
  const requestId = clientRequestId ?? idempotencyKey ?? null;
  if (requestId !== null && (typeof requestId !== "string" || requestId.length < 1 || requestId.length > 128)) {
    res.status(400).json({ error: "clientRequestId must be between 1 and 128 characters" });
    return;
  }

  if (requestId) {
    const [existing] = await db.select().from(messagesTable).where(and(
      eq(messagesTable.conversationId, convId),
      eq(messagesTable.senderId, user.id),
      or(
        eq(messagesTable.clientRequestId, requestId),
        eq(messagesTable.idempotencyKey, requestId),
      ),
    )).limit(1);
    if (existing) { res.status(201).json({ ...existing, reactions: (existing.reactions as any[]) ?? [], translations: [], isRead: false }); return; }
  }

  if (!content && !attachmentUrl) {
    res.status(400).json({ error: "content or attachmentUrl required" });
    return;
  }

  // Only allow attachment URLs that point at our own secure object storage path.
  if (attachmentUrl) {
    const ok = /^\/(api\/)?storage\/objects\//.test(attachmentUrl) || attachmentUrl.startsWith("/objects/");
    if (!ok) { res.status(400).json({ error: "attachmentUrl must be a secure object storage path" }); return; }

    // Resolve the object and require both READ access and an ACL conversation
    // rule matching THIS conversation, so a conversation-1 attachment cannot be
    // sent through conversation 2.
    const objectPath = attachmentUrl.replace(/^\/(api\/)?storage/, "");
    try {
      const storage = new ObjectStorageService();
      const resolved = await resolveConversationAttachment(storage, objectPath, user.id, convId);
      if (!resolved) {
        res.status(403).json({ error: "Attachment is not bound to this conversation" });
        return;
      }
    } catch {
      res.status(400).json({ error: "attachmentUrl must be a secure object storage path" });
      return;
    }
  }

  let msg;
  try {
    [msg] = await db.insert(messagesTable).values({
      conversationId: convId,
      senderId: user.id,
      content: content ?? null,
      contentType,
      attachmentUrl: attachmentUrl ?? null,
      idempotencyKey: idempotencyKey ?? null,
      clientRequestId: requestId,
      detectedLanguage: null,
      detectionStatus: content && contentType === "text" ? "pending" : "not_applicable",
      reactions: [],
    }).returning();
  } catch (err: any) {
    // Unique idempotency collision race → return the winning row.
    if (requestId) {
      const [existing] = await db.select().from(messagesTable).where(and(
        eq(messagesTable.conversationId, convId),
        eq(messagesTable.senderId, user.id),
        or(
          eq(messagesTable.clientRequestId, requestId),
          eq(messagesTable.idempotencyKey, requestId),
        ),
      )).limit(1);
      if (existing) { res.status(201).json({ ...existing, reactions: (existing.reactions as any[]) ?? [], translations: [], isRead: false }); return; }
    }
    throw err;
  }

  await db.update(conversationsTable).set({ updatedAt: new Date() }).where(eq(conversationsTable.id, convId));
  res.status(201).json({ ...msg, reactions: [], translations: [], isRead: false });

  // Delivery is complete. Detection, direct-recipient prefill, and
  // notifications are deliberately best-effort post-response work.
  queueMicrotask(() => {
    const notificationWork = (async () => {
      const others = await db.select().from(conversationParticipantsTable)
        .where(and(eq(conversationParticipantsTable.conversationId, convId), ne(conversationParticipantsTable.userId, user.id)));
      for (const p of others) {
        if (p.isMuted) continue;
        const canNotify = await db.transaction(async (tx) => {
          const [low, high] = [user.id, p.userId].sort((a, b) => a - b);
          await tx.execute(sql`select pg_advisory_xact_lock(${low}, ${high})`);
          const blockedRecipients = await getBlockedUserIds(tx, user.id, [p.userId]);
          return !blockedRecipients.has(p.userId);
        });
        if (!canNotify) continue;
        await enqueueNotification({
          userId: p.userId,
          type: "message",
          title: "New message",
          body: content ? content.slice(0, 80) : "Sent an attachment",
          relatedId: convId,
          relatedType: "conversation",
          idempotencyKey: `message:${msg.id}:recipient:${p.userId}`,
        });
      }
    })().catch(() => {
      req.log.warn(
        { messageId: msg.id, conversationId: convId },
        "Post-send notification processing failed",
      );
    });

    const languageWork = (async () => {
      if (!content || contentType !== "text") return;
      const [[conv], others] = await Promise.all([
        db.select().from(conversationsTable)
          .where(eq(conversationsTable.id, convId)).limit(1),
        db.select().from(conversationParticipantsTable)
          .where(and(eq(conversationParticipantsTable.conversationId, convId), ne(conversationParticipantsTable.userId, user.id))),
      ]);
      const sourceLanguage = await detectAndPersist(msg.id, content);
      if (conv?.type !== "direct") return;
      const targets = [...new Set(others
        .filter((p) => p.translationEnabled && isCanonicalLanguage(p.translationLanguage))
        .map((p) => p.translationLanguage as CanonicalLanguageCode))];
      await Promise.all(targets.map((target) =>
        cacheTranslation(msg.id, content, target, sourceLanguage)));
    })().catch(() => {
      req.log.warn(
        { messageId: msg.id, conversationId: convId },
        "Post-send language processing failed",
      );
    });

    // Both promises are created before either is awaited, so notification
    // delivery can never queue behind provider detection/translation latency.
    void Promise.allSettled([notificationWork, languageWork]);
  });
});

router.delete("/conversations/:conversationId/messages/:messageId", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const convId = parsePathId(req.params.conversationId, res, "conversation");
  if (convId === null) return;
  const msgId = parsePathId(req.params.messageId, res, "message");
  if (msgId === null) return;
  if (!(await assertParticipant(convId, user.id, res))) return;
  const [msg] = await db.select().from(messagesTable).where(and(eq(messagesTable.id, msgId), eq(messagesTable.conversationId, convId))).limit(1);
  if (!msg) { res.status(404).json({ error: "Message not found" }); return; }
  const blockedSenders = await getBlockedUserIds(db, user.id, [msg.senderId]);
  if (blockedSenders.has(msg.senderId)) { res.status(404).json({ error: "Message not found" }); return; }
  // Sender may delete their own; group owner/admin may delete any.
  const me = await getParticipant(convId, user.id);
  const canModerate = me?.role === "owner" || me?.role === "admin";
  if (msg.senderId !== user.id && !canModerate) { res.status(403).json({ error: "Not allowed to delete this message" }); return; }
  await db.update(messagesTable).set({ isDeleted: true, content: null, attachmentUrl: null }).where(eq(messagesTable.id, msgId));
  res.json({ message: "Deleted" });
});

async function toggleReaction(req: any, res: any): Promise<void> {
  const user = (req as any).user;
  const convId = parsePathId(req.params.conversationId, res, "conversation");
  if (convId === null) return;
  const msgId = parsePathId(req.params.messageId, res, "message");
  if (msgId === null) return;
  const { emoji } = req.body;
  if (!emoji) { res.status(400).json({ error: "emoji required" }); return; }
  if (!(await assertParticipant(convId, user.id, res))) return;

  const updated = await db.transaction(async (tx) => {
    const [msg] = await tx.select().from(messagesTable)
      .where(and(eq(messagesTable.id, msgId), eq(messagesTable.conversationId, convId)))
      .limit(1).for("update");
    if (!msg) return null;
    const blockedSenders = await getBlockedUserIds(tx, user.id, [msg.senderId]);
    if (blockedSenders.has(msg.senderId)) return "blocked" as const;
    let reactions = (msg.reactions as any[]) ?? [];
    const existing = reactions.find((r) => r.userId === user.id && r.emoji === emoji);
    if (existing) {
      reactions = reactions.filter((r) => !(r.userId === user.id && r.emoji === emoji));
    } else {
      reactions = [...reactions.filter((r) => r.userId !== user.id), { userId: user.id, emoji }];
    }
    const [row] = await tx.update(messagesTable).set({ reactions })
      .where(eq(messagesTable.id, msgId)).returning();
    return row;
  });
  if (updated === "blocked") { res.status(404).json({ error: "Message not found" }); return; }
  if (!updated) { res.status(404).json({ error: "Message not found" }); return; }
  const access = await getConversationAccessPolicy(db, convId, user.id);
  const translations = await db.select().from(translationsTable).where(eq(translationsTable.messageId, msgId));
  res.json({
    ...updated,
    reactions: ((updated.reactions as any[]) ?? []).filter(
      (reaction) => !access.blockedUserIds.has(reaction.userId),
    ),
    translations,
    isRead: true,
  });
}

router.post("/conversations/:conversationId/messages/:messageId/react", requireAuth, toggleReaction);
router.patch("/conversations/:conversationId/messages/:messageId/react", requireAuth, toggleReaction);

router.post("/conversations/:conversationId/messages/preview", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const convId = parsePathId(req.params.conversationId, res, "conversation");
  if (convId === null) return;
  const { content, targetLanguage } = req.body as { content?: unknown; targetLanguage?: unknown };
  if (typeof content !== "string" || !content.trim()) {
    res.status(400).json({ error: "content required" });
    return;
  }
  if (content.length > TRANSLATION_INPUT_MAX) {
    res.status(413).json({ error: `content must not exceed ${TRANSLATION_INPUT_MAX} characters` });
    return;
  }
  if (!isCanonicalLanguage(targetLanguage)) {
    res.status(400).json({ error: "targetLanguage must be a supported canonical language code" });
    return;
  }
  const policy = await getConversationAccessPolicy(db, convId, user.id);
  if (!policy.participant) {
    res.status(403).json({ error: "Not a participant in this conversation" });
    return;
  }
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, convId)).limit(1);
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  if (conv.type === "direct" && policy.blockedUserIds.size > 0) {
    res.status(403).json({ error: "Translation preview is unavailable for this conversation" });
    return;
  }
  const detection = await translationService.detect(content, `preview:${user.id}:${convId}:${content}`);
  const sourceLanguage = detection.ok ? detection.value : null;
  if (sourceLanguage === targetLanguage) {
    res.json({
      originalContent: content,
      translatedContent: null,
      sourceLanguage,
      targetLanguage,
      status: "same_language",
    });
    return;
  }
  const translated = await translationService.translate(
    content, targetLanguage, sourceLanguage, `preview:${user.id}:${convId}:${content}`,
  );
  if (!translated.ok) {
    const statusCode = translated.error === "rate_limited" ? 429
      : translated.error === "input_too_long" ? 413 : 502;
    res.status(statusCode).json({
      originalContent: content,
      translatedContent: null,
      sourceLanguage,
      targetLanguage,
      status: "failed",
      error: translated.error,
    });
    return;
  }
  res.json({
    originalContent: content,
    translatedContent: translated.value,
    sourceLanguage,
    targetLanguage,
    status: "done",
  });
});

router.post("/conversations/:conversationId/messages/:messageId/translate", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const convId = parsePathId(req.params.conversationId, res, "conversation");
  if (convId === null) return;
  const msgId = parsePathId(req.params.messageId, res, "message");
  if (msgId === null) return;
  const { targetLanguage } = req.body;
  if (!isCanonicalLanguage(targetLanguage)) {
    res.status(400).json({ error: "targetLanguage must be a supported canonical language code" });
    return;
  }
  if (!(await assertParticipant(convId, user.id, res))) return;

  const [originalMessage] = await db.select().from(messagesTable).where(eq(messagesTable.id, msgId)).limit(1);
  if (!originalMessage) { res.status(404).json({ error: "Message not found" }); return; }
  if (originalMessage.conversationId !== convId) { res.status(403).json({ error: "Not authorized" }); return; }
  const blockedSenders = await getBlockedUserIds(db, user.id, [originalMessage.senderId]);
  if (blockedSenders.has(originalMessage.senderId)) { res.status(404).json({ error: "Message not found" }); return; }
  if (!originalMessage.content) { res.status(400).json({ error: "Nothing to translate" }); return; }

  // A completed cache row is authoritative.
  const [cached] = await db.select().from(translationsTable)
    .where(and(eq(translationsTable.messageId, msgId), eq(translationsTable.targetLanguage, targetLanguage))).limit(1);
  if (cached && cached.status === "done") {
    res.json({
      ...cached, translatedText: cached.translatedContent,
    });
    return;
  }

  let sourceLanguage = isCanonicalLanguage(originalMessage.detectedLanguage)
    ? originalMessage.detectedLanguage
    : null;
  if (!sourceLanguage && originalMessage.detectionStatus !== "not_applicable") {
    sourceLanguage = await detectAndPersist(msgId, originalMessage.content);
  }
  if (sourceLanguage === targetLanguage) {
    res.json({
      messageId: msgId,
      targetLanguage,
      sourceLanguage,
      translatedContent: null,
      translatedText: null,
      status: "same_language",
    });
    return;
  }
  const result = await cacheTranslation(msgId, originalMessage.content, targetLanguage, sourceLanguage);
  if (!result.row || result.row.status !== "done") {
    const statusCode = result.error === "rate_limited" ? 429
      : result.error === "input_too_long" ? 413 : 502;
    res.status(statusCode).json({
      ...(result.row ?? {}),
      messageId: msgId,
      targetLanguage,
      sourceLanguage,
      translatedContent: null,
      translatedText: null,
      status: "failed",
      error: result.error ?? "provider_error",
    });
    return;
  }
  const row = result.row;
  res.json({
    ...row,
    translatedText: row.translatedContent,
  });
});

router.post("/conversations/:conversationId/messages/upload", requireAuth, async (req, res): Promise<void> => {
  // Attachments are uploaded directly to object storage via presigned URLs
  // (POST /api/storage/uploads/request-url). This endpoint only accepts an
  // already-normalized secure object path and echoes back its serving URL.
  const user = (req as any).user;
  const convId = parsePathId(req.params.conversationId, res, "conversation");
  if (convId === null) return;
  if (!(await assertParticipant(convId, user.id, res))) return;
  const { objectPath, type = "image", uploadToken } = req.body;
  if (!objectPath || typeof objectPath !== "string") { res.status(400).json({ error: "objectPath required" }); return; }
  if (!objectPath.startsWith("/objects/")) { res.status(400).json({ error: "objectPath must be a secure object storage path" }); return; }
  if (!["image", "audio", "voice"].includes(type)) {
    res.status(400).json({ error: "type must be image, audio, or voice" });
    return;
  }
  if (!uploadToken || typeof uploadToken !== "string") {
    res.status(400).json({ error: "uploadToken required" });
    return;
  }

  // The signed upload claim must match this exact user, path, purpose, and
  // conversation. This prevents a leaked token being replayed by a different
  // user or redirected into a different conversation.
  const claim = verifyUploadToken(uploadToken);
  if (
    !claim ||
    claim.purpose !== "attachment" ||
    claim.userId !== Number(user.id) ||
    claim.objectPath !== objectPath ||
    claim.conversationId !== convId
  ) {
    res.status(403).json({ error: "Invalid or mismatched upload token" });
    return;
  }

  try {
    const storage = new ObjectStorageService();
    const objectFile = await storage.getObjectEntityFile(objectPath);

    // Reject any object that already carries an ACL rather than overwriting it.
    // A harmless concurrent same-token race (same owner + same conversation) may
    // surface as a conflict, but it must never grant another user/conversation.
    const existing = await storage.getObjectEntityAclPolicy(objectFile);
    if (existing) {
      res.status(409).json({ error: "Attachment is already registered" });
      return;
    }

    const normalizedPath = await storage.trySetObjectEntityAclPolicy(objectPath, {
      owner: String(user.id),
      visibility: "private",
      aclRules: [
        {
          group: {
            type: ObjectAccessGroupType.CONVERSATION,
            id: String(convId),
          },
          permission: ObjectPermission.READ,
        },
      ],
    });
    res.json({ url: `/api/storage${normalizedPath}`, type });
  } catch (err) {
    req.log.warn(
      { err, userId: user.id, conversationId: convId },
      "Failed to register conversation attachment",
    );
    res.status(400).json({ error: "Uploaded object was not found" });
  }
});

// Transcribe a voice note that was already uploaded to object storage.
// Uses existing OpenAI (speechToText) + object storage infrastructure.
router.post("/conversations/:conversationId/messages/transcribe", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const convId = parsePathId(req.params.conversationId, res, "conversation");
  if (convId === null) return;
  if (!(await assertParticipant(convId, user.id, res))) return;
  const { objectPath } = req.body as { objectPath?: string };
  if (!objectPath || !objectPath.startsWith("/objects/")) {
    res.status(400).json({ error: "objectPath must be a secure object storage path" });
    return;
  }
  try {
    const storage = new ObjectStorageService();
    // Require READ access AND an ACL rule bound to THIS conversation so a
    // conversation-1 voice note cannot be transcribed through conversation 2.
    const file = await resolveConversationAttachment(storage, objectPath, user.id, convId);
    if (!file) {
      res.status(403).json({ error: "Not authorized to access this voice note" });
      return;
    }
    const [buffer] = await file.download();
    const { buffer: compatible, format } = await ensureCompatibleFormat(buffer);
    const transcript = await speechToText(compatible, format);
    res.json({ transcript });
  } catch (err) {
    res.status(502).json({ error: "Transcription unavailable" });
  }
});

export default router;

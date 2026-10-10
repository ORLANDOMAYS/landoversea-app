import { Router, type IRouter } from "express";
import {
  db, usersTable, profilesTable, profilePhotosTable,
  swipesTable, matchesTable, conversationsTable, conversationParticipantsTable,
  notificationsTable, blocksTable,
} from "@workspace/db";
import { eq, and, ne, notInArray, sql, or, desc, inArray, arrayOverlaps } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { expireStaleNativePremium, hasPremiumAccess } from "../lib/revenueCatPremium";
import { parsePositiveSafeInteger } from "../lib/positiveSafeInteger";

const router: IRouter = Router();

export type CanonicalDiscoverGender = "male" | "female" | "non_binary";

/**
 * Discovery preferences are persisted with one vocabulary even when older
 * clients/rows still use the former labels.
 */
export function normalizeDiscoverGender(value: unknown): CanonicalDiscoverGender | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "male" || normalized === "man") return "male";
  if (normalized === "female" || normalized === "woman") return "female";
  if (normalized === "non_binary" || normalized === "nonbinary") return "non_binary";
  return undefined;
}

function genderMatches(column: any, canonical: CanonicalDiscoverGender) {
  const aliases = canonical === "male"
    ? ["male", "man"]
    : canonical === "female"
      ? ["female", "woman"]
      : ["non_binary", "nonbinary"];
  return sql`lower(replace(replace(trim(${column}), '-', '_'), ' ', '_')) in (${sql.join(
    aliases.map((alias) => sql`${alias}`),
    sql`, `,
  )})`;
}

/** Canonical direct-conversation key for an unordered user pair (lower id first). */
function directKeyFor(a: number, b: number): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  return `${x}:${y}`;
}

/**
 * Find-or-create exactly one reusable direct conversation for a user pair.
 * Uses the unique directKey plus onConflict to be concurrency-safe: if two
 * mutual swipes race, only one conversation row survives and both callers
 * resolve to it.
 */
async function ensureDirectConversation(tx: any, userA: number, userB: number, matchId: number | null): Promise<number> {
  const key = directKeyFor(userA, userB);
  const [existing] = await tx.select().from(conversationsTable)
    .where(eq(conversationsTable.directKey, key)).limit(1);
  if (existing) {
    if (matchId && !existing.matchId) {
      await tx.update(conversationsTable).set({ matchId }).where(eq(conversationsTable.id, existing.id));
    }
    // Ensure both participants exist (idempotent).
    await tx.insert(conversationParticipantsTable).values([
      { conversationId: existing.id, userId: userA, role: "member" },
      { conversationId: existing.id, userId: userB, role: "member" },
    ]).onConflictDoNothing();
    return existing.id;
  }

  const [conv] = await tx.insert(conversationsTable).values({
    type: "direct",
    matchId: matchId ?? null,
    directKey: key,
  }).onConflictDoNothing().returning();

  if (!conv) {
    // Lost the race; another tx created it. Re-read.
    const [row] = await tx.select().from(conversationsTable)
      .where(eq(conversationsTable.directKey, key)).limit(1);
    await tx.insert(conversationParticipantsTable).values([
      { conversationId: row.id, userId: userA, role: "member" },
      { conversationId: row.id, userId: userB, role: "member" },
    ]).onConflictDoNothing();
    return row.id;
  }

  await tx.insert(conversationParticipantsTable).values([
    { conversationId: conv.id, userId: userA, role: "member" },
    { conversationId: conv.id, userId: userB, role: "member" },
  ]).onConflictDoNothing();
  return conv.id;
}

/** Serialize a profile row into the canonical DiscoverFilters model. */
function toDiscoverFilters(profile: any) {
  return {
    minAge: profile?.preferredMinAge ?? 18,
    maxAge: profile?.preferredMaxAge ?? 99,
    gender: normalizeDiscoverGender(profile?.preferredGender) ?? null,
    countries: profile?.countriesOfInterest ?? [],
    languages: profile?.learningLanguages ?? [],
    globalMode: profile?.globalDiscovery ?? true,
    relationshipGoal: profile?.preferredRelationshipGoal ?? null,
    interestsOverlap: profile?.preferredInterestsOverlap ?? false,
    verifiedOnly: profile?.preferredVerifiedOnly ?? false,
    longDistance: profile?.preferredLongDistance ?? false,
    relocation: profile?.preferredRelocation ?? false,
  };
}

router.get("/discover/filters", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, user.id)).limit(1);
  res.json(toDiscoverFilters(profile));
});

router.patch("/discover/filters", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const {
    minAge, maxAge, gender, countries, languages, globalMode,
    relationshipGoal, interestsOverlap, verifiedOnly, longDistance, relocation,
  } = req.body;
  const updates: Record<string, any> = {};
  if (minAge !== undefined) updates.preferredMinAge = minAge;
  if (maxAge !== undefined) updates.preferredMaxAge = maxAge;
  if (gender !== undefined) {
    const normalizedGender = normalizeDiscoverGender(gender);
    if (normalizedGender === undefined) {
      res.status(400).json({ error: "gender must be male, female, non_binary, or null" });
      return;
    }
    updates.preferredGender = normalizedGender;
  }
  if (countries !== undefined) updates.countriesOfInterest = countries;
  if (languages !== undefined) updates.learningLanguages = languages;
  if (globalMode !== undefined) updates.globalDiscovery = globalMode;
  if (relationshipGoal !== undefined) updates.preferredRelationshipGoal = relationshipGoal;
  if (interestsOverlap !== undefined) updates.preferredInterestsOverlap = interestsOverlap;
  if (verifiedOnly !== undefined) updates.preferredVerifiedOnly = verifiedOnly;
  if (longDistance !== undefined) updates.preferredLongDistance = longDistance;
  if (relocation !== undefined) updates.preferredRelocation = relocation;
  const insertDefaults = {
    userId: user.id,
    preferredMinAge: 18,
    preferredMaxAge: 99,
    preferredGender: null,
    countriesOfInterest: [],
    learningLanguages: [],
    globalDiscovery: true,
    preferredRelationshipGoal: null,
    preferredInterestsOverlap: false,
    preferredVerifiedOnly: false,
    preferredLongDistance: false,
    preferredRelocation: false,
  };
  const [profile] = Object.keys(updates).length > 0
    ? await db.insert(profilesTable)
        .values({ ...insertDefaults, ...updates })
        .onConflictDoUpdate({
          target: profilesTable.userId,
          // Only caller-supplied discovery fields are updated. Profile identity,
          // content, verification, and other unrelated fields remain untouched.
          set: updates,
        })
        .returning()
    : await db.select().from(profilesTable).where(eq(profilesTable.userId, user.id)).limit(1);
  res.json(toDiscoverFilters(profile));
});

router.get("/discover/cards", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const parsedLimit = Number.parseInt(String(req.query.limit ?? "20"), 10);
  const parsedOffset = Number.parseInt(String(req.query.offset ?? "0"), 10);
  const limit = Number.isSafeInteger(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 50)
    : 20;
  const offset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

  // Per-request filter overrides (fall back to stored profile preferences).
  const q = req.query as Record<string, any>;
  const parseNum = (v: any) => (v === undefined || v === null || v === "" ? undefined : Number(v));
  const parseBool = (v: any) => (v === undefined ? undefined : v === "true" || v === true);
  const parseList = (v: any) =>
    v === undefined || v === null || v === "" ? undefined : String(v).split(",").map((s) => s.trim()).filter(Boolean);

  const [myProfile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, user.id)).limit(1);

  const minAge = parseNum(q.minAge) ?? myProfile?.preferredMinAge ?? 18;
  const maxAge = parseNum(q.maxAge) ?? myProfile?.preferredMaxAge ?? 99;
  const rawWantGender = q.gender !== undefined ? (q.gender || null) : (myProfile?.preferredGender ?? null);
  const wantGender = normalizeDiscoverGender(rawWantGender);
  if (rawWantGender !== null && rawWantGender !== "" && wantGender === undefined) {
    res.status(400).json({ error: "gender must be male, female, non_binary, or empty" });
    return;
  }
  const globalMode = parseBool(q.globalMode) ?? myProfile?.globalDiscovery ?? true;
  const wantCountries = parseList(q.countries) ?? myProfile?.countriesOfInterest ?? [];
  const wantLanguages = parseList(q.languages) ?? myProfile?.learningLanguages ?? [];
  const verifiedOnly = parseBool(q.verifiedOnly) ?? myProfile?.preferredVerifiedOnly ?? false;
  const relationshipGoal =
    q.relationshipGoal !== undefined
      ? (q.relationshipGoal ? String(q.relationshipGoal) : undefined)
      : (myProfile?.preferredRelationshipGoal ?? undefined);
  const longDistanceOnly = parseBool(q.longDistance) ?? myProfile?.preferredLongDistance ?? false;
  const relocationOnly = parseBool(q.relocation) ?? myProfile?.preferredRelocation ?? false;
  const interestsOverlap = parseBool(q.interestsOverlap) ?? myProfile?.preferredInterestsOverlap ?? false;

  // Already-swiped targets.
  const swiped = await db.select({ targetId: swipesTable.targetId }).from(swipesTable).where(eq(swipesTable.swiperId, user.id));
  const swipedIds = swiped.map((s) => s.targetId);

  // Blocks in both directions.
  const myBlocks = await db.select({ blockedId: blocksTable.blockedId }).from(blocksTable).where(eq(blocksTable.blockerId, user.id));
  const blockedByMe = myBlocks.map((b) => b.blockedId);
  const blockedMe = await db.select({ blockerId: blocksTable.blockerId }).from(blocksTable).where(eq(blocksTable.blockedId, user.id));
  const blockedByOtherIds = blockedMe.map((b) => b.blockerId);

  // Users to exclude entirely: restricted / test / internal accounts.
  const excludedUsers = await db.select({ id: usersTable.id }).from(usersTable).where(
    or(eq(usersTable.isRestricted, true), eq(usersTable.isTest, true), eq(usersTable.isInternal, true)),
  );
  const excludedUserIds = excludedUsers.map((u) => u.id);

  const excludeIds = [...new Set([user.id, ...swipedIds, ...blockedByMe, ...blockedByOtherIds, ...excludedUserIds])];

  // Reciprocity: candidate's gender must match what I want, AND their looking-for/
  // preferred gender must include mine (or be open/null).
  const myGender = normalizeDiscoverGender(myProfile?.gender) ?? null;

  const conditions: any[] = [
    excludeIds.length > 0 ? notInArray(profilesTable.userId, excludeIds) : undefined,
    eq(profilesTable.discoveryEnabled, true),
    ne(profilesTable.userId, user.id),
    // Only surface profiles that have at least one photo.
    sql`EXISTS (SELECT 1 FROM profile_photos pp WHERE pp.user_id = ${profilesTable.userId})`,
    sql`${profilesTable.age} IS NOT NULL`,
    sql`${profilesTable.age} >= ${minAge}`,
    sql`${profilesTable.age} <= ${maxAge}`,
    wantGender ? genderMatches(profilesTable.gender, wantGender) : undefined,
    // Reciprocal gender preference: candidate wants my gender or is open.
    myGender
      ? or(
          sql`${profilesTable.preferredGender} IS NULL`,
          genderMatches(profilesTable.preferredGender, myGender),
          genderMatches(profilesTable.lookingFor, myGender),
          sql`${profilesTable.lookingFor} IS NULL`,
        )
      : undefined,
    // Reciprocal age: my age within candidate's preferred range (if I have an age).
    myProfile?.age != null ? sql`${profilesTable.preferredMinAge} <= ${myProfile.age}` : undefined,
    myProfile?.age != null ? sql`${profilesTable.preferredMaxAge} >= ${myProfile.age}` : undefined,
    // Countries (only when not in global mode and countries specified).
    !globalMode && wantCountries.length > 0 ? inArray(profilesTable.country, wantCountries) : undefined,
    // Languages: candidate speaks one of the desired languages.
    wantLanguages.length > 0
      ? or(
          inArray(profilesTable.primaryLanguage, wantLanguages),
          arrayOverlaps(profilesTable.otherLanguages, wantLanguages),
        )
      : undefined,
    relationshipGoal ? eq(profilesTable.relationshipGoal, relationshipGoal) : undefined,
    longDistanceOnly ? eq(profilesTable.longDistanceOpenness, true) : undefined,
    relocationOnly ? eq(profilesTable.relocationOpenness, true) : undefined,
    verifiedOnly ? eq(profilesTable.isVerified, true) : undefined,
    interestsOverlap && (myProfile?.interests?.length ?? 0) > 0
      ? arrayOverlaps(profilesTable.interests, myProfile!.interests)
      : undefined,
  ];

  // Stable newest-first ordering keeps fresh profiles discoverable as the
  // marketplace grows instead of burying them behind every historical row.
  const candidates = await db.select().from(profilesTable)
    .where(and(...conditions.filter(Boolean)))
    .orderBy(desc(profilesTable.userId))
    .limit(limit)
    .offset(offset);

  const cards = await Promise.all(
    candidates.map(async (profile) => {
      const photos = await db.select().from(profilePhotosTable).where(eq(profilePhotosTable.userId, profile.userId));
      photos.sort((a, b) => a.position - b.position);
      const sharedInterests = (myProfile?.interests ?? []).filter((i) => profile.interests.includes(i));
      const sharedLanguages = [
        ...(myProfile?.otherLanguages ?? []),
        myProfile?.primaryLanguage,
      ].filter(Boolean).filter((l) => [
        ...profile.otherLanguages,
        profile.primaryLanguage,
      ].includes(l));
      return {
        userId: profile.userId,
        profile: { ...profile, photos, isVerified: profile.isVerified },
        distanceKm: null,
        sharedInterests,
        sharedLanguages: [...new Set(sharedLanguages)],
      };
    })
  );

  res.json(cards);
});

router.post("/discover/swipe", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const { targetUserId, action, idempotencyKey } = req.body;
  if (!targetUserId || !action) {
    res.status(400).json({ error: "targetUserId and action required" });
    return;
  }
  if (!["like", "pass", "superlike"].includes(action)) {
    res.status(400).json({ error: "action must be like, pass, or superlike" });
    return;
  }
  if (targetUserId === user.id) {
    res.status(400).json({ error: "Cannot swipe on yourself" });
    return;
  }

  const targetId = parsePositiveSafeInteger(
    typeof targetUserId === "number" ? String(targetUserId) : targetUserId,
  );
  if (targetId === null) {
    res.status(400).json({ error: "targetUserId must be a valid user id" });
    return;
  }
  if (targetId === user.id) {
    res.status(400).json({ error: "Cannot swipe on yourself" });
    return;
  }

  const [target] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.id, targetId)).limit(1);
  if (!target) {
    res.status(404).json({ error: "Target user not found" });
    return;
  }
  const [block] = await db.select({ id: blocksTable.id }).from(blocksTable).where(or(
    and(eq(blocksTable.blockerId, user.id), eq(blocksTable.blockedId, targetId)),
    and(eq(blocksTable.blockerId, targetId), eq(blocksTable.blockedId, user.id)),
  )).limit(1);
  if (block) {
    res.status(403).json({ error: "Cannot swipe on a blocked user" });
    return;
  }

  // Idempotency is scoped to this authenticated swiper and exact operation.
  if (idempotencyKey) {
    const [existing] = await db.select().from(swipesTable).where(and(
      eq(swipesTable.swiperId, user.id),
      eq(swipesTable.targetId, targetId),
      eq(swipesTable.action, action),
      eq(swipesTable.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existing) {
      const match = await db.select().from(matchesTable).where(
        or(
          and(eq(matchesTable.userId1, user.id), eq(matchesTable.userId2, targetId)),
          and(eq(matchesTable.userId1, targetId), eq(matchesTable.userId2, user.id)),
        ),
      ).limit(1);
      res.json({ action: existing.action, isMatch: match.length > 0, match: match[0] ?? undefined, conversationId: match[0]?.conversationId ?? null });
      return;
    }
  }

  let isMatch = false;
  let matchRecord: any = null;
  let conversationId: number | null = null;
  let alreadySwiped = false;
  let firstLike = false;

  await db.transaction(async (tx) => {
    const [uid1, uid2] = [user.id, targetId].sort((a, b) => a - b);
    // Serialize swipe and block mutations for this pair. Without this lock, two
    // first-time mutual likes can each miss the other's uncommitted insert.
    await tx.execute(sql`select pg_advisory_xact_lock(${uid1}, ${uid2})`);
    const [transactionTarget] = await tx.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.id, targetId)).limit(1).for("key share");
    if (!transactionTarget) {
      (req as any)._missingTargetDuringSwipe = true;
      return;
    }
    const [blocked] = await tx.select({ id: blocksTable.id }).from(blocksTable).where(or(
      and(eq(blocksTable.blockerId, user.id), eq(blocksTable.blockedId, targetId)),
      and(eq(blocksTable.blockerId, targetId), eq(blocksTable.blockedId, user.id)),
    )).limit(1);
    if (blocked) {
      alreadySwiped = true;
      (req as any)._blockedDuringSwipe = true;
      return;
    }
    // Record the swipe atomically; unique (swiper, target) prevents mutual downgrade races.
    const inserted = await tx.insert(swipesTable).values({
      swiperId: user.id,
      targetId,
      action,
      idempotencyKey: idempotencyKey ?? null,
    }).onConflictDoNothing().returning();

    if (inserted.length === 0) {
      alreadySwiped = true;
      const [ex] = await tx.select().from(swipesTable)
        .where(and(eq(swipesTable.swiperId, user.id), eq(swipesTable.targetId, targetId))).limit(1);
      // No downgrade: keep existing action. Still check for an existing match below.
      const match = await tx.select().from(matchesTable).where(
        or(
          and(eq(matchesTable.userId1, user.id), eq(matchesTable.userId2, targetId)),
          and(eq(matchesTable.userId1, targetId), eq(matchesTable.userId2, user.id)),
        ),
      ).limit(1);
      if (match[0]) { isMatch = true; matchRecord = match[0]; conversationId = match[0].conversationId ?? null; }
      matchRecord = matchRecord ?? null;
      (req as any)._existingAction = ex?.action ?? action;
      return;
    }
    firstLike = true;

    if (action !== "like" && action !== "superlike") return;

    // Mutual match check within the same transaction.
    const [reverseSwipe] = await tx.select().from(swipesTable)
      .where(and(
        eq(swipesTable.swiperId, targetId),
        eq(swipesTable.targetId, user.id),
        or(eq(swipesTable.action, "like"), eq(swipesTable.action, "superlike")),
      )).limit(1);

    if (!reverseSwipe) return;

    const [match] = await tx.insert(matchesTable).values({ userId1: uid1, userId2: uid2 })
      .onConflictDoNothing().returning();

    let effectiveMatch = match;
    if (!effectiveMatch) {
      // Concurrent mutual match: read the surviving row.
      const [row] = await tx.select().from(matchesTable)
        .where(and(eq(matchesTable.userId1, uid1), eq(matchesTable.userId2, uid2))).limit(1);
      effectiveMatch = row;
    }

    isMatch = true;
    matchRecord = effectiveMatch;

    conversationId = await ensureDirectConversation(tx, user.id, targetId, effectiveMatch.id);
    if (!effectiveMatch.conversationId) {
      await tx.update(matchesTable).set({ conversationId }).where(eq(matchesTable.id, effectiveMatch.id));
      matchRecord = { ...effectiveMatch, conversationId };
    } else {
      conversationId = effectiveMatch.conversationId;
    }
  });

  if ((req as any)._missingTargetDuringSwipe) {
    res.status(404).json({ error: "Target user not found" });
    return;
  }
  if ((req as any)._blockedDuringSwipe) {
    res.status(403).json({ error: "Cannot swipe on a blocked user" });
    return;
  }

  // Side-effect notifications outside the critical transaction.
  if (firstLike && (action === "like" || action === "superlike")) {
    await db.insert(notificationsTable).values({
      userId: targetId,
      type: action === "superlike" ? "superlike" : "like",
      title: action === "superlike" ? "You received a superlike!" : "Someone liked you!",
      body: "Check your matches to see who.",
      relatedId: user.id,
      idempotencyKey: action + "-" + user.id + "-" + targetId,
    }).onConflictDoNothing();
  }

  if (isMatch && matchRecord && firstLike) {
    await db.insert(notificationsTable).values([
      { userId: user.id, type: "match", title: "New Match!", body: "You have a new match!", relatedId: matchRecord.id, relatedType: "match" },
      { userId: targetId, type: "match", title: "New Match!", body: "You have a new match!", relatedId: matchRecord.id, relatedType: "match" },
    ]).onConflictDoNothing();
  }

  const returnedAction = alreadySwiped ? ((req as any)._existingAction ?? action) : action;
  res.json({
    action: returnedAction,
    isMatch,
    match: matchRecord ? {
      id: matchRecord.id,
      userId1: matchRecord.userId1,
      userId2: matchRecord.userId2,
      conversationId,
      createdAt: matchRecord.createdAt,
    } : undefined,
    conversationId,
  });
});

router.get("/premium/who-liked-me", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  await expireStaleNativePremium(user.id);
  if (!(await hasPremiumAccess(user.id))) {
    res.status(403).json({ error: "Premium required to see who liked you", premiumRequired: true });
    return;
  }
  const likedMe = await db.select({ swiperId: swipesTable.swiperId })
    .from(swipesTable)
    .where(and(eq(swipesTable.targetId, user.id), or(eq(swipesTable.action, "like"), eq(swipesTable.action, "superlike"))));
  const likerIds = likedMe.map((s) => s.swiperId);
  if (likerIds.length === 0) { res.json([]); return; }
  const profiles = await db.select().from(profilesTable).where(sql`${profilesTable.userId} = ANY(${likerIds})`);
  const cards = await Promise.all(profiles.map(async (profile) => {
    const photos = await db.select().from(profilePhotosTable).where(eq(profilePhotosTable.userId, profile.userId));
    return { userId: profile.userId, profile: { ...profile, photos }, distanceKm: null };
  }));
  res.json(cards);
});

export { ensureDirectConversation, directKeyFor };
export default router;

import { Router, type IRouter } from "express";
import {
  db, culturalStampsTable, culturalFactsTable, culturalEventsTable,
  eventRsvpsTable, tribesTable, tribeMembershipsTable, conversationStartersTable,
  leaderboardScoresTable, profilesTable,
} from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { parsePositiveSafeInteger } from "../lib/positiveSafeInteger";

const router: IRouter = Router();

router.get("/cultural/passport", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const stamps = await db.select().from(culturalStampsTable).where(eq(culturalStampsTable.userId, user.id));
  const countries = [...new Set(stamps.map((s) => s.country))];
  const xp = stamps.length * 100;
  let level = "Explorer";
  if (stamps.length >= 20) level = "Global Ambassador";
  else if (stamps.length >= 10) level = "World Citizen";
  else if (stamps.length >= 5) level = "Traveler";
  res.json({
    userId: user.id,
    stampCount: stamps.length,
    countriesVisited: countries,
    level,
    xpPoints: xp,
    stamps,
  });
});

router.get("/cultural/stamps", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const stamps = await db.select().from(culturalStampsTable).where(eq(culturalStampsTable.userId, user.id));
  res.json(stamps);
});

router.get("/cultural/facts", requireAuth, async (req, res): Promise<void> => {
  const { country } = req.query as Record<string, string>;
  // Only approved facts are surfaced; pending community submissions await review.
  const facts = country
    ? await db.select().from(culturalFactsTable).where(and(eq(culturalFactsTable.country, country), eq(culturalFactsTable.status, "approved"))).limit(5)
    : await db.select().from(culturalFactsTable).where(eq(culturalFactsTable.status, "approved")).limit(5);

  if (facts.length === 0) {
    // Seeded defaults
    res.json([
      { id: 1, country: "Japan", fact: "Japan has more than 6,800 islands, though most people live on the four main ones.", category: "geography", createdAt: new Date() },
      { id: 2, country: "Brazil", fact: "Brazil is the only Portuguese-speaking country in South America.", category: "language", createdAt: new Date() },
      { id: 3, country: "South Korea", fact: "South Korea has one of the world's fastest internet speeds.", category: "technology", createdAt: new Date() },
      { id: 4, country: "France", fact: "France is the most visited country in the world, attracting about 90 million tourists a year.", category: "travel", createdAt: new Date() },
      { id: 5, country: "Mexico", fact: "Chocolate, tomatoes, and avocados all originate from Mexico.", category: "food", createdAt: new Date() },
    ]);
    return;
  }
  res.json(facts);
});

router.get("/cultural/events", requireAuth, async (req, res): Promise<void> => {
  const { country } = req.query as Record<string, string>;
  const events = country
    ? await db.select().from(culturalEventsTable).where(and(eq(culturalEventsTable.country, country), sql`${culturalEventsTable.date} > NOW()`)).orderBy(culturalEventsTable.date).limit(20)
    : await db.select().from(culturalEventsTable).where(sql`${culturalEventsTable.date} > NOW()`).orderBy(culturalEventsTable.date).limit(20);

  const user = (req as any).user;
  const myRsvps = await db.select().from(eventRsvpsTable).where(eq(eventRsvpsTable.userId, user.id));
  const rsvpEventIds = new Set(myRsvps.map((r) => r.eventId));

  res.json(events.map((e) => ({ ...e, hasRsvp: rsvpEventIds.has(e.id), isRsvped: rsvpEventIds.has(e.id) })));
});

router.post("/cultural/events/:eventId/rsvp", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const eventId = parsePositiveSafeInteger(Array.isArray(req.params.eventId) ? req.params.eventId[0] : req.params.eventId);
  if (eventId === null) { res.status(400).json({ error: "Invalid event id" }); return; }

  // Verify the event exists first
  const [event] = await db.select().from(culturalEventsTable).where(eq(culturalEventsTable.id, eventId)).limit(1);
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  // Insert RSVP (ignore conflict if already RSVPd)
  await db.insert(eventRsvpsTable).values({ eventId, userId: user.id }).onConflictDoNothing();

  // Insert a cultural stamp for attending this event
  await db.insert(culturalStampsTable).values({
    userId: user.id,
    country: event.country,
    title: `Event: ${event.title}`,
  }).onConflictDoNothing();

  res.json({ ...event, hasRsvp: true, isRsvped: true });
});

router.delete("/cultural/events/:eventId/rsvp", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const eventId = parsePositiveSafeInteger(Array.isArray(req.params.eventId) ? req.params.eventId[0] : req.params.eventId);
  if (eventId === null) { res.status(400).json({ error: "Invalid event id" }); return; }

  const [event] = await db.select().from(culturalEventsTable).where(eq(culturalEventsTable.id, eventId)).limit(1);
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  // Deleting an absent RSVP is intentionally successful so retries are safe.
  await db.delete(eventRsvpsTable).where(
    and(eq(eventRsvpsTable.eventId, eventId), eq(eventRsvpsTable.userId, user.id))
  );

  res.json({ ...event, hasRsvp: false, isRsvped: false });
});

router.get("/cultural/tribes", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const tribes = await db.select().from(tribesTable).limit(20);
  const myMemberships = await db.select().from(tribeMembershipsTable).where(eq(tribeMembershipsTable.userId, user.id));
  const myTribeIds = new Set(myMemberships.map((m) => m.tribeId));
  res.json(tribes.map((t) => ({ ...t, isMember: myTribeIds.has(t.id) })));
});

router.post("/cultural/tribes/:tribeId/join", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const tribeId = parsePositiveSafeInteger(Array.isArray(req.params.tribeId) ? req.params.tribeId[0] : req.params.tribeId);
  if (tribeId === null) { res.status(400).json({ error: "Invalid tribe id" }); return; }

  const [tribe] = await db.select().from(tribesTable).where(eq(tribesTable.id, tribeId)).limit(1);
  if (!tribe) {
    res.status(404).json({ error: "Tribe not found" });
    return;
  }

  // Check if already a member
  const [existingMembership] = await db
    .select()
    .from(tribeMembershipsTable)
    .where(and(eq(tribeMembershipsTable.tribeId, tribeId), eq(tribeMembershipsTable.userId, user.id)))
    .limit(1);

  if (existingMembership) {
    res.json({ ...tribe, message: "Already a member", isMember: true });
    return;
  }

  // Insert membership
  await db.insert(tribeMembershipsTable).values({ tribeId, userId: user.id });

  // Increment memberCount
  await db.update(tribesTable)
    .set({ memberCount: tribe.memberCount + 1 })
    .where(eq(tribesTable.id, tribeId));

  // If tribe has a country, insert a stamp
  if (tribe.country) {
    await db.insert(culturalStampsTable).values({
      userId: user.id,
      country: tribe.country,
      title: `Tribe: ${tribe.name}`,
    }).onConflictDoNothing();
  }

  res.json({ ...tribe, memberCount: tribe.memberCount + 1, isMember: true });
});

router.delete("/cultural/tribes/:tribeId/leave", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const tribeId = parsePositiveSafeInteger(Array.isArray(req.params.tribeId) ? req.params.tribeId[0] : req.params.tribeId);
  if (tribeId === null) { res.status(400).json({ error: "Invalid tribe id" }); return; }

  // Check if membership exists
  const [existingMembership] = await db
    .select()
    .from(tribeMembershipsTable)
    .where(and(eq(tribeMembershipsTable.tribeId, tribeId), eq(tribeMembershipsTable.userId, user.id)))
    .limit(1);

  if (!existingMembership) {
    res.json({ message: "Not a member" });
    return;
  }

  // Delete membership
  await db.delete(tribeMembershipsTable).where(
    and(eq(tribeMembershipsTable.tribeId, tribeId), eq(tribeMembershipsTable.userId, user.id))
  );

  // Decrement memberCount (minimum 0)
  const [tribe] = await db.select().from(tribesTable).where(eq(tribesTable.id, tribeId)).limit(1);
  if (tribe) {
    const newCount = Math.max(0, tribe.memberCount - 1);
    await db.update(tribesTable).set({ memberCount: newCount }).where(eq(tribesTable.id, tribeId));
  }

  res.json({ message: "Left tribe" });
});

router.get("/cultural/conversation-starters", requireAuth, async (req, res): Promise<void> => {
  const { country, category } = req.query as Record<string, string>;
  let starters = await db.select().from(conversationStartersTable)
    .where(country ? eq(conversationStartersTable.country, country) : undefined)
    .limit(10);

  if (starters.length === 0) {
    res.json([
      { id: 1, text: "What's a tradition from your country that you wish more people knew about?", country: null, category: "culture" },
      { id: 2, text: "What language are you most excited to learn and why?", country: null, category: "language" },
      { id: 3, text: "If you could live in any country for a year, where would you go and what would you do?", country: null, category: "travel" },
      { id: 4, text: "What's a food from your culture that you think everyone should try?", country: null, category: "food" },
      { id: 5, text: "What's the biggest cultural difference you've experienced when meeting someone from another country?", country: null, category: "culture" },
    ]);
    return;
  }
  res.json(starters);
});

// Community culture-fact submission — enters the moderation queue as pending.
router.post("/cultural/facts", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const { country, fact, category } = req.body as Record<string, string>;
  if (!country || typeof country !== "string" || !fact || typeof fact !== "string" || fact.trim().length < 10) {
    res.status(400).json({ error: "country and a fact of at least 10 characters are required" });
    return;
  }
  const [created] = await db.insert(culturalFactsTable).values({
    country: country.trim(),
    fact: fact.trim(),
    category: category ?? null,
    status: "pending",
    submittedBy: user.id,
  }).onConflictDoNothing().returning();
  if (!created) {
    res.status(409).json({ error: "This fact has already been submitted" });
    return;
  }
  res.status(201).json({ ...created, message: "Submitted for review" });
});

// Real persisted leaderboard. Scores are recomputed from the viewer's passport
// stamps and engagement, upserted, then the top ranks are returned from the DB.
router.get("/cultural/leaderboard", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;

  const [{ stampCount }] = await db.select({ stampCount: sql<number>`count(*)::int` })
    .from(culturalStampsTable).where(eq(culturalStampsTable.userId, user.id));
  const [{ tribeCount }] = await db.select({ tribeCount: sql<number>`count(*)::int` })
    .from(tribeMembershipsTable).where(eq(tribeMembershipsTable.userId, user.id));
  const [{ rsvpCount }] = await db.select({ rsvpCount: sql<number>`count(*)::int` })
    .from(eventRsvpsTable).where(eq(eventRsvpsTable.userId, user.id));

  const passportScore = stampCount;
  const engagementScore = tribeCount * 25 + rsvpCount * 15;
  const totalScore = passportScore * 100 + engagementScore;

  await db.insert(leaderboardScoresTable)
    .values({ userId: user.id, passportScore, engagementScore, totalScore })
    .onConflictDoUpdate({
      target: leaderboardScoresTable.userId,
      set: { passportScore, engagementScore, totalScore, updatedAt: new Date() },
    });

  const rows = await db.select().from(leaderboardScoresTable)
    .orderBy(desc(leaderboardScoresTable.totalScore)).limit(50);
  const withProfiles = await Promise.all(rows.map(async (row, index) => {
    const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, row.userId)).limit(1);
    return {
      rank: index + 1,
      userId: row.userId,
      name: profile?.name ?? "Explorer",
      country: profile?.country ?? null,
      passportScore: row.passportScore,
      engagementScore: row.engagementScore,
      totalScore: row.totalScore,
      isCurrentUser: row.userId === user.id,
    };
  }));
  res.json(withProfiles);
});

export default router;

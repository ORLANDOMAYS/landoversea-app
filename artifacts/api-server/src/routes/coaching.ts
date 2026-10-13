import { Router, type IRouter } from "express";
import {
  db, coachesTable, bookingsTable, reviewsTable,
  clientSubscriptionsTable, coachingPlansTable, groupWorkshopsTable,
  workshopEnrollmentsTable, workshopConversationsTable, coachCredentialsTable,
  profilesTable, profilePhotosTable, usersTable, externalIdentitiesTable,
  coachAuditEventsTable,
} from "@workspace/db";
import { eq, and, or, desc, sql, avg, gt } from "drizzle-orm";
import { getSupabaseRequestAuth, requireAuth } from "../lib/auth";
import { fetchVisibleSupabaseCoach, parseCoachIdentifier } from "../lib/coach-id-bridge";
import { SupabaseAuthError } from "../lib/supabase-auth";
import { enqueueBookingNotification, processDeliveries } from "../lib/notificationDispatch";
import { ensureCoachTransferForCompletedBooking, attemptCoachTransfer } from "./payments";
import { ObjectStorageService } from "../lib/objectStorage";
import { verifyUploadToken } from "../lib/uploadToken";
import { parsePositiveSafeInteger } from "../lib/positiveSafeInteger";
import { getPublicAppUrl } from "../lib/publicAppUrl";

const router: IRouter = Router();

type RecurringAvailabilitySlot = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timeZone: string;
};

function timeToMinutes(value: unknown): number | null {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function isValidAvailabilitySlot(slot: unknown): slot is RecurringAvailabilitySlot {
  if (!slot || typeof slot !== "object") return false;
  const value = slot as Partial<RecurringAvailabilitySlot>;
  const start = timeToMinutes(value.startTime);
  const end = timeToMinutes(value.endTime);
  return Number.isInteger(value.dayOfWeek)
    && value.dayOfWeek! >= 0
    && value.dayOfWeek! <= 6
    && start !== null
    && end !== null
    && start < end
    && isValidTimeZone(value.timeZone);
}

function normalizeAvailabilityInput(input: unknown): RecurringAvailabilitySlot[] | null {
  if (!input || typeof input !== "object") return null;
  const { slots, timeZone } = input as { slots?: unknown; timeZone?: unknown };
  if (!Array.isArray(slots) || slots.length === 0 || !isValidTimeZone(timeZone)) return null;
  if (slots.some((slot) =>
    !slot
    || typeof slot !== "object"
    || !isValidAvailabilitySlot({ ...(slot as Record<string, unknown>), timeZone })
  )) return null;
  return slots.map((slot) => ({
    ...(slot as Omit<RecurringAvailabilitySlot, "timeZone">),
    timeZone,
  }));
}

function getZonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function zonedDateTimeToUtc(dateString: string, time: string, timeZone: string): Date | null {
  const dateParts = dateString.split("-").map(Number);
  const timeMinutes = timeToMinutes(time);
  if (dateParts.length !== 3 || dateParts.some(Number.isNaN) || timeMinutes === null) return null;
  const [year, month, day] = dateParts;
  const hour = Math.floor(timeMinutes / 60);
  const minute = timeMinutes % 60;
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let instant = targetAsUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = getZonedParts(new Date(instant), timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    const correction = targetAsUtc - actualAsUtc;
    instant += correction;
    if (correction === 0) break;
  }

  const result = new Date(instant);
  const verified = getZonedParts(result, timeZone);
  if (
    verified.year !== year
    || verified.month !== month
    || verified.day !== day
    || verified.hour !== hour
    || verified.minute !== minute
  ) return null;
  return result;
}

function addCalendarDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateStringDayOfWeek(dateString: string): number {
  return new Date(`${dateString}T12:00:00.000Z`).getUTCDay();
}

function intervalFitsAvailability(
  startAt: Date,
  endAt: Date,
  slot: RecurringAvailabilitySlot,
): boolean {
  const start = getZonedParts(startAt, slot.timeZone);
  const end = getZonedParts(endAt, slot.timeZone);
  const startDate = `${start.year}-${String(start.month).padStart(2, "0")}-${String(start.day).padStart(2, "0")}`;
  const endDate = `${end.year}-${String(end.month).padStart(2, "0")}-${String(end.day).padStart(2, "0")}`;
  if (startDate !== endDate || slot.dayOfWeek !== dateStringDayOfWeek(startDate)) return false;
  const intervalStart = start.hour * 60 + start.minute;
  const intervalEnd = end.hour * 60 + end.minute;
  return timeToMinutes(slot.startTime)! <= intervalStart
    && intervalEnd <= timeToMinutes(slot.endTime)!;
}

// Only approved coaches are publicly visible or bookable.
function isApprovedCoach(coach: { isVerified: boolean; verificationStatus: string }): boolean {
  return coach.isVerified && coach.verificationStatus === "approved";
}

function buildCoachCard(coach: any) {
  return {
    id: coach.id,
    userId: coach.userId,
    displayName: coach.displayName,
    bio: coach.bio ?? null,
    photoUrl: coach.photoUrl ?? null,
    specialties: coach.specialties,
    languages: coach.languages,
    sessionLengthsMinutes: coach.sessionLengthsMinutes,
    ratesPerHour: coach.ratesPerHour ?? null,
    pricingTiers: coach.pricingTiers ?? [],
    currency: coach.currency,
    rating: coach.rating ?? null,
    reviewCount: coach.reviewCount,
    isVerified: coach.isVerified,
    verificationStatus: coach.verificationStatus,
    isPayoutReady: coach.isPayoutReady,
    payoutStatus: coach.payoutStatus,
    createdAt: coach.createdAt,
  };
}

type CoachIdentifierResolution =
  | { kind: "resolved"; coachId: number }
  | { kind: "error"; status: number; body: { error: string; code: string } };

function coachIdentifierValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  return null;
}

function strictLocalCoachId(value: unknown): number | null {
  const rawIdentifier = coachIdentifierValue(value);
  const identifier = rawIdentifier ? parseCoachIdentifier(rawIdentifier) : null;
  return identifier?.kind === "local" ? identifier.id : null;
}

async function resolveCoachIdentifierForRequest(
  req: Parameters<typeof getSupabaseRequestAuth>[0],
  value: unknown,
): Promise<CoachIdentifierResolution> {
  const rawIdentifier = coachIdentifierValue(value);
  const identifier = rawIdentifier ? parseCoachIdentifier(rawIdentifier) : null;
  if (!identifier) {
    return {
      kind: "error",
      status: 400,
      body: { error: "Invalid coach identifier", code: "invalid_coach_id" },
    };
  }
  if (identifier.kind === "local") {
    return { kind: "resolved", coachId: identifier.id };
  }

  const auth = getSupabaseRequestAuth(req);
  if (!auth) {
    return {
      kind: "error",
      status: 409,
      body: {
        error: "This coach cannot be linked for booking with the current sign-in.",
        code: "coach_not_linked",
      },
    };
  }

  try {
    const supabaseCoach = await fetchVisibleSupabaseCoach(
      identifier.id,
      auth.accessToken,
    );
    if (!supabaseCoach) {
      return {
        kind: "error",
        status: 404,
        body: { error: "Coach not found", code: "coach_not_found" },
      };
    }
    if (!supabaseCoach.ownerId) {
      return {
        kind: "error",
        status: 409,
        body: {
          error: "This coach does not yet have a linked booking profile.",
          code: "coach_not_linked",
        },
      };
    }

    const [linked] = await db
      .select({ coachId: coachesTable.id })
      .from(externalIdentitiesTable)
      .innerJoin(usersTable, eq(externalIdentitiesTable.userId, usersTable.id))
      .innerJoin(coachesTable, eq(coachesTable.userId, usersTable.id))
      .where(and(
        eq(externalIdentitiesTable.provider, "supabase"),
        eq(externalIdentitiesTable.subject, supabaseCoach.ownerId),
        eq(coachesTable.isVerified, true),
        eq(coachesTable.verificationStatus, "approved"),
      ))
      .limit(1);
    if (!linked) {
      return {
        kind: "error",
        status: 409,
        body: {
          error: "This coach does not yet have a linked booking profile.",
          code: "coach_not_linked",
        },
      };
    }
    return { kind: "resolved", coachId: linked.coachId };
  } catch (error: unknown) {
    if (error instanceof SupabaseAuthError) {
      return {
        kind: "error",
        status: error.status,
        body: { error: error.message, code: error.code },
      };
    }
    throw error;
  }
}

const MAX_CREDENTIAL_BYTES = 10 * 1024 * 1024;
const CREDENTIAL_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
const CREDENTIAL_KINDS = ["certification", "id_document", "background_check", "resume"] as const;

export function credentialMagicMatches(contentType: string, bytes: Buffer): boolean {
  if (contentType === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (contentType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/png") {
    return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  return false;
}

function safeCredential(credential: typeof coachCredentialsTable.$inferSelect) {
  const { objectPath: _privatePath, ...metadata } = credential;
  return metadata;
}

// Booking lifecycle state machine. Terminal states cannot transition, and a
// booking whose session has already ended can never be cancelled after the fact.
const BOOKING_TRANSITIONS: Record<string, string[]> = {
  pending: ["confirmed", "cancelled", "no_show"],
  confirmed: ["completed", "cancelled", "no_show"],
  completed: [],
  cancelled: [],
  no_show: [],
};

function canTransition(from: string, to: string): boolean {
  return (BOOKING_TRANSITIONS[from] ?? []).includes(to);
}

type CancellationBlockReason = "invalid_state" | "past";

function cancellationBlockReason(
  booking: Pick<typeof bookingsTable.$inferSelect, "status" | "scheduledAt">,
  now = new Date(),
): CancellationBlockReason | null {
  if (!canTransition(booking.status, "cancelled")) return "invalid_state";
  if (booking.scheduledAt.getTime() <= now.getTime()) return "past";
  return null;
}

// --- Public coach discovery ---
router.get("/coaches", requireAuth, async (req, res): Promise<void> => {
  const { specialty, language, limit: lim = "20", offset: off = "0" } = req.query as Record<string, string>;
  const coaches = await db.select().from(coachesTable)
    .where(and(eq(coachesTable.isVerified, true), eq(coachesTable.verificationStatus, "approved")))
    .limit(parseInt(lim)).offset(parseInt(off));
  const filtered = coaches.filter((c) => {
    if (specialty && !c.specialties.includes(specialty)) return false;
    if (language && !c.languages.includes(language)) return false;
    return true;
  });
  res.json(filtered.map(buildCoachCard));
});

// Keep this static route before /coaches/:coachId so "me" is never parsed as
// a numeric coach id.
router.get("/coaches/me", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.userId, user.id)).limit(1);
  if (!coach) { res.status(404).json({ error: "Coach profile not found" }); return; }
  res.json(buildCoachCard(coach));
});

// This resolver must remain before the identifier route. It is the only
// supported bridge between live Supabase UUIDs and local booking IDs.
router.get("/coaches/resolve/:coachIdentifier", requireAuth, async (req, res): Promise<void> => {
  const rawIdentifier = Array.isArray(req.params.coachIdentifier)
    ? req.params.coachIdentifier[0]
    : req.params.coachIdentifier;
  const resolution = await resolveCoachIdentifierForRequest(req, rawIdentifier);
  if (resolution.kind === "error") {
    res.status(resolution.status).json(resolution.body);
    return;
  }

  const [coach] = await db.select({ id: coachesTable.id }).from(coachesTable)
    .where(and(
      eq(coachesTable.id, resolution.coachId),
      eq(coachesTable.isVerified, true),
      eq(coachesTable.verificationStatus, "approved"),
    )).limit(1);
  if (!coach) {
    res.status(404).json({ error: "Coach not found", code: "coach_not_found" });
    return;
  }
  res.json({ coachId: coach.id });
});

router.get("/coaches/:coachId", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const rawCoachId = Array.isArray(req.params.coachId) ? req.params.coachId[0] : req.params.coachId;
  const resolution = await resolveCoachIdentifierForRequest(req, rawCoachId);
  if (resolution.kind === "error") {
    if (resolution.body.code === "invalid_coach_id") {
      res.status(400).json({ error: "Invalid coach id" });
    } else {
      res.status(resolution.status).json(resolution.body);
    }
    return;
  }
  const coachId = resolution.coachId;
  const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.id, coachId)).limit(1);
  // Unapproved coaches are only visible to their owner (admins use /admin/coaches).
  if (!coach || (!isApprovedCoach(coach) && coach.userId !== user.id)) {
    res.status(404).json({ error: "Coach not found" });
    return;
  }
  res.json(buildCoachCard(coach));
});

router.get("/coaches/:coachId/availability", requireAuth, async (req, res): Promise<void> => {
  const rawCoachId = Array.isArray(req.params.coachId) ? req.params.coachId[0] : req.params.coachId;
  const resolution = await resolveCoachIdentifierForRequest(req, rawCoachId);
  if (resolution.kind === "error") {
    res.status(resolution.status).json(resolution.body);
    return;
  }
  const coachId = resolution.coachId;
  const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.id, coachId)).limit(1);
  if (!coach || (!isApprovedCoach(coach) && coach.userId !== (req as any).user.id)) {
    res.status(404).json({ error: "Coach not found" });
    return;
  }
  const requestedDate = typeof req.query.date === "string"
    ? req.query.date
    : new Date().toISOString().slice(0, 10);
  const viewerTimeZone = req.query.timeZone;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    res.status(400).json({ error: "date must use YYYY-MM-DD format" });
    return;
  }
  if (!isValidTimeZone(viewerTimeZone)) {
    res.status(400).json({ error: "A valid IANA timeZone is required" });
    return;
  }
  const viewerRangeStart = zonedDateTimeToUtc(requestedDate, "00:00", viewerTimeZone);
  const viewerRangeEnd = zonedDateTimeToUtc(addCalendarDays(requestedDate, 1), "00:00", viewerTimeZone);
  if (!viewerRangeStart || !viewerRangeEnd) { res.status(400).json({ error: "Invalid date" }); return; }

  const recurringSlots = ((coach.availabilitySlots as unknown[]) ?? [])
    .filter(isValidAvailabilitySlot);
  const bookings = await db.select().from(bookingsTable).where(eq(bookingsTable.coachId, coach.id));
  const sessionLength = coach.sessionLengthsMinutes[0] ?? 60;
  const concreteSlots = [-2, -1, 0, 1, 2].flatMap((offset) => {
    const coachDate = addCalendarDays(requestedDate, offset);
    const daySlots = recurringSlots.filter((slot) => slot.dayOfWeek === dateStringDayOfWeek(coachDate));
    const result: Array<{ startAt: string; endAt: string; available: boolean }> = [];

    for (const slot of daySlots) {
      const windowStart = zonedDateTimeToUtc(coachDate, slot.startTime, slot.timeZone);
      const windowEnd = zonedDateTimeToUtc(coachDate, slot.endTime, slot.timeZone);
      if (!windowStart || !windowEnd || windowEnd <= windowStart) continue;

      for (
        let startAt = windowStart;
        startAt.getTime() + sessionLength * 60_000 <= windowEnd.getTime();
        startAt = new Date(startAt.getTime() + sessionLength * 60_000)
      ) {
        if (startAt < viewerRangeStart || startAt >= viewerRangeEnd) continue;
        const endAt = new Date(startAt.getTime() + sessionLength * 60_000);
        const hasConflict = bookings.some((booking) =>
          ["pending", "confirmed"].includes(booking.status)
          && booking.scheduledAt < endAt
          && new Date(booking.scheduledAt.getTime() + booking.durationMinutes * 60_000) > startAt
        );
        result.push({
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          available: startAt > new Date() && !hasConflict,
        });
      }
    }
    return result;
  });
  res.json(concreteSlots.sort((a, b) => a.startAt.localeCompare(b.startAt)));
});

router.get("/coaches/:coachId/reviews", requireAuth, async (req, res): Promise<void> => {
  const rawCoachId = Array.isArray(req.params.coachId) ? req.params.coachId[0] : req.params.coachId;
  const resolution = await resolveCoachIdentifierForRequest(req, rawCoachId);
  if (resolution.kind === "error") {
    if (resolution.body.code === "invalid_coach_id") {
      res.status(400).json({ error: "Invalid coach id" });
    } else {
      res.status(resolution.status).json(resolution.body);
    }
    return;
  }
  const coachId = resolution.coachId;
  const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.id, coachId)).limit(1);
  if (!coach || (!isApprovedCoach(coach) && coach.userId !== (req as any).user.id)) {
    res.status(404).json({ error: "Coach not found" });
    return;
  }
  const reviews = await db.select().from(reviewsTable).where(eq(reviewsTable.coachId, coachId)).orderBy(desc(reviewsTable.createdAt)).limit(20);
  const result = await Promise.all(reviews.map(async (r) => {
    const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, r.clientId)).limit(1);
    return { ...r, reviewer: profile ? { name: profile.name, country: profile.country } : null };
  }));
  res.json(result);
});

// --- Coach dashboard (own profile) ---
router.post("/coaches/me", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const {
    displayName,
    bio,
    photoUrl,
    specialties,
    languages,
    sessionLengthsMinutes,
    ratesPerHour,
    pricingTiers,
    currency,
    availability,
  } = req.body;
  const resolvedDisplayName =
    typeof displayName === "string" && displayName.trim()
      ? displayName.trim()
      : user.name?.trim();
  if (!resolvedDisplayName) { res.status(400).json({ error: "A profile name is required before applying to coach" }); return; }
  const storedSlots = normalizeAvailabilityInput(availability);
  if (!storedSlots) { res.status(400).json({ error: "A non-empty availability schedule with a valid IANA timezone is required" }); return; }

  const coach = await db.transaction(async (tx) => {
    const [created] = await tx.insert(coachesTable).values({
      userId: user.id,
      displayName: resolvedDisplayName,
      bio: bio ?? null,
      photoUrl: photoUrl ?? null,
      specialties: specialties ?? [],
      languages: languages ?? [],
      sessionLengthsMinutes: sessionLengthsMinutes ?? [],
      ratesPerHour: ratesPerHour ?? null,
      pricingTiers: Array.isArray(pricingTiers) ? pricingTiers : [],
      currency: currency ?? "USD",
      availabilitySlots: storedSlots,
    }).onConflictDoNothing().returning();
    if (!created) return null;
    await tx.update(usersTable).set({ role: "coach" }).where(eq(usersTable.id, user.id));
    return created;
  });
  if (!coach) { res.status(409).json({ error: "Coach profile already exists" }); return; }
  res.status(201).json(buildCoachCard(coach));
});

// Submit (or resubmit) a verification application for review.
router.post("/coaches/me/verification", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const { notes } = req.body ?? {};
  const outcome = await db.transaction(async (tx) => {
    const [coach] = await tx.select().from(coachesTable).where(eq(coachesTable.userId, user.id)).limit(1);
    if (!coach) return { kind: "not_found" as const };
    if (coach.verificationStatus === "pending") return { kind: "already_pending" as const };
    if (coach.verificationStatus === "approved") return { kind: "already_approved" as const };
    const [updated] = await tx.update(coachesTable)
      .set({ verificationStatus: "pending" })
      .where(eq(coachesTable.id, coach.id)).returning();
    await tx.insert(coachAuditEventsTable).values({
      coachId: coach.id,
      actorUserId: user.id,
      field: "verification",
      action: "submitted",
      previousValue: coach.verificationStatus,
      newValue: "pending",
      notes: typeof notes === "string" && notes.trim() ? notes.trim().slice(0, 2000) : null,
    });
    return { kind: "submitted" as const, coach: updated };
  });
  if (outcome.kind === "not_found") { res.status(404).json({ error: "Coach profile not found" }); return; }
  if (outcome.kind === "already_pending") { res.status(409).json({ error: "A verification application is already under review" }); return; }
  if (outcome.kind === "already_approved") { res.status(409).json({ error: "This coach profile is already verified" }); return; }
  res.status(201).json(buildCoachCard(outcome.coach));
});

router.post("/coaches/me/credentials", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const { objectPath, uploadToken, kind, title, originalName, contentType, size } =
    (req.body ?? {}) as Record<string, unknown>;
  if (
    typeof objectPath !== "string" ||
    typeof uploadToken !== "string" ||
    typeof originalName !== "string" ||
    !originalName.trim() ||
    originalName.length > 255 ||
    typeof size !== "number" ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > MAX_CREDENTIAL_BYTES ||
    !CREDENTIAL_TYPES.includes(contentType as typeof CREDENTIAL_TYPES[number]) ||
    !CREDENTIAL_KINDS.includes(kind as typeof CREDENTIAL_KINDS[number])
  ) {
    res.status(400).json({ error: "Invalid coach credential metadata" });
    return;
  }
  const claim = verifyUploadToken(uploadToken);
  if (
    !claim ||
    claim.purpose !== "coach_credential" ||
    claim.userId !== Number(user.id) ||
    claim.objectPath !== objectPath
  ) {
    res.status(403).json({ error: "Invalid or mismatched upload token" });
    return;
  }
  const [coach] = await db.select().from(coachesTable)
    .where(eq(coachesTable.userId, user.id)).limit(1);
  if (!coach) { res.status(404).json({ error: "Coach profile not found" }); return; }

  const [alreadyFinalized] = await db.select().from(coachCredentialsTable)
    .where(eq(coachCredentialsTable.objectPath, objectPath)).limit(1);
  if (alreadyFinalized) {
    if (alreadyFinalized.coachId !== coach.id) {
      res.status(409).json({ error: "Credential object is already registered" });
      return;
    }
    res.status(200).json(safeCredential(alreadyFinalized));
    return;
  }

  try {
    const storage = new ObjectStorageService();
    const objectFile = await storage.getObjectEntityFile(objectPath);
    const existingAcl = await storage.getObjectEntityAclPolicy(objectFile);
    if (existingAcl && (existingAcl.owner !== String(user.id) || existingAcl.visibility !== "private")) {
      res.status(409).json({ error: "Credential object belongs to another owner" });
      return;
    }
    const [metadata] = await objectFile.getMetadata();
    const actualSize = Number(metadata.size);
    if (!Number.isSafeInteger(actualSize) || actualSize !== size || actualSize > MAX_CREDENTIAL_BYTES) {
      res.status(400).json({ error: "Uploaded credential size does not match" });
      return;
    }
    if (metadata.contentType && metadata.contentType !== contentType) {
      res.status(400).json({ error: "Uploaded credential content type does not match" });
      return;
    }
    const [bytes] = await objectFile.download();
    if (bytes.length !== size || !credentialMagicMatches(String(contentType), bytes)) {
      res.status(400).json({ error: "Uploaded credential file type is invalid" });
      return;
    }
    if (!existingAcl) {
      await storage.trySetObjectEntityAclPolicy(objectPath, {
        owner: String(user.id),
        visibility: "private",
        aclRules: [],
      });
    }
    const [credential] = await db.insert(coachCredentialsTable).values({
      coachId: coach.id,
      kind: String(kind),
      title: typeof title === "string" && title.trim() ? title.trim().slice(0, 200) : null,
      originalName: originalName.trim(),
      objectPath,
      contentType: String(contentType),
      size,
      status: "pending",
    }).returning();
    res.status(201).json(safeCredential(credential));
  } catch (error: unknown) {
    req.log.warn(
      { errorType: error instanceof Error ? error.constructor.name : typeof error, userId: user.id },
      "Coach credential finalization failed",
    );
    res.status(400).json({ error: "Uploaded credential was not found or could not be validated" });
  }
});

router.patch("/coaches/me", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const allowed = ["displayName", "bio", "photoUrl", "specialties", "languages", "sessionLengthsMinutes", "ratesPerHour", "pricingTiers", "currency"];
  const updates: Record<string, any> = {};
  for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
  const [coach] = await db.update(coachesTable).set(updates).where(eq(coachesTable.userId, user.id)).returning();
  if (!coach) { res.status(404).json({ error: "Coach profile not found" }); return; }
  res.json(buildCoachCard(coach));
});

router.patch("/coaches/me/availability", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const storedSlots = normalizeAvailabilityInput(req.body);
  if (!storedSlots) {
    res.status(400).json({ error: "Invalid availability slots" });
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: coachesTable.id })
      .from(coachesTable)
      .where(eq(coachesTable.userId, user.id))
      .limit(1);
    if (!existing) return { kind: "not_found" as const };

    await tx.execute(sql`select pg_advisory_xact_lock(1280262980, ${existing.id})`);
    const activeBookings = await tx.select().from(bookingsTable).where(
      and(
        eq(bookingsTable.coachId, existing.id),
        or(eq(bookingsTable.status, "confirmed"), eq(bookingsTable.status, "pending")),
      )
    );
    const now = new Date();
    const invalidatesBooking = activeBookings.some((booking) => {
      const bookingEnd = new Date(booking.scheduledAt.getTime() + booking.durationMinutes * 60_000);
      return bookingEnd > now
        && !storedSlots.some((slot) => intervalFitsAvailability(booking.scheduledAt, bookingEnd, slot));
    });
    if (invalidatesBooking) return { kind: "booking_conflict" as const };

    await tx.update(coachesTable)
      .set({ availabilitySlots: storedSlots })
      .where(eq(coachesTable.id, existing.id));
    return { kind: "updated" as const };
  });
  if (outcome.kind === "not_found") { res.status(404).json({ error: "Coach profile not found" }); return; }
  if (outcome.kind === "booking_conflict") {
    res.status(409).json({ error: "The new availability would exclude an upcoming booking" });
    return;
  }
  res.json({ message: "Availability updated" });
});

router.get("/coaches/me/bookings", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.userId, user.id)).limit(1);
  if (!coach) { res.status(404).json({ error: "Coach profile not found" }); return; }
  const { status } = req.query;
  const where = status ? and(eq(bookingsTable.coachId, coach.id), eq(bookingsTable.status, String(status))) : eq(bookingsTable.coachId, coach.id);
  const bookings = await db.select().from(bookingsTable).where(where).orderBy(desc(bookingsTable.scheduledAt)).limit(50);
  const result = await Promise.all(bookings.map(async (b) => {
    const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, b.clientId)).limit(1);
    return { ...b, client: profile ? { name: profile.name, photoUrl: null } : null };
  }));
  res.json(result);
});

router.get("/coaches/me/dashboard", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.userId, user.id)).limit(1);
  if (!coach) { res.status(404).json({ error: "No coach profile" }); return; }
  const bookings = await db.select().from(bookingsTable).where(eq(bookingsTable.coachId, coach.id));
  const upcoming = bookings.filter((b) => b.status === "confirmed" && new Date(b.scheduledAt) > new Date());
  const completed = bookings.filter((b) => b.status === "completed");
  const pending = bookings.filter((b) => b.status === "pending");
  const totalRevenue = completed.reduce((acc, b) => acc + (b.rateAtBooking ?? 0) * ((b.durationMinutes ?? 60) / 60), 0);
  const clients = await db.select().from(clientSubscriptionsTable).where(and(eq(clientSubscriptionsTable.coachId, coach.id), eq(clientSubscriptionsTable.status, "active")));
  const clientIds = new Set([
    ...bookings.map((booking) => booking.clientId),
    ...clients.map((subscription) => subscription.clientId),
  ]);
  res.json({
    totalBookings: bookings.length,
    pendingBookings: pending.length,
    totalRevenue,
    totalClients: clientIds.size,
    avgRating: coach.rating ?? null,
    upcomingBookings: upcoming,
  });
});

// --- Client bookings ---
router.get("/bookings", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const bookings = await db.select().from(bookingsTable).where(eq(bookingsTable.clientId, user.id)).orderBy(desc(bookingsTable.scheduledAt)).limit(20);
  const result = await Promise.all(bookings.map(async (b) => {
    const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.id, b.coachId)).limit(1);
    return { ...b, coach: coach ? buildCoachCard(coach) : null };
  }));
  res.json(result);
});

router.post("/bookings", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const { coachId: coachIdentifier, scheduledAt: scheduledAtRaw, durationMinutes, notes } = req.body;
  const rawCoachIdentifier = coachIdentifierValue(coachIdentifier);
  if (
    !rawCoachIdentifier
    || !parseCoachIdentifier(rawCoachIdentifier)
    || !scheduledAtRaw
    || !Number.isInteger(durationMinutes)
    || durationMinutes <= 0
  ) {
    res.status(400).json({ error: "coachId, scheduledAt, durationMinutes required" });
    return;
  }
  const resolution = await resolveCoachIdentifierForRequest(req, coachIdentifier);
  if (resolution.kind === "error") {
    res.status(resolution.status).json(resolution.body);
    return;
  }
  const coachId = resolution.coachId;

  const scheduledAt = new Date(scheduledAtRaw);
  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt <= new Date()) {
    res.status(400).json({ error: "scheduledAt must be a valid future date" });
    return;
  }
  const sessionEnd = new Date(scheduledAt.getTime() + durationMinutes * 60 * 1000);

  // Booking creation and availability replacement use the same coach-scoped
  // lock so validation always observes the schedule that remains persisted.
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(1280262980, ${coachId})`);
    const [coach] = await tx.select().from(coachesTable).where(eq(coachesTable.id, coachId)).limit(1);
    if (!coach) return { kind: "coach_not_found" as const };
    // Only approved coaches are bookable — unapproved IDs behave as not found.
    if (!isApprovedCoach(coach)) return { kind: "coach_not_found" as const };
    if (coach.userId === user.id) return { kind: "self_booking" as const };

    const allowedDurations = coach.sessionLengthsMinutes.length > 0 ? coach.sessionLengthsMinutes : [60];
    if (!allowedDurations.includes(durationMinutes)) return { kind: "unsupported_duration" as const };

    const slots = ((coach.availabilitySlots as unknown[]) ?? []).filter(isValidAvailabilitySlot);
    if (!slots.some((slot) => intervalFitsAvailability(scheduledAt, sessionEnd, slot))) {
      return { kind: "unavailable" as const };
    }

    const coachConflicts = await tx.select().from(bookingsTable).where(
      and(
        eq(bookingsTable.coachId, coachId),
        or(eq(bookingsTable.status, "confirmed"), eq(bookingsTable.status, "pending")),
        sql`${bookingsTable.scheduledAt} < ${sessionEnd.toISOString()}::timestamptz`,
        sql`${bookingsTable.scheduledAt} + (interval '1 minute' * ${bookingsTable.durationMinutes}) > ${scheduledAt.toISOString()}::timestamptz`,
      )
    );
    if (coachConflicts.length > 0) return { kind: "booking_conflict" as const };

    const [created] = await tx.insert(bookingsTable).values({
      coachId,
      clientId: user.id,
      scheduledAt,
      durationMinutes,
      rateAtBooking: coach.ratesPerHour ?? null,
      currency: coach.currency,
      notes: notes ?? null,
      status: "pending",
    }).returning();
    return { kind: "created" as const, booking: created, coach };
  });

  if (outcome.kind === "coach_not_found") { res.status(404).json({ error: "Coach not found" }); return; }
  if (outcome.kind === "self_booking") { res.status(400).json({ error: "You cannot book a session with yourself" }); return; }
  if (outcome.kind === "unsupported_duration") { res.status(400).json({ error: "Unsupported session duration" }); return; }
  if (outcome.kind === "unavailable") {
    res.status(409).json({ error: "The coach is not available at this time. Check their availability calendar." });
    return;
  }
  if (outcome.kind === "booking_conflict") {
    res.status(409).json({ error: "This time slot is already booked. Please choose a different time." });
    return;
  }

  // The booking transaction has committed. Notifying the coach must never be
  // able to roll it back, so enqueue afterwards (best-effort, non-throwing).
  const created = outcome.booking;
  const when = new Date(created.scheduledAt).toISOString();
  await enqueueBookingNotification({
    userId: outcome.coach.userId,
    type: "booking",
    title: "New booking request",
    body: `You have a new ${created.durationMinutes}-minute booking request for ${when}.`,
    relatedId: created.id,
    relatedType: "booking",
    idempotencyKey: `booking:new:${created.id}`,
  });
  // Best-effort immediate dispatch attempt; the worker/reconciler retries the rest.
  void processDeliveries({ limit: 10 }).catch(() => {});

  res.status(201).json({ ...outcome.booking, coach: buildCoachCard(outcome.coach) });
});

router.get("/bookings/:bookingId", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const bId = parsePositiveSafeInteger(Array.isArray(req.params.bookingId) ? req.params.bookingId[0] : req.params.bookingId);
  if (bId === null) { res.status(400).json({ error: "Invalid booking id" }); return; }
  const [booking] = await db.select().from(bookingsTable).where(
    and(eq(bookingsTable.id, bId), or(eq(bookingsTable.clientId, user.id)))
  ).limit(1);
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.id, booking.coachId)).limit(1);
  res.json({ ...booking, coach: coach ? buildCoachCard(coach) : null });
});

// A booking may be cancelled by its client or the owning coach, but only while
// it is still cancellable: never a completed/terminal booking, and never after
// the session start time has passed (cancellation protection for past sessions).
async function cancelBookingForUser(bId: number, userId: number): Promise<
  | { kind: "not_found" }
  | { kind: "invalid_state" }
  | { kind: "past" }
  | { kind: "cancelled"; booking: any }
> {
  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, bId)).limit(1);
    if (!booking) return { kind: "not_found" as const };
    const [coach] = await tx.select().from(coachesTable).where(eq(coachesTable.id, booking.coachId)).limit(1);
    const isClient = booking.clientId === userId;
    const isCoach = coach?.userId === userId;
    if (!isClient && !isCoach) return { kind: "not_found" as const };
    const blocked = cancellationBlockReason(booking);
    if (blocked) return { kind: blocked };
    const [updated] = await tx.update(bookingsTable).set({ status: "cancelled" }).where(eq(bookingsTable.id, bId)).returning();
    return { kind: "cancelled" as const, booking: updated };
  });
}

function respondCancel(res: any, outcome: Awaited<ReturnType<typeof cancelBookingForUser>>, body: any): void {
  if (outcome.kind === "not_found") { res.status(404).json({ error: "Booking not found" }); return; }
  if (outcome.kind === "invalid_state") { res.status(409).json({ error: "This booking can no longer be cancelled" }); return; }
  if (outcome.kind === "past") { res.status(409).json({ error: "A booking cannot be cancelled after its start time" }); return; }
  res.json(body(outcome.booking));
}

router.patch("/bookings/:bookingId/cancel", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const bId = parsePositiveSafeInteger(Array.isArray(req.params.bookingId) ? req.params.bookingId[0] : req.params.bookingId);
  if (bId === null) { res.status(400).json({ error: "Invalid booking id" }); return; }
  respondCancel(res, await cancelBookingForUser(bId, user.id), (b: any) => b);
});

router.delete("/bookings/:bookingId", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const bId = parsePositiveSafeInteger(Array.isArray(req.params.bookingId) ? req.params.bookingId[0] : req.params.bookingId);
  if (bId === null) { res.status(400).json({ error: "Invalid booking id" }); return; }
  respondCancel(res, await cancelBookingForUser(bId, user.id), () => ({ message: "Booking cancelled" }));
});

// Coach transitions a booking through the lifecycle (confirm / complete / no_show).
router.patch("/bookings/:bookingId/status", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const bId = parsePositiveSafeInteger(Array.isArray(req.params.bookingId) ? req.params.bookingId[0] : req.params.bookingId);
  if (bId === null) { res.status(400).json({ error: "Invalid booking id" }); return; }
  const { status } = req.body as { status?: string };
  if (!status || !["confirmed", "completed", "no_show", "cancelled"].includes(status)) {
    res.status(400).json({ error: "Invalid target status" });
    return;
  }
  const outcome = await db.transaction(async (tx) => {
    const [coach] = await tx.select().from(coachesTable).where(eq(coachesTable.userId, user.id)).limit(1);
    if (!coach) return { kind: "not_coach" as const };
    const [booking] = await tx.select().from(bookingsTable)
      .where(and(eq(bookingsTable.id, bId), eq(bookingsTable.coachId, coach.id))).limit(1);
    if (!booking) return { kind: "not_found" as const };
    if (status === "cancelled") {
      const blocked = cancellationBlockReason(booking);
      if (blocked === "invalid_state") return { kind: "invalid" as const };
      if (blocked === "past") return { kind: "past" as const };
    }
    if (!canTransition(booking.status, status)) return { kind: "invalid" as const };
    // Completing before the session has started is not allowed.
    if (status === "completed" && new Date(booking.scheduledAt).getTime() > Date.now()) {
      return { kind: "too_early" as const };
    }
    const [updated] = await tx.update(bookingsTable).set({ status }).where(eq(bookingsTable.id, bId)).returning();
    return { kind: "ok" as const, booking: updated };
  });
  if (outcome.kind === "not_coach") { res.status(403).json({ error: "Coach only" }); return; }
  if (outcome.kind === "not_found") { res.status(404).json({ error: "Booking not found" }); return; }
  if (outcome.kind === "past") { res.status(409).json({ error: "A booking cannot be cancelled after its start time" }); return; }
  if (outcome.kind === "invalid") { res.status(409).json({ error: `Cannot move booking to ${status}` }); return; }
  if (outcome.kind === "too_early") { res.status(409).json({ error: "Cannot complete a session before it starts" }); return; }

  // Completing a paid session makes the coach eligible for a payout transfer.
  // Transfer is only attempted for a captured payment + connected coach account.
  if (status === "completed") {
    try {
      await ensureCoachTransferForCompletedBooking(outcome.booking.id);
      await attemptCoachTransfer(outcome.booking.id, true);
    } catch (err) {
      req.log.error({ err: (err as Error).message, bookingId: outcome.booking.id }, "coach transfer scheduling failed");
    }
  }
  res.json(outcome.booking);
});

router.post("/bookings/:bookingId/review", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const bId = parsePositiveSafeInteger(Array.isArray(req.params.bookingId) ? req.params.bookingId[0] : req.params.bookingId);
  if (bId === null) { res.status(400).json({ error: "Invalid booking id" }); return; }
  const { rating, comment } = req.body;
  const numericRating = Number(rating);
  // Ratings are bounded integers 1..5.
  if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
    res.status(400).json({ error: "rating must be an integer between 1 and 5" });
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    const [booking] = await tx.select().from(bookingsTable)
      .where(and(eq(bookingsTable.id, bId), eq(bookingsTable.clientId, user.id))).limit(1);
    if (!booking) return { kind: "not_found" as const };
    // Reviews only after the booking is completed.
    if (booking.status !== "completed") return { kind: "not_completed" as const };
    const [existing] = await tx.select().from(reviewsTable).where(eq(reviewsTable.bookingId, bId)).limit(1);
    if (existing) return { kind: "duplicate" as const };
    const [review] = await tx.insert(reviewsTable).values({
      coachId: booking.coachId,
      clientId: user.id,
      bookingId: bId,
      rating: numericRating,
      comment: comment ?? null,
    }).onConflictDoNothing().returning();
    if (!review) return { kind: "duplicate" as const };
    const [{ avg: newRating }] = await tx.select({ avg: avg(reviewsTable.rating) }).from(reviewsTable).where(eq(reviewsTable.coachId, booking.coachId));
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(reviewsTable).where(eq(reviewsTable.coachId, booking.coachId));
    await tx.update(coachesTable).set({ rating: newRating ? parseFloat(String(newRating)) : null, reviewCount: count }).where(eq(coachesTable.id, booking.coachId));
    return { kind: "ok" as const, review };
  });

  if (outcome.kind === "not_found") { res.status(404).json({ error: "Booking not found" }); return; }
  if (outcome.kind === "not_completed") { res.status(409).json({ error: "You can only review a completed session" }); return; }
  if (outcome.kind === "duplicate") { res.status(409).json({ error: "You have already reviewed this session" }); return; }
  res.status(201).json(outcome.review);
});

router.post("/bookings/:bookingId/notes", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const bId = parsePositiveSafeInteger(Array.isArray(req.params.bookingId) ? req.params.bookingId[0] : req.params.bookingId);
  if (bId === null) { res.status(400).json({ error: "Invalid booking id" }); return; }
  const { notes } = req.body;
  const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.userId, user.id)).limit(1);
  if (!coach) { res.status(403).json({ error: "Coach only" }); return; }
  const [b] = await db.update(bookingsTable).set({ coachNotes: notes }).where(and(eq(bookingsTable.id, bId), eq(bookingsTable.coachId, coach.id))).returning();
  if (!b) { res.status(404).json({ error: "Booking not found" }); return; }
  res.json(b);
});

// --- Coaching plans ---
router.get("/coaching/subscriptions", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const subs = await db.select().from(clientSubscriptionsTable).where(eq(clientSubscriptionsTable.clientId, user.id));
  const result = await Promise.all(subs.map(async (s) => {
    const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.id, s.coachId)).limit(1);
    return { ...s, coach: coach ? buildCoachCard(coach) : null };
  }));
  res.json(result);
});

router.post("/coaching/subscriptions", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const coachId = strictLocalCoachId(req.body.coachId);
  if (!coachId) { res.status(400).json({ error: "coachId must be a valid coach id" }); return; }
  const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.id, coachId)).limit(1);
  if (!coach || !isApprovedCoach(coach)) { res.status(404).json({ error: "Coach not found" }); return; }
  if (coach.userId === user.id) { res.status(400).json({ error: "You cannot subscribe to yourself" }); return; }
  const [existing] = await db.select({ id: clientSubscriptionsTable.id }).from(clientSubscriptionsTable).where(and(
    eq(clientSubscriptionsTable.clientId, user.id),
    eq(clientSubscriptionsTable.coachId, coachId),
    eq(clientSubscriptionsTable.status, "active"),
  )).limit(1);
  if (existing) { res.status(409).json({ error: "An active subscription already exists" }); return; }
  // Recurring coaching checkout/webhooks are not implemented by the current
  // payment provider. Never grant active access before a verified payment.
  res.status(503).json({
    error: "Coaching subscription payments are currently unavailable",
    paymentRequired: true,
  });
});

router.delete("/coaching/subscriptions/:subscriptionId", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const sId = parsePositiveSafeInteger(Array.isArray(req.params.subscriptionId) ? req.params.subscriptionId[0] : req.params.subscriptionId);
  if (sId === null) { res.status(400).json({ error: "Invalid subscription id" }); return; }
  const [s] = await db.update(clientSubscriptionsTable).set({ status: "cancelled" })
    .where(and(eq(clientSubscriptionsTable.id, sId), eq(clientSubscriptionsTable.clientId, user.id))).returning();
  if (!s) { res.status(404).json({ error: "Subscription not found" }); return; }
  res.json(s);
});

router.get("/coaching/plans", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const plans = await db.select().from(coachingPlansTable).where(eq(coachingPlansTable.clientId, user.id));
  const result = await Promise.all(plans.map(async (p) => {
    const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.id, p.coachId)).limit(1);
    return { ...p, coach: coach ? buildCoachCard(coach) : null };
  }));
  res.json(result);
});

// Create a coaching plan. Only the owning coach may author a plan for a client.
router.post("/coaching/plans", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const { clientId, title, goals, milestones, notes } = req.body;
  if (!Number.isInteger(clientId) || typeof title !== "string" || !title.trim()) {
    res.status(400).json({ error: "clientId and title required" });
    return;
  }
  const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.userId, user.id)).limit(1);
  if (!coach) { res.status(403).json({ error: "Coach profile required" }); return; }
  const [plan] = await db.insert(coachingPlansTable).values({
    coachId: coach.id,
    clientId,
    title: title.trim(),
    goals: Array.isArray(goals) ? goals : [],
    milestones: Array.isArray(milestones) ? milestones : [],
    notes: notes ?? null,
  }).returning();
  res.status(201).json(plan);
});

router.patch("/coaching/plans/:planId/progress", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const pId = parsePositiveSafeInteger(Array.isArray(req.params.planId) ? req.params.planId[0] : req.params.planId);
  if (pId === null) { res.status(400).json({ error: "Invalid plan id" }); return; }
  const { progressPercent, notes, milestones, goals } = req.body;

  const [plan] = await db.select().from(coachingPlansTable).where(eq(coachingPlansTable.id, pId)).limit(1);
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }
  const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.id, plan.coachId)).limit(1);
  const isCoach = coach?.userId === user.id;
  const isClient = plan.clientId === user.id;
  if (!isCoach && !isClient) { res.status(403).json({ error: "Not your plan" }); return; }

  const updates: Record<string, any> = {};
  if (progressPercent !== undefined) {
    const p = Number(progressPercent);
    if (!Number.isInteger(p) || p < 0 || p > 100) { res.status(400).json({ error: "progressPercent must be 0-100" }); return; }
    updates.currentProgressPercent = p;
  }
  if (notes !== undefined) updates.notes = notes;
  // Goals and milestones are coach-owned content.
  if (isCoach && Array.isArray(milestones)) updates.milestones = milestones;
  if (isCoach && Array.isArray(goals)) updates.goals = goals;
  const [updated] = await db.update(coachingPlansTable).set(updates).where(eq(coachingPlansTable.id, pId)).returning();
  res.json(updated);
});

// --- Workshops ---
router.get("/workshops", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const { coachId, upcoming } = req.query;
  let localCoachId: number | null = null;
  if (coachId !== undefined) {
    localCoachId = strictLocalCoachId(coachId);
    if (!localCoachId) {
      res.status(400).json({ error: "coachId must be a valid coach id" });
      return;
    }
  }
  const requestedLimit = parsePositiveSafeInteger(req.query.limit);
  const limit = requestedLimit === null ? 20 : Math.min(requestedLimit, 100);
  const workshops = await db
    .select()
    .from(groupWorkshopsTable)
    .where(and(
      localCoachId ? eq(groupWorkshopsTable.coachId, localCoachId) : undefined,
      upcoming !== "false" ? gt(groupWorkshopsTable.scheduledAt, new Date()) : undefined,
    ))
    .orderBy(desc(groupWorkshopsTable.scheduledAt))
    .limit(limit);

  // Fetch user's enrollments to annotate isEnrolled
  const enrollments = await db.select().from(workshopEnrollmentsTable).where(eq(workshopEnrollmentsTable.userId, user.id));
  const enrolledIds = new Set(enrollments.map((e) => e.workshopId));

  const result = await Promise.all(workshops.map(async (w) => {
    const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.id, w.coachId)).limit(1);
    return { ...w, coach: coach ? buildCoachCard(coach) : null, isEnrolled: enrolledIds.has(w.id) };
  }));
  res.json(result);
});

router.post("/workshops", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.userId, user.id)).limit(1);
  if (!coach) { res.status(403).json({ error: "Coach profile required" }); return; }
  const { title, description, scheduledAt, durationMinutes = 60, maxParticipants = 20, price, currency = "USD" } = req.body;
  if (!title || !scheduledAt) { res.status(400).json({ error: "title and scheduledAt required" }); return; }
  const [w] = await db.insert(groupWorkshopsTable).values({
    coachId: coach.id,
    title,
    description: description ?? null,
    scheduledAt: new Date(scheduledAt),
    durationMinutes,
    maxParticipants,
    price: price ?? null,
    currency,
  }).returning();
  res.status(201).json({ ...w, coach: buildCoachCard(coach) });
});

router.get("/workshops/:workshopId", requireAuth, async (req, res): Promise<void> => {
  const wId = parsePositiveSafeInteger(Array.isArray(req.params.workshopId) ? req.params.workshopId[0] : req.params.workshopId);
  if (wId === null) { res.status(400).json({ error: "Invalid workshop id" }); return; }
  const [w] = await db.select().from(groupWorkshopsTable).where(eq(groupWorkshopsTable.id, wId)).limit(1);
  if (!w) { res.status(404).json({ error: "Workshop not found" }); return; }
  const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.id, w.coachId)).limit(1);
  res.json({ ...w, coach: coach ? buildCoachCard(coach) : null });
});

router.post("/workshops/:workshopId/enroll", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const wId = parsePositiveSafeInteger(Array.isArray(req.params.workshopId) ? req.params.workshopId[0] : req.params.workshopId);
  if (wId === null) { res.status(400).json({ error: "Invalid workshop id" }); return; }
  const workshopId = wId;
  const [workshop] = await db.select().from(groupWorkshopsTable).where(eq(groupWorkshopsTable.id, workshopId)).limit(1);
  if (!workshop) { res.status(404).json({ error: "Workshop not found" }); return; }

  if (workshop.maxParticipants !== null) {
    const [{ count }] = await db.select({ count: sql<number>`cast(count(*) as integer)` })
      .from(workshopEnrollmentsTable).where(eq(workshopEnrollmentsTable.workshopId, workshopId));
    if (count >= workshop.maxParticipants) {
      res.status(409).json({ error: "This workshop is full.", workshopFull: true });
      return;
    }
  }

  // Transactional enrolment with capacity → waitlist fallback and group
  // conversation membership so slots are never oversold under concurrency.
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(1280262981, ${workshopId})`);
    const [existing] = await tx.select().from(workshopEnrollmentsTable)
      .where(and(eq(workshopEnrollmentsTable.workshopId, workshopId), eq(workshopEnrollmentsTable.userId, user.id))).limit(1);
    if (existing && existing.status !== "cancelled") {
      return { kind: "already" as const, status: existing.status };
    }
    const [{ count }] = await tx.select({ count: sql<number>`cast(count(*) as integer)` })
      .from(workshopEnrollmentsTable)
      .where(and(eq(workshopEnrollmentsTable.workshopId, workshopId), eq(workshopEnrollmentsTable.status, "enrolled")));
    const full = workshop.maxParticipants !== null && count >= workshop.maxParticipants;
    const status = full ? "waitlisted" : "enrolled";
    if (existing) {
      await tx.update(workshopEnrollmentsTable).set({ status }).where(eq(workshopEnrollmentsTable.id, existing.id));
    } else {
      await tx.insert(workshopEnrollmentsTable).values({ workshopId, userId: user.id, status }).onConflictDoNothing();
    }
    if (!full) {
      await tx.update(groupWorkshopsTable)
        .set({ currentParticipants: count + 1 })
        .where(eq(groupWorkshopsTable.id, workshopId));
      // Ensure the group conversation exists for enrolled participants.
      await tx.insert(workshopConversationsTable).values({ workshopId }).onConflictDoNothing();
    }
    return { kind: status };
  });

  if (outcome.kind === "already") { res.status(409).json({ error: "Already enrolled", status: outcome.status }); return; }
  if (outcome.kind === "waitlisted") { res.json({ message: "Added to waitlist", status: "waitlisted" }); return; }
  res.json({ message: "Enrolled", status: "enrolled" });
});

router.get("/coaches/me/credentials", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.userId, user.id)).limit(1);
  if (!coach) { res.status(403).json({ error: "Coach profile required" }); return; }
  const creds = await db.select().from(coachCredentialsTable)
    .where(eq(coachCredentialsTable.coachId, coach.id)).orderBy(desc(coachCredentialsTable.createdAt));
  res.json(creds.map(safeCredential));
});

// --- Payout readiness (real Stripe Connect, never faked success) ---
router.get("/coaches/me/payout", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.userId, user.id)).limit(1);
  if (!coach) { res.status(403).json({ error: "Coach profile required" }); return; }
  const { isStripeConfigured } = await import("../lib/stripeClient");
  res.json({
    payoutStatus: coach.payoutStatus,
    isPayoutReady: coach.isPayoutReady,
    payoutDetailsSubmitted: coach.payoutDetailsSubmitted,
    stripeAccountId: coach.stripeAccountId ?? null,
    stripeConfigured: isStripeConfigured(),
  });
});

router.post("/coaches/me/payout/onboard", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.userId, user.id)).limit(1);
  if (!coach) { res.status(403).json({ error: "Coach profile required" }); return; }
  const { isStripeConfigured, getStripeClient } = await import("../lib/stripeClient");
  if (!isStripeConfigured()) {
    // No fake success: surface an explicit unavailable state.
    res.status(503).json({
      error: "Payouts are not yet available. Payment processing must be configured before coaches can be paid.",
      stripeRequired: true,
      onboardingUrl: null,
    });
    return;
  }
  try {
    const stripe = await getStripeClient();
    let accountId = coach.stripeAccountId;
    if (!accountId) {
      const account = await stripe.accounts.create({ type: "express", metadata: { userId: String(user.id), coachId: String(coach.id) } });
      accountId = account.id;
      await db.update(coachesTable).set({ stripeAccountId: accountId, payoutStatus: "pending" }).where(eq(coachesTable.id, coach.id));
    }
    const baseUrl = getPublicAppUrl(req);
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${baseUrl}/coach-dashboard?payout=refresh`,
      return_url: `${baseUrl}/coach-dashboard?payout=return`,
      type: "account_onboarding",
    });
    res.json({ onboardingUrl: link.url });
  } catch (err: any) {
    req.log.error({ err }, "Stripe payout onboarding failed");
    res.status(502).json({ error: "Could not start payout onboarding", details: err.message });
  }
});

export default router;

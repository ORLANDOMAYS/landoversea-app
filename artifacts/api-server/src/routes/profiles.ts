import { Router, type IRouter, type RequestHandler } from "express";
import { db, profilesTable, profilePhotosTable, usersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { computeCompletionPercent, getMissingSteps, isProfileComplete } from "../lib/profile-completion";
import multer from "multer";
import { ObjectStorageService } from "../lib/objectStorage";
import { z } from "zod";
import {
  MAX_PROFILE_PHOTO_BYTES,
  PROFILE_PHOTO_ACCEPTED_MIME_TYPES,
  ProfilePhotoImageError,
  normalizeProfilePhotoUpload,
} from "../lib/profilePhotoImage";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PROFILE_PHOTO_BYTES },
});
const receiveProfilePhoto: RequestHandler = (req, res, next) => {
  upload.single("photo")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "Profile photos must be 12 MB or smaller",
        code: "image_too_large",
        maxBytes: MAX_PROFILE_PHOTO_BYTES,
      });
      return;
    }
    if (error) {
      next(error);
      return;
    }
    next();
  });
};
const objectStorage = new ObjectStorageService();
const MAX_PROFILE_PHOTOS = 6;

const router: IRouter = Router();

class ProfilePhotoLimitError extends Error {}

const shortText = (max: number) => z.string().max(max);
const stringList = (maxItems: number, maxLength: number) =>
  z.array(z.string().min(1).max(maxLength)).max(maxItems).refine(
    (items) => new Set(items).size === items.length,
    "Array values must be unique",
  );
const profileUpdateSchema = z.strictObject({
  name: z.string().min(1).max(100).optional(),
  bio: shortText(2000).optional(),
  age: z.number().int().min(18).max(100).optional(),
  occupation: shortText(120).optional(),
  height: z.number().int().min(100).max(250).optional(),
  gender: z.enum(["Man", "Woman", "Non-binary", "Transgender", "Prefer not to say", "Other"]).optional(),
  lookingFor: z.enum(["Man", "Woman", "Non-binary", "Everyone"]).optional(),
  relationshipGoal: z.enum([
    "serious", "casual", "friendship", "marriage", "adventure", "undecided",
    "language_exchange", "networking", "open",
  ]).optional(),
  primaryLanguage: z.string().min(1).max(80).optional(),
  otherLanguages: stringList(20, 80).optional(),
  learningLanguages: stringList(20, 80).optional(),
  country: z.string().min(1).max(100).optional(),
  city: shortText(100).optional(),
  countriesOfInterest: stringList(30, 100).optional(),
  culturalInterests: stringList(30, 100).optional(),
  interests: stringList(50, 100).optional(),
  travelGoals: shortText(500).optional(),
  longDistanceOpenness: z.boolean().optional(),
  relocationOpenness: z.boolean().optional(),
  communicationPreferences: stringList(20, 80).optional(),
  preferredMinAge: z.number().int().min(18).max(100).optional(),
  preferredMaxAge: z.number().int().min(18).max(100).optional(),
  preferredGender: z.enum(["Man", "Woman", "Non-binary", "Everyone"]).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");

function parsePositiveId(raw: string | string[]): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

async function normalizePhotos(tx: any, userId: number, requestedPrimaryId?: number) {
  await tx.execute(sql`select pg_advisory_xact_lock(${userId}, 7301)`);
  const photos = await tx.select().from(profilePhotosTable)
    .where(eq(profilePhotosTable.userId, userId));
  photos.sort((a: any, b: any) => a.position - b.position || a.id - b.id);
  const existingPrimary = photos.find((photo: any) => photo.isPrimary);
  const primaryId = requestedPrimaryId ?? existingPrimary?.id ?? photos[0]?.id;
  const primaryIndex = photos.findIndex((photo: any) => photo.id === primaryId);
  if (primaryIndex > 0) {
    const [primary] = photos.splice(primaryIndex, 1);
    photos.unshift(primary);
  }
  const primaryCount = photos.filter((photo: any) => photo.isPrimary).length;
  const isAlreadyNormalized = photos.every((photo: any, position: number) =>
    photo.position === position
      && (photos.length === 0 || primaryCount === 1)
      && (photos.length === 0 || photos[0].id === primaryId)
      && (requestedPrimaryId === undefined || photo.isPrimary === (photo.id === requestedPrimaryId)));
  if (isAlreadyNormalized) return photos;

  if (photos.length > 0) {
    await tx.update(profilePhotosTable)
      .set({ isPrimary: false })
      .where(eq(profilePhotosTable.userId, userId));
  }
  const normalized = [];
  for (let position = 0; position < photos.length; position += 1) {
    const [photo] = await tx.update(profilePhotosTable)
      .set({ position, isPrimary: photos[position].id === primaryId })
      .where(and(
        eq(profilePhotosTable.id, photos[position].id),
        eq(profilePhotosTable.userId, userId),
      ))
      .returning();
    normalized.push(photo);
  }
  return normalized;
}

async function updateProfileCompletion(userId: number): Promise<void> {
  const [profile] = await db.select().from(profilesTable)
    .where(eq(profilesTable.userId, userId)).limit(1);
  if (!profile) return;
  const photos = await db.select().from(profilePhotosTable)
    .where(eq(profilePhotosTable.userId, userId));
  const completionPercent = computeCompletionPercent(profile, photos.length);
  await db.update(profilesTable).set({ completionPercent })
    .where(eq(profilesTable.userId, userId));
  await db.update(usersTable).set({ isProfileComplete: isProfileComplete(profile, photos.length) })
    .where(eq(usersTable.id, userId));
}

async function getProfileWithPhotos(userId: number) {
  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, userId)).limit(1);
  if (!profile) return null;
  const photos = await db.select().from(profilePhotosTable).where(eq(profilePhotosTable.userId, userId));
  photos.sort((a, b) => a.position - b.position || a.id - b.id);
  const completionPercent = computeCompletionPercent(profile, photos.length);
  const missing = getMissingSteps(profile, photos.length);
  return { ...profile, photos, completionPercent, verificationStatus: profile.verificationStatus as any };
}

router.get("/profiles/me", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  await db.transaction(async (tx) => normalizePhotos(tx, user.id));
  const profile = await getProfileWithPhotos(user.id);
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json(profile);
});

router.patch("/profiles/me", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const parsed = profileUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ issues: parsed.error.issues }, "Invalid profile update");
    res.status(400).json({ error: "Invalid profile update", issues: parsed.error.issues });
    return;
  }

  const [current] = await db.select().from(profilesTable)
    .where(eq(profilesTable.userId, user.id)).limit(1);
  if (!current) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  const minAge = parsed.data.preferredMinAge ?? current.preferredMinAge;
  const maxAge = parsed.data.preferredMaxAge ?? current.preferredMaxAge;
  if (minAge > maxAge) {
    res.status(400).json({ error: "preferredMinAge must not exceed preferredMaxAge" });
    return;
  }

  let [profile] = await db.update(profilesTable).set(parsed.data)
    .where(eq(profilesTable.userId, user.id)).returning();

  // Recompute completion
  const photos = await db.select().from(profilePhotosTable).where(eq(profilePhotosTable.userId, user.id));
  const percent = computeCompletionPercent(profile, photos.length);
  const complete = isProfileComplete(profile, photos.length);

  [profile] = await db.update(profilesTable).set({ completionPercent: percent }).where(eq(profilesTable.userId, user.id)).returning();
  await db.update(usersTable).set({ isProfileComplete: complete, name: profile.name }).where(eq(usersTable.id, user.id));

  res.json({ ...profile, photos: photos.sort((a, b) => a.position - b.position || a.id - b.id), completionPercent: percent });
});

router.get("/profiles/completion", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, user.id)).limit(1);
  if (!profile) {
    res.json({ percent: 0, isComplete: false, missedSteps: ["Complete your profile"] });
    return;
  }
  const photos = await db.select().from(profilePhotosTable).where(eq(profilePhotosTable.userId, user.id));
  const percent = computeCompletionPercent(profile, photos.length);
  const missing = getMissingSteps(profile, photos.length);
  res.json({ percent, isComplete: missing.length === 0, missedSteps: missing });
});

router.post("/profiles/me/photos", requireAuth, receiveProfilePhoto, async (req, res): Promise<void> => {
  const user = (req as any).user;
  if (!req.file) { res.status(400).json({ error: "No photo uploaded" }); return; }

  let normalizedImage: Awaited<ReturnType<typeof normalizeProfilePhotoUpload>>;
  try {
    normalizedImage = await normalizeProfilePhotoUpload(req.file);
  } catch (error) {
    if (error instanceof ProfilePhotoImageError) {
      res.status(error.status).json({
        error: error.message,
        code: error.code,
        accepted: PROFILE_PHOTO_ACCEPTED_MIME_TYPES,
        maxBytes: MAX_PROFILE_PHOTO_BYTES,
      });
      return;
    }
    throw error;
  }

  if (normalizedImage.buffer.byteLength > MAX_PROFILE_PHOTO_BYTES) {
    res.status(413).json({
      error: "Profile photos must be 12 MB or smaller",
      code: "image_too_large",
      maxBytes: MAX_PROFILE_PHOTO_BYTES,
    });
    return;
  }

  const existingPhotoCount = await db.select({ id: profilePhotosTable.id })
    .from(profilePhotosTable)
    .where(eq(profilePhotosTable.userId, user.id));
  if (existingPhotoCount.length >= MAX_PROFILE_PHOTOS) {
    res.status(409).json({ error: `Profiles can have at most ${MAX_PROFILE_PHOTOS} photos` });
    return;
  }

  let uploadedObjectPath: string | null = null;
  try {
    // Get presigned upload URL from GCS
    const uploadUrl = await objectStorage.getObjectEntityUploadURL();
    // PUT file to GCS
    const putResp = await fetch(uploadUrl, {
      method: "PUT",
      body: normalizedImage.buffer,
      headers: { "Content-Type": normalizedImage.mime },
    });
    if (!putResp.ok) { res.status(500).json({ error: "Failed to upload to storage" }); return; }

    uploadedObjectPath = await objectStorage.trySetObjectEntityAclPolicy(uploadUrl, {
      owner: String(user.id),
      // The storage route still requires authentication. Public ACL visibility
      // lets any signed-in member render profile photos shown in discovery,
      // matches, and conversations while unauthenticated requests remain denied.
      visibility: "public",
    });

    const normalizedPhoto = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${user.id}, 7301)`);
      const existingPhotos = await tx.select().from(profilePhotosTable)
        .where(eq(profilePhotosTable.userId, user.id));
      if (existingPhotos.length >= MAX_PROFILE_PHOTOS) {
        throw new ProfilePhotoLimitError();
      }
      const [photo] = await tx.insert(profilePhotosTable).values({
        userId: user.id,
        url: uploadedObjectPath!,
        position: existingPhotos.length,
      }).returning();
      const normalizedPhotos = await normalizePhotos(tx, user.id);

      const [profile] = await tx.select().from(profilesTable)
        .where(eq(profilesTable.userId, user.id)).limit(1);
      if (profile) {
        const percent = computeCompletionPercent(profile, normalizedPhotos.length);
        const complete = isProfileComplete(profile, normalizedPhotos.length);
        await tx.update(profilesTable).set({ completionPercent: percent })
          .where(eq(profilesTable.userId, user.id));
        await tx.update(usersTable).set({ isProfileComplete: complete })
          .where(eq(usersTable.id, user.id));
      }
      return normalizedPhotos.find((item: any) => item.id === photo.id) ?? photo;
    });

    res.status(201).json(normalizedPhoto);
  } catch (err: any) {
    req.log.error({ err }, "Profile photo upload failed");
    if (uploadedObjectPath?.startsWith("/objects/")) {
      try {
        const [reference] = await db.select({ id: profilePhotosTable.id }).from(profilePhotosTable)
          .where(eq(profilePhotosTable.url, uploadedObjectPath)).limit(1);
        if (!reference) await objectStorage.deleteObjectEntityFile(uploadedObjectPath);
      } catch (cleanupError) {
        req.log.warn({ err: cleanupError }, "Could not clean up failed profile photo upload");
      }
    }
    if (err instanceof ProfilePhotoLimitError) {
      res.status(409).json({ error: `Profiles can have at most ${MAX_PROFILE_PHOTOS} photos` });
      return;
    }
    res.status(500).json({ error: err.message ?? "Photo upload failed" });
  }
});

router.delete("/profiles/me/photos/:photoId", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const photoId = parsePositiveId(req.params.photoId);
  if (photoId === null) {
    res.status(400).json({ error: "Invalid photoId" });
    return;
  }
  const [photo] = await db.select().from(profilePhotosTable).where(and(eq(profilePhotosTable.id, photoId), eq(profilePhotosTable.userId, user.id))).limit(1);
  if (!photo) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${user.id}, 7301)`);
    await tx.delete(profilePhotosTable).where(and(
      eq(profilePhotosTable.id, photoId),
      eq(profilePhotosTable.userId, user.id),
    ));
    await normalizePhotos(tx, user.id);
  });
  await updateProfileCompletion(user.id);
  if (photo.url.startsWith("/objects/")) {
    const [reference] = await db.select({ id: profilePhotosTable.id }).from(profilePhotosTable)
      .where(eq(profilePhotosTable.url, photo.url)).limit(1);
    if (!reference) {
      try {
        await objectStorage.deleteObjectEntityFile(photo.url);
      } catch (err) {
        req.log.warn({ err, photoId }, "Could not clean up deleted profile photo object");
      }
    }
  }
  res.json({ message: "Photo deleted" });
});

router.patch("/profiles/me/photos/:photoId", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const photoId = parsePositiveId(req.params.photoId);
  const body = z.strictObject({ position: z.number().int().min(0) }).safeParse(req.body);
  if (photoId === null || !body.success) {
    res.status(400).json({ error: "Invalid photo reorder request" });
    return;
  }
  const reordered = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${user.id}, 7301)`);
    const photos = await tx.select().from(profilePhotosTable)
      .where(eq(profilePhotosTable.userId, user.id));
    photos.sort((a, b) => a.position - b.position || a.id - b.id);
    const oldIndex = photos.findIndex((item) => item.id === photoId);
    if (oldIndex < 0) return null;
    if (body.data.position >= photos.length) return undefined;
    const [moved] = photos.splice(oldIndex, 1);
    photos.splice(body.data.position, 0, moved);
    for (let position = 0; position < photos.length; position += 1) {
      await tx.update(profilePhotosTable).set({ position })
        .where(and(eq(profilePhotosTable.id, photos[position].id), eq(profilePhotosTable.userId, user.id)));
    }
    const normalized = await normalizePhotos(tx, user.id);
    return normalized.find((item: any) => item.id === photoId);
  });
  if (reordered === null) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  if (reordered === undefined) {
    res.status(400).json({ error: "position is outside the photo list" });
    return;
  }
  res.json(reordered);
});

router.put("/profiles/me/photos/:photoId/primary", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const photoId = parsePositiveId(req.params.photoId);
  if (photoId === null) {
    res.status(400).json({ error: "Invalid photoId" });
    return;
  }
  const photo = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${user.id}, 7301)`);
    const [owned] = await tx.select().from(profilePhotosTable).where(and(
      eq(profilePhotosTable.id, photoId),
      eq(profilePhotosTable.userId, user.id),
    )).limit(1);
    if (!owned) return null;
    const normalized = await normalizePhotos(tx, user.id, photoId);
    return normalized.find((item: any) => item.id === photoId) ?? null;
  });
  if (!photo) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  res.json(photo);
});

router.post("/profiles/me/voice-intro", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const { url } = req.body;
  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
  }
  const [profile] = await db.update(profilesTable).set({ voiceIntroUrl: url }).where(eq(profilesTable.userId, user.id)).returning();
  const photos = await db.select().from(profilePhotosTable).where(eq(profilePhotosTable.userId, user.id));
  res.json({ ...profile, photos });
});

router.delete("/profiles/me/voice-intro", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  await db.update(profilesTable).set({ voiceIntroUrl: null }).where(eq(profilesTable.userId, user.id));
  res.json({ message: "Voice intro deleted" });
});

router.patch("/profiles/me/discovery-preferences", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const { discoveryEnabled, globalDiscovery, preferredMinAge, preferredMaxAge, preferredGender } = req.body;
  const updates: Record<string, any> = {};
  if (discoveryEnabled !== undefined) updates.discoveryEnabled = discoveryEnabled;
  if (globalDiscovery !== undefined) updates.globalDiscovery = globalDiscovery;
  if (preferredMinAge !== undefined) updates.preferredMinAge = preferredMinAge;
  if (preferredMaxAge !== undefined) updates.preferredMaxAge = preferredMaxAge;
  if (preferredGender !== undefined) updates.preferredGender = preferredGender;
  const [profile] = await db.update(profilesTable).set(updates).where(eq(profilesTable.userId, user.id)).returning();
  const photos = await db.select().from(profilePhotosTable).where(eq(profilePhotosTable.userId, user.id));
  res.json({ ...profile, photos });
});

router.get("/profiles/:userId", requireAuth, async (req, res): Promise<void> => {
  const userId = parsePositiveId(req.params.userId);
  if (userId === null) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }
  const profile = await getProfileWithPhotos(userId);
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  // Return public profile (no sensitive fields)
  const { completionPercent, preferredMinAge, preferredMaxAge, preferredGender, discoveryEnabled, globalDiscovery, ...pub } = profile as any;
  res.json(pub);
});

export default router;

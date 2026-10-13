import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { db, verificationRequestsTable, profilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import multer from "multer";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import {
  ACCEPTED_IMAGE_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  detectImageSignature,
  isAcceptedImageMime,
} from "../lib/imageValidation";

const upload = multer({
  storage: multer.memoryStorage(),
  // Single shared 5 MB limit (matches the client + imageValidation constant).
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    // First-pass filter on declared MIME. The authoritative check is the
    // magic-byte signature inspection performed in the handler.
    cb(null, isAcceptedImageMime(file.mimetype));
  },
});
const objectStorage = new ObjectStorageService();

const router: IRouter = Router();

/**
 * Multer wrapper that converts multer errors (oversize file, too many files,
 * unexpected field) into structured 413/400 responses instead of letting them
 * bubble to the generic error handler as opaque 500s.
 */
function uploadSelfie(req: Request, res: Response, next: NextFunction): void {
  upload.single("selfie")(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: "Selfie is too large",
          code: "file_too_large",
          maxBytes: MAX_UPLOAD_BYTES,
        });
        return;
      }
      res.status(400).json({
        error: "Invalid upload",
        code: "invalid_upload",
        detail: err.code,
      });
      return;
    }
    next(err);
  });
}

/**
 * Best-effort deletion of a stored selfie object. Used for both replaced
 * submissions and fresh uploads that never become database-backed requests.
 * Failures are logged, never fatal.
 */
async function deleteStoredSelfie(
  req: Request,
  objectPath: string | null | undefined,
): Promise<void> {
  if (!objectPath || !objectPath.startsWith("/objects/")) return;
  try {
    const file = await objectStorage.getObjectEntityFile(objectPath);
    await file.delete({ ignoreNotFound: true });
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return;
    req.log.warn({ err, objectPath }, "Failed to delete selfie object");
  }
}

router.post(
  "/verification/request",
  requireAuth,
  uploadSelfie,
  async (req: Request, res: Response): Promise<void> => {
    const user = (req as any).user;

    if (!req.file) {
      res.status(400).json({ error: "Selfie photo required", code: "no_file" });
      return;
    }

    // Authoritative content validation: verify the actual bytes, not just the
    // declared MIME/extension.
    const declaredMime: string = req.file.mimetype;
    const signature = detectImageSignature(req.file.buffer);
    if (!signature.ok || !isAcceptedImageMime(declaredMime)) {
      res.status(400).json({
        error: "Selfie must be a PNG, JPEG, or WebP image",
        code: "invalid_image",
        accepted: ACCEPTED_IMAGE_MIME_TYPES,
      });
      return;
    }
    // Guard against a spoofed Content-Type that disagrees with the real bytes.
    // (declaredMime is narrowed to an accepted MIME above; "image/jpg" is a
    // legacy alias that only reaches here through the multer fileFilter.)
    const rawMime: string = req.file.mimetype;
    const jpegAlias = signature.mime === "image/jpeg" && rawMime === "image/jpg";
    if (signature.mime !== rawMime && !jpegAlias) {
      res.status(400).json({
        error: "Selfie content does not match its file type",
        code: "signature_mismatch",
      });
      return;
    }

    let uploadedSelfiePath: string | null = null;
    let selfiePersisted = false;
    try {
      // Upload bytes to a fresh private object via a presigned PUT URL.
      const uploadUrl = await objectStorage.getObjectEntityUploadURL();
      const putResp = await fetch(uploadUrl, {
        method: "PUT",
        body: req.file.buffer,
        headers: { "Content-Type": signature.mime },
      });
      if (!putResp.ok) {
        req.log.error({ status: putResp.status }, "Selfie storage PUT failed");
        res.status(502).json({
          error: "Failed to upload selfie to storage",
          code: "storage_upload_failed",
        });
        return;
      }
      uploadedSelfiePath = objectStorage.normalizeObjectEntityPath(uploadUrl);

      // Bind ownership/ACL to the authenticated user so only they (and admins
      // via an authorized read) can retrieve the private selfie.
      const selfieUrl = await objectStorage.trySetObjectEntityAclPolicy(uploadUrl, {
        owner: String(user.id),
        visibility: "private",
      });
      uploadedSelfiePath = selfieUrl;

      const [existing] = await db
        .select()
        .from(verificationRequestsTable)
        .where(eq(verificationRequestsTable.userId, user.id))
        .limit(1);

      // Only replace a prior selfie that is safe to overwrite (none/rejected/
      // pending). Never clobber an already-approved verification.
      if (existing && existing.status === "approved") {
        await deleteStoredSelfie(req, uploadedSelfiePath);
        uploadedSelfiePath = null;
        res.status(409).json({
          error: "Identity is already verified",
          code: "already_verified",
        });
        return;
      }

      let request;
      if (existing) {
        const priorSelfie = existing.selfieUrl;
        [request] = await db
          .update(verificationRequestsTable)
          .set({ selfieUrl, status: "pending", adminNotes: null, reviewedAt: null })
          .where(eq(verificationRequestsTable.userId, user.id))
          .returning();
        selfiePersisted = true;
        // Persisted the new object path first; now drop the stale one.
        await deleteStoredSelfie(req, priorSelfie);
      } else {
        [request] = await db
          .insert(verificationRequestsTable)
          .values({ userId: user.id, selfieUrl, status: "pending" })
          .returning();
        selfiePersisted = true;
      }

      await db
        .update(profilesTable)
        .set({ verificationStatus: "pending" })
        .where(eq(profilesTable.userId, user.id));

      // Do not leak the private selfie object path to the client.
      res.status(201).json(sanitizeRequest(request));
    } catch (err: any) {
      if (uploadedSelfiePath && !selfiePersisted) {
        await deleteStoredSelfie(req, uploadedSelfiePath);
      }
      req.log.error({ err }, "Verification request failed");
      res.status(500).json({
        error: "Verification request failed",
        code: "internal_error",
      });
    }
  },
);

router.get(
  "/verification/status",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const user = (req as any).user;
    const [request] = await db
      .select()
      .from(verificationRequestsTable)
      .where(eq(verificationRequestsTable.userId, user.id))
      .limit(1);
    if (!request) {
      res.json({ status: "none" });
      return;
    }
    // The private selfie object path is intentionally withheld from the regular
    // client status response.
    res.json(sanitizeRequest(request));
  },
);

/**
 * Strip the private selfie object path from any client-facing payload. A signed
 * authorized read (owner/admin) goes through GET /api/storage/objects/* instead.
 */
function sanitizeRequest(request: typeof verificationRequestsTable.$inferSelect) {
  const { selfieUrl: _selfieUrl, ...rest } = request;
  return {
    ...rest,
    adminNotes: request.adminNotes ?? null,
    reviewedAt: request.reviewedAt ?? null,
  };
}

export default router;

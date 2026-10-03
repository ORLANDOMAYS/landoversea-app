import convertHeic from "heic-convert";
import {
  detectHeifSignature,
  detectImageSignature,
  type AcceptedImageMime,
} from "./imageValidation";

export const MAX_PROFILE_PHOTO_BYTES = 12 * 1024 * 1024;
export const PROFILE_PHOTO_ACCEPTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

const GENERIC_MIME_TYPES = new Set(["", "application/octet-stream"]);
const HEIF_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

export class ProfilePhotoImageError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function canonicalMime(mime: string | undefined): string {
  const normalized = mime?.trim().toLowerCase() ?? "";
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

function isCompatibleStandardMime(
  actualMime: AcceptedImageMime,
  declaredMime: string,
): boolean {
  if (GENERIC_MIME_TYPES.has(declaredMime) || declaredMime === actualMime) {
    return true;
  }

  // iOS can transcode a selected HEIC asset to JPEG while preserving the
  // original HEIC metadata. The safe JPEG magic bytes remain authoritative.
  return actualMime === "image/jpeg" && HEIF_MIME_TYPES.has(declaredMime);
}

export async function normalizeProfilePhotoUpload(file: {
  buffer: Buffer;
  mimetype?: string;
}): Promise<{ buffer: Buffer; mime: AcceptedImageMime; converted: boolean }> {
  const declaredMime = canonicalMime(file.mimetype);
  const standardSignature = detectImageSignature(file.buffer);

  if (standardSignature.ok) {
    if (!isCompatibleStandardMime(standardSignature.mime, declaredMime)) {
      throw new ProfilePhotoImageError(
        "Profile photo content does not match its file type",
        "signature_mismatch",
      );
    }
    return {
      buffer: file.buffer,
      mime: standardSignature.mime,
      converted: false,
    };
  }

  const heifMime = detectHeifSignature(file.buffer);
  if (!heifMime) {
    throw new ProfilePhotoImageError(
      "Profile photo must be a JPEG, PNG, WebP, HEIC, or HEIF image",
      "invalid_image",
    );
  }
  if (
    !GENERIC_MIME_TYPES.has(declaredMime) &&
    !declaredMime.startsWith("image/")
  ) {
    throw new ProfilePhotoImageError(
      "Profile photo content does not match its file type",
      "signature_mismatch",
    );
  }

  let converted: Buffer;
  try {
    const output = await convertHeic({
      buffer: file.buffer,
      format: "JPEG",
      quality: 0.88,
    });
    converted =
      output instanceof ArrayBuffer
        ? Buffer.from(new Uint8Array(output))
        : Buffer.from(output);
  } catch {
    throw new ProfilePhotoImageError(
      "This HEIC or HEIF photo could not be converted. Please choose another photo.",
      "heif_conversion_failed",
    );
  }

  const convertedSignature = detectImageSignature(converted);
  if (!convertedSignature.ok || convertedSignature.mime !== "image/jpeg") {
    throw new ProfilePhotoImageError(
      "The converted photo was not a valid JPEG image",
      "heif_conversion_failed",
    );
  }
  if (converted.byteLength > MAX_PROFILE_PHOTO_BYTES) {
    throw new ProfilePhotoImageError(
      "The converted photo is larger than the 12 MB limit",
      "image_too_large",
      413,
    );
  }

  return { buffer: converted, mime: "image/jpeg", converted: true };
}
// Shared image validation used by upload endpoints. We validate BOTH the
// declared MIME type and the actual file signature (magic bytes) rather than
// trusting the client-supplied extension or Content-Type alone.

// One shared upload limit. Keep in sync with the client
// (artifacts/landoversea/src/lib/uploadLimits.ts) and the multer `limits`.
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

export const ACCEPTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type AcceptedImageMime = (typeof ACCEPTED_IMAGE_MIME_TYPES)[number];

export type ImageSignatureResult =
  | { ok: true; mime: AcceptedImageMime }
  | { ok: false };

const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
]);
const HEIF_BRANDS = new Set(["mif1", "msf1"]);

export function detectHeifSignature(
  buffer: Buffer,
): "image/heic" | "image/heif" | null {
  if (!buffer || buffer.length < 12 || buffer.toString("ascii", 4, 8) !== "ftyp") {
    return null;
  }

  const declaredBoxSize = buffer.readUInt32BE(0);
  const boxEnd = Math.min(
    buffer.length,
    declaredBoxSize >= 12 ? declaredBoxSize : buffer.length,
    128,
  );
  const brands = [buffer.toString("ascii", 8, 12)];
  for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
    brands.push(buffer.toString("ascii", offset, offset + 4));
  }
  if (brands.some((brand) => HEIC_BRANDS.has(brand))) return "image/heic";
  if (brands.some((brand) => HEIF_BRANDS.has(brand))) return "image/heif";
  return null;
}

/**
 * Inspect the leading bytes of a buffer to determine whether it is a real
 * PNG / JPEG / WebP image. Returns the detected canonical MIME on success.
 */
export function detectImageSignature(buffer: Buffer): ImageSignatureResult {
  if (!buffer || buffer.length < 12) {
    return { ok: false };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { ok: true, mime: "image/png" };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ok: true, mime: "image/jpeg" };
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { ok: true, mime: "image/webp" };
  }

  return { ok: false };
}

export function isAcceptedImageMime(
  mime: string | undefined | null,
): mime is AcceptedImageMime {
  return (
    typeof mime === "string" &&
    (ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(mime)
  );
}

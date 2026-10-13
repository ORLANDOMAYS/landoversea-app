// Single shared upload contract for the client. Keep in sync with the server
// (artifacts/api-server/src/lib/imageValidation.ts).
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_UPLOAD_LABEL = "5MB";

export const ACCEPTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type AcceptedImageMime = (typeof ACCEPTED_IMAGE_MIME_TYPES)[number];

export function isAcceptedImageMime(mime: string): boolean {
  // Treat the legacy "image/jpg" alias as JPEG.
  if (mime === "image/jpg") return true;
  return (ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(mime);
}

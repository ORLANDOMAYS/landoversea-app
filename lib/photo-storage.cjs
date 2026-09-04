const PHOTO_BUCKET = "photos";
const PHOTO_LIMIT = 6;
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const ALLOWED_PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(value || "");
}

function sanitizeExtension(value) {
  const extension = String(value || "").toLowerCase().replace(/^\./, "");
  if (extension === "jpeg") return "jpg";
  return ["jpg", "png", "webp"].includes(extension) ? extension : "jpg";
}

function createPhotoPath(userId, extension, uniquePart = `${Date.now()}-${Math.random().toString(36).slice(2)}`) {
  if (!userId || userId.includes("/")) throw new Error("A valid photo owner is required.");
  return `${userId}/${uniquePart}.${sanitizeExtension(extension)}`;
}

function isOwnerPhotoPath(path, userId) {
  return isSafeOwnerPath(path) && path.split("/")[0] === userId;
}

function isSafeOwnerPath(path) {
  if (typeof path !== "string" || path.includes("\\") || /[\u0000-\u001f]/.test(path)) return false;
  const parts = path.split("/");
  return parts.length >= 2
    && /^[A-Za-z0-9_-]+$/.test(parts[0])
    && parts.every((part) => part !== "" && part !== "." && part !== "..");
}

function isSameBucketStorageUrl(value) {
  if (!isAbsoluteUrl(value)) return false;
  try {
    return new RegExp(
      `^/storage/v1/object/(?:public|sign|authenticated)/${PHOTO_BUCKET}/`
    ).test(new URL(value).pathname);
  } catch {
    return false;
  }
}

function storagePathFromValue(value) {
  if (!value) return null;
  if (!isAbsoluteUrl(value)) {
    const path = value.replace(/^\/+/, "");
    return isSafeOwnerPath(path) ? path : null;
  }
  try {
    const pathname = new URL(value).pathname;
    const match = pathname.match(
      new RegExp(`^/storage/v1/object/(?:public|sign|authenticated)/${PHOTO_BUCKET}/(.+)$`)
    );
    if (!match) return null;
    const path = decodeURIComponent(match[1]);
    return isSafeOwnerPath(path) ? path : null;
  } catch {
    return null;
  }
}

async function resolvePhotoUrl(storage, value) {
  const path = storagePathFromValue(value);
  if (!path) {
    if (isAbsoluteUrl(value) && !isSameBucketStorageUrl(value)) return value;
    throw new Error("Invalid photo storage path.");
  }
  const { data, error } = await storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error("Photo storage did not return a signed URL.");
  return data.signedUrl;
}

async function resolvePhotoRows(storage, rows) {
  return Promise.all(
    (rows || []).map(async (row) => ({ ...row, url: await resolvePhotoUrl(storage, row.url) }))
  );
}

module.exports = {
  ALLOWED_PHOTO_MIME_TYPES,
  PHOTO_BUCKET,
  PHOTO_LIMIT,
  SIGNED_URL_TTL_SECONDS,
  createPhotoPath,
  isAbsoluteUrl,
  isOwnerPhotoPath,
  isSafeOwnerPath,
  isSameBucketStorageUrl,
  resolvePhotoRows,
  resolvePhotoUrl,
  storagePathFromValue,
};
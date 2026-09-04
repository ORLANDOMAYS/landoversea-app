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
  return typeof path === "string" && path.startsWith(`${userId}/`) && !path.includes("..");
}

function storagePathFromValue(value) {
  if (!value) return null;
  if (!isAbsoluteUrl(value)) return value.replace(/^\/+/, "");
  try {
    const pathname = new URL(value).pathname;
    const marker = `/storage/v1/object/`;
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const tail = pathname.slice(markerIndex + marker.length).split("/");
    if (["public", "sign", "authenticated"].includes(tail[0])) tail.shift();
    if (tail.shift() !== PHOTO_BUCKET) return null;
    return decodeURIComponent(tail.join("/"));
  } catch {
    return null;
  }
}

async function resolvePhotoUrl(storage, value) {
  if (isAbsoluteUrl(value)) return value;
  const path = storagePathFromValue(value);
  if (!path) return value;
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
  resolvePhotoRows,
  resolvePhotoUrl,
  storagePathFromValue,
};
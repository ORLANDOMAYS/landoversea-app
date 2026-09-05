import { supabase } from "./supabase";
import { normalizeDiscoveryFilters } from "./dating-state";
const {
  ALLOWED_PHOTO_MIME_TYPES,
  PHOTO_BUCKET,
  PHOTO_LIMIT,
  SIGNED_URL_REFRESH_INTERVAL_MS,
  createPhotoPath,
  isOwnerPhotoPath,
  mergeRefreshedPhotoRows,
  mergeRefreshedProfilePhotos,
  refreshPhotoRows,
  resolvePhotoRows,
  storagePathFromValue,
} = require("../../../lib/photo-storage.cjs");

export {
  SIGNED_URL_REFRESH_INTERVAL_MS,
  mergeRefreshedPhotoRows,
  mergeRefreshedProfilePhotos,
};

/* ── Auth ─────────────────────────────────────────────────────── */

export async function getCurrentUser() {
  if (!supabase) throw new Error("Supabase is not configured.");
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) throw error;
  return user;
}

/* ── Profile ──────────────────────────────────────────────────── */

export async function getProfile(userId) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

export async function upsertProfile(userId, fields) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase
    .from("profiles")
    .upsert({ id: userId, ...fields })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/* ── Photos ───────────────────────────────────────────────────── */

export async function getPhotos(userId) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase
    .from("photos")
    .select("*")
    .eq("user_id", userId)
    .order("position");
  if (error) throw error;
  return resolvePhotoRows(supabase.storage, data ?? []);
}

export async function refreshPhotoUrls(photos) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const result = await refreshPhotoRows(supabase.storage, photos ?? []);
  return { photos: result.rows, failedCount: result.failedCount };
}

export async function refreshProfilePhotoUrls(profiles) {
  const photos = (profiles ?? []).flatMap((profile) => profile.photos ?? []);
  const result = await refreshPhotoUrls(photos);
  const refreshedById = new Map(result.photos.map((photo) => [photo.id, photo]));
  return {
    profiles: (profiles ?? []).map((profile) => ({
      ...profile,
      photos: (profile.photos ?? []).map((photo) => refreshedById.get(photo.id) ?? photo),
    })),
    failedCount: result.failedCount,
  };
}

export async function uploadPhoto(userId, uri, position) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.id !== userId) throw new Error("Photo owner mismatch.");

  const response = await fetch(uri);
  if (!response.ok) throw new Error("Unable to read the selected photo.");
  const blob = await response.blob();
  const mimeType = blob.type || "image/jpeg";
  if (!ALLOWED_PHOTO_MIME_TYPES.has(mimeType)) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  const { count, error: countError } = await supabase
    .from("photos")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (countError) throw countError;
  if ((count ?? 0) >= PHOTO_LIMIT) throw new Error("You can upload up to six photos.");
  const path = createPhotoPath(userId, mimeType.split("/")[1]);

  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, blob, { contentType: mimeType });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from("photos")
    .insert({ user_id: userId, url: path, position: Math.max(0, Math.min(position, PHOTO_LIMIT - 1)) })
    .select()
    .single();
  if (error) {
    await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    throw error;
  }
  const [resolved] = await resolvePhotoRows(supabase.storage, [data]);
  return resolved;
}

export async function deletePhoto(photoId) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const currentUser = await getCurrentUser();
  if (!currentUser) throw new Error("Authentication required.");
  const { data: photo, error: readError } = await supabase
    .from("photos")
    .select("id,user_id,url")
    .eq("id", photoId)
    .single();
  if (readError) throw readError;
  if (photo.user_id !== currentUser.id) throw new Error("You can only delete your own photos.");
  const path = storagePathFromValue(photo.url);
  if (path) {
    if (!isOwnerPhotoPath(path, currentUser.id)) throw new Error("Invalid photo storage path.");
    const { error: storageError } = await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    if (storageError) throw storageError;
  }
  const { error } = await supabase
    .from("photos")
    .delete()
    .eq("id", photoId)
    .eq("user_id", currentUser.id);
  if (error) throw error;
}

/* ── Discovery / Swipe ────────────────────────────────────────── */

export async function getDiscoverProfiles(userId, filters = {}) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const normalized = normalizeDiscoveryFilters(filters);
  const { data: swiped, error: swipedError } = await supabase
    .from("swipes")
    .select("swiped_id")
    .eq("swiper_id", userId);
  if (swipedError) throw swipedError;
  const swipedIds = (swiped ?? []).map((s) => s.swiped_id);
  swipedIds.push(userId);

  let query = supabase
    .from("profiles")
    .select("*")
    .not("id", "in", `(${swipedIds.join(",")})`)
    .not("display_name", "is", null);
  query = query.gte("age", normalized.minAge).lte("age", normalized.maxAge);
  if (normalized.gender) query = query.eq("gender", normalized.gender);
  if (normalized.location) {
    query = query.or(`city.ilike.%${normalized.location}%,country.ilike.%${normalized.location}%`);
  }
  const { data: profiles, error: profilesError } = await query.limit(20);

  if (profilesError) throw profilesError;
  if (!profiles?.length) return [];

  const ids = profiles.map((p) => p.id);
  const { data: photos, error: photosError } = await supabase
    .from("photos")
    .select("*")
    .in("user_id", ids)
    .order("position");

  if (photosError) throw photosError;
  const resolvedPhotos = await resolvePhotoRows(supabase.storage, photos ?? []);
  return profiles.map((p) => ({
    ...p,
    photos: resolvedPhotos.filter((ph) => ph.user_id === p.id),
  }));
}

export async function recordSwipe(swiperId, swipedId, direction) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase
    .from("swipes")
    .upsert({ swiper_id: swiperId, swiped_id: swipedId, direction }, { onConflict: "swiper_id,swiped_id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/* ── Matches ──────────────────────────────────────────────────── */

export async function getMatches(userId) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data: matches, error: matchesError } = await supabase
    .from("matches")
    .select("*")
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .order("created_at", { ascending: false });

  if (matchesError) throw matchesError;
  if (!matches?.length) return [];

  const otherIds = matches.map((m) =>
    m.user1_id === userId ? m.user2_id : m.user1_id
  );
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("*")
    .in("id", otherIds);

  const matchIds = matches.map((m) => m.id);
  if (profilesError) throw profilesError;
  const { data: messages, error: messagesError } = await supabase
    .from("messages")
    .select("*")
    .in("match_id", matchIds)
    .order("created_at", { ascending: false });

  if (messagesError) throw messagesError;
  return matches.map((m) => {
    const otherId = m.user1_id === userId ? m.user2_id : m.user1_id;
    const profile = (profiles ?? []).find((p) => p.id === otherId);
    const lastMessage = (messages ?? []).find((msg) => msg.match_id === m.id);
    return { ...m, profile: profile ?? null, lastMessage: lastMessage ?? null };
  });
}

export async function checkNewMatch(userId, swipedId) {
  if (!supabase) throw new Error("Supabase is not configured.");
  // Use ensure_match RPC to recover matches lost to concurrent-swipe race
  const { data: matchId, error: matchError } = await supabase.rpc("ensure_match", {
    other_user: swipedId,
  });

  if (matchError) throw matchError;
  if (!matchId) return null;

  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .eq("id", matchId)
    .single();
  if (error) throw error;
  return data;
}

/* ── Messages ─────────────────────────────────────────────────── */

export async function getMessages(matchId) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("match_id", matchId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function sendMessage(
  matchId,
  senderId,
  body,
  senderLanguage,
  translatedBody
) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase
    .from("messages")
    .insert({
      match_id: matchId,
      sender_id: senderId,
      body,
      sender_language: senderLanguage,
      translated_body: translatedBody ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export function subscribeToMessages(matchId, callback, onStatus) {
  if (!supabase) {
    onStatus?.("CHANNEL_ERROR", new Error("Supabase is not configured."));
    return { unsubscribe: () => {} };
  }
  return supabase
    .channel(`messages:${matchId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `match_id=eq.${matchId}`,
      },
      (payload) => callback(payload.new)
    )
    .subscribe((status, error) => onStatus?.(status, error));
}

/* ── Locations ────────────────────────────────────────────────── */

export async function getUserLocations(userId) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase
    .from("user_locations")
    .select("*")
    .eq("user_id", userId)
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

export async function addUserLocation(userId, city, country) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase
    .from("user_locations")
    .insert({ user_id: userId, city, country, active: true })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeUserLocation(locationId) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.from("user_locations").delete().eq("id", locationId);
  if (error) throw error;
}

/* ── Coaches ──────────────────────────────────────────────────── */

export async function getCoaches() {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase
    .from("coaches")
    .select("*")
    .eq("approved", true)
    .eq("active", true)
    .order("rating", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getCoachById(coachId) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase
    .from("coaches")
    .select("*")
    .eq("id", coachId)
    .eq("approved", true)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

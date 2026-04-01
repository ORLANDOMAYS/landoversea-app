import { supabase } from "./supabase";

/* ── Auth ─────────────────────────────────────────────────────── */

export async function getCurrentUser() {
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/* ── Profile ──────────────────────────────────────────────────── */

export async function getProfile(userId) {
  if (!supabase) return null;
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  return data;
}

export async function upsertProfile(userId, fields) {
  if (!supabase) return null;
  const { data } = await supabase
    .from("profiles")
    .upsert({ id: userId, ...fields })
    .select()
    .single();
  return data;
}

/* ── Photos ───────────────────────────────────────────────────── */

export async function getPhotos(userId) {
  if (!supabase) return [];
  const { data } = await supabase
    .from("photos")
    .select("*")
    .eq("user_id", userId)
    .order("position");
  return data ?? [];
}

export async function uploadPhoto(userId, uri, position) {
  if (!supabase) return null;
  const ext = uri.split(".").pop() || "jpg";
  const path = `${userId}/${Date.now()}.${ext}`;

  const response = await fetch(uri);
  const blob = await response.blob();

  const { error: uploadError } = await supabase.storage
    .from("photos")
    .upload(path, blob, { contentType: `image/${ext}` });
  if (uploadError) return null;

  const {
    data: { publicUrl },
  } = supabase.storage.from("photos").getPublicUrl(path);

  const { data } = await supabase
    .from("photos")
    .insert({ user_id: userId, url: publicUrl, position })
    .select()
    .single();
  return data;
}

export async function deletePhoto(photoId) {
  if (!supabase) return;
  await supabase.from("photos").delete().eq("id", photoId);
}

/* ── Discovery / Swipe ────────────────────────────────────────── */

export async function getDiscoverProfiles(userId) {
  if (!supabase) return [];
  const { data: swiped } = await supabase
    .from("swipes")
    .select("swiped_id")
    .eq("swiper_id", userId);
  const swipedIds = (swiped ?? []).map((s) => s.swiped_id);
  swipedIds.push(userId);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("*")
    .not("id", "in", `(${swipedIds.join(",")})`)
    .not("display_name", "is", null)
    .limit(20);

  if (!profiles) return [];

  const ids = profiles.map((p) => p.id);
  const { data: photos } = await supabase
    .from("photos")
    .select("*")
    .in("user_id", ids)
    .order("position");

  return profiles.map((p) => ({
    ...p,
    photos: (photos ?? []).filter((ph) => ph.user_id === p.id),
  }));
}

export async function recordSwipe(swiperId, swipedId, direction) {
  if (!supabase) return null;
  const { data } = await supabase
    .from("swipes")
    .insert({ swiper_id: swiperId, swiped_id: swipedId, direction })
    .select()
    .single();
  return data;
}

/* ── Matches ──────────────────────────────────────────────────── */

export async function getMatches(userId) {
  if (!supabase) return [];
  const { data: matches } = await supabase
    .from("matches")
    .select("*")
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .order("created_at", { ascending: false });

  if (!matches || matches.length === 0) return [];

  const otherIds = matches.map((m) =>
    m.user1_id === userId ? m.user2_id : m.user1_id
  );
  const { data: profiles } = await supabase
    .from("profiles")
    .select("*")
    .in("id", otherIds);

  const matchIds = matches.map((m) => m.id);
  const { data: messages } = await supabase
    .from("messages")
    .select("*")
    .in("match_id", matchIds)
    .order("created_at", { ascending: false });

  return matches.map((m) => {
    const otherId = m.user1_id === userId ? m.user2_id : m.user1_id;
    const profile = (profiles ?? []).find((p) => p.id === otherId);
    const lastMessage = (messages ?? []).find((msg) => msg.match_id === m.id);
    return { ...m, profile: profile ?? null, lastMessage: lastMessage ?? null };
  });
}

export async function checkNewMatch(userId, swipedId) {
  if (!supabase) return null;
  const { data } = await supabase
    .from("matches")
    .select("*")
    .or(
      `and(user1_id.eq.${userId},user2_id.eq.${swipedId}),and(user1_id.eq.${swipedId},user2_id.eq.${userId})`
    )
    .maybeSingle();
  return data;
}

/* ── Messages ─────────────────────────────────────────────────── */

export async function getMessages(matchId) {
  if (!supabase) return [];
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("match_id", matchId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

export async function sendMessage(
  matchId,
  senderId,
  body,
  senderLanguage,
  translatedBody
) {
  if (!supabase) return null;
  const { data } = await supabase
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
  return data;
}

export function subscribeToMessages(matchId, callback) {
  if (!supabase) return { unsubscribe: () => {} };
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
    .subscribe();
}

/* ── Locations ────────────────────────────────────────────────── */

export async function getUserLocations(userId) {
  if (!supabase) return [];
  const { data } = await supabase
    .from("user_locations")
    .select("*")
    .eq("user_id", userId)
    .order("created_at");
  return data ?? [];
}

export async function addUserLocation(userId, city, country) {
  if (!supabase) return null;
  const { data } = await supabase
    .from("user_locations")
    .insert({ user_id: userId, city, country, active: true })
    .select()
    .single();
  return data;
}

export async function removeUserLocation(locationId) {
  if (!supabase) return;
  await supabase.from("user_locations").delete().eq("id", locationId);
}

/* ── Verification ─────────────────────────────────────────────── */

export async function verifyProfile(userId) {
  if (!supabase) return false;
  const { error } = await supabase.rpc("verify_profile", {
    user_uuid: userId,
  });
  return !error;
}

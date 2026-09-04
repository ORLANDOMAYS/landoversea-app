"use client";

import { supabase } from "./supabase";
import type {
  Profile,
  Photo,
  Match,
  Message,
  UserLocation,
  ProfileWithPhotos,
  MatchWithProfile,
} from "./types";
import { normalizeDiscoveryFilters } from "./dating-state";

/* ── Profile ─────────────────────────────────────────────────── */

export async function getCurrentUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) throw error;
  return user;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

export async function upsertProfile(
  userId: string,
  fields: Partial<Profile>
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .upsert({ id: userId, ...fields })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/* ── Photos ──────────────────────────────────────────────────── */

export async function getPhotos(userId: string): Promise<Photo[]> {
  const { data, error } = await supabase
    .from("photos")
    .select("*")
    .eq("user_id", userId)
    .order("position");
  if (error) throw error;
  return data ?? [];
}

export async function uploadPhoto(
  userId: string,
  file: File,
  position: number
): Promise<Photo | null> {
  const path = `${userId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from("photos")
    .upload(path, file);
  if (uploadError) throw uploadError;

  const {
    data: { publicUrl },
  } = supabase.storage.from("photos").getPublicUrl(path);

  const { data, error } = await supabase
    .from("photos")
    .insert({ user_id: userId, url: publicUrl, position })
    .select()
    .single();
  if (error) {
    await supabase.storage.from("photos").remove([path]);
    throw error;
  }
  return data;
}

export async function deletePhoto(photoId: string): Promise<void> {
  const { error } = await supabase.from("photos").delete().eq("id", photoId);
  if (error) throw error;
}

/* ── Discovery / Swipe ───────────────────────────────────────── */

export async function getDiscoverProfiles(
  userId: string,
  filters: { minAge?: number; maxAge?: number; gender?: string; location?: string } = {}
): Promise<ProfileWithPhotos[]> {
  const normalized = normalizeDiscoveryFilters(filters);
  // Get IDs already swiped
  const { data: swiped, error: swipedError } = await supabase
    .from("swipes")
    .select("swiped_id")
    .eq("swiper_id", userId);
  if (swipedError) throw swipedError;
  const swipedIds = (swiped ?? []).map((s) => s.swiped_id);
  swipedIds.push(userId); // exclude self

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

  // Attach photos
  const ids = profiles.map((p) => p.id);
  const { data: photos, error: photosError } = await supabase
    .from("photos")
    .select("*")
    .in("user_id", ids)
    .order("position");

  if (photosError) throw photosError;
  return profiles.map((p) => ({
    ...p,
    photos: (photos ?? []).filter((ph) => ph.user_id === p.id),
  }));
}

export async function recordSwipe(
  swiperId: string,
  swipedId: string,
  direction: "like" | "pass" | "superlike"
) {
  const { data, error } = await supabase
    .from("swipes")
    .upsert(
      { swiper_id: swiperId, swiped_id: swipedId, direction },
      { onConflict: "swiper_id,swiped_id" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

/* ── Matches ─────────────────────────────────────────────────── */

export async function getMatches(userId: string): Promise<MatchWithProfile[]> {
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

  // Last message per match
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
    return { ...m, profile: profile ?? null, lastMessage: lastMessage ?? null } as MatchWithProfile;
  });
}

export async function checkNewMatch(
  userId: string,
  swipedId: string
): Promise<Match | null> {
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

/* ── Messages ────────────────────────────────────────────────── */

export async function getMessages(matchId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("match_id", matchId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function sendMessage(
  matchId: string,
  senderId: string,
  body: string,
  senderLanguage: string,
  translatedBody?: string
): Promise<Message | null> {
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

export function subscribeToMessages(
  matchId: string,
  callback: (msg: Message) => void,
  onStatus?: (status: string, error?: Error) => void
) {
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
      (payload) => callback(payload.new as Message)
    )
    .subscribe((status, error) => onStatus?.(status, error));
}

/* ── User Locations (Premium) ────────────────────────────────── */

export async function getUserLocations(
  userId: string
): Promise<UserLocation[]> {
  const { data, error } = await supabase
    .from("user_locations")
    .select("*")
    .eq("user_id", userId)
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

export async function addUserLocation(
  userId: string,
  city: string,
  country: string,
  lat?: number,
  lng?: number
): Promise<UserLocation | null> {
  const { data, error } = await supabase
    .from("user_locations")
    .insert({
      user_id: userId,
      city,
      country,
      latitude: lat ?? null,
      longitude: lng ?? null,
      active: true,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeUserLocation(locationId: string) {
  const { error } = await supabase.from("user_locations").delete().eq("id", locationId);
  if (error) throw error;
}

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

/* ── Profile ─────────────────────────────────────────────────── */

export async function getCurrentUser() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  return data;
}

export async function upsertProfile(
  userId: string,
  fields: Partial<Profile>
): Promise<Profile | null> {
  const { data } = await supabase
    .from("profiles")
    .upsert({ id: userId, ...fields })
    .select()
    .single();
  return data;
}

/* ── Photos ──────────────────────────────────────────────────── */

export async function getPhotos(userId: string): Promise<Photo[]> {
  const { data } = await supabase
    .from("photos")
    .select("*")
    .eq("user_id", userId)
    .order("position");
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

export async function deletePhoto(photoId: string) {
  await supabase.from("photos").delete().eq("id", photoId);
}

/* ── Discovery / Swipe ───────────────────────────────────────── */

export async function getDiscoverProfiles(
  userId: string
): Promise<ProfileWithPhotos[]> {
  // Get IDs already swiped
  const { data: swiped } = await supabase
    .from("swipes")
    .select("swiped_id")
    .eq("swiper_id", userId);
  const swipedIds = (swiped ?? []).map((s) => s.swiped_id);
  swipedIds.push(userId); // exclude self

  const { data: profiles } = await supabase
    .from("profiles")
    .select("*")
    .not("id", "in", `(${swipedIds.join(",")})`)
    .not("display_name", "is", null)
    .limit(20);

  if (!profiles) return [];

  // Attach photos
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

export async function recordSwipe(
  swiperId: string,
  swipedId: string,
  direction: "like" | "pass" | "superlike"
) {
  const { data } = await supabase
    .from("swipes")
    .insert({ swiper_id: swiperId, swiped_id: swipedId, direction })
    .select()
    .single();
  return data;
}

/* ── Matches ─────────────────────────────────────────────────── */

export async function getMatches(userId: string): Promise<MatchWithProfile[]> {
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

  // Last message per match
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
    return { ...m, profile: profile!, lastMessage: lastMessage ?? null };
  });
}

export async function checkNewMatch(
  userId: string,
  swipedId: string
): Promise<Match | null> {
  const { data } = await supabase
    .from("matches")
    .select("*")
    .or(
      `and(user1_id.eq.${userId},user2_id.eq.${swipedId}),and(user1_id.eq.${swipedId},user2_id.eq.${userId})`
    )
    .maybeSingle();
  return data;
}

/* ── Messages ────────────────────────────────────────────────── */

export async function getMessages(matchId: string): Promise<Message[]> {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("match_id", matchId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

export async function sendMessage(
  matchId: string,
  senderId: string,
  body: string,
  senderLanguage: string,
  translatedBody?: string
): Promise<Message | null> {
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

export function subscribeToMessages(
  matchId: string,
  callback: (msg: Message) => void
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
    .subscribe();
}

/* ── User Locations (Premium) ────────────────────────────────── */

export async function getUserLocations(
  userId: string
): Promise<UserLocation[]> {
  const { data } = await supabase
    .from("user_locations")
    .select("*")
    .eq("user_id", userId)
    .order("created_at");
  return data ?? [];
}

export async function addUserLocation(
  userId: string,
  city: string,
  country: string,
  lat?: number,
  lng?: number
): Promise<UserLocation | null> {
  const { data } = await supabase
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
  return data;
}

export async function removeUserLocation(locationId: string) {
  await supabase.from("user_locations").delete().eq("id", locationId);
}

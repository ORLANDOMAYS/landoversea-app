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
  Subscription,
  Coach,
  CoachSession,
  CoachReview,
  VideoCall,
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
    return { ...m, profile: profile ?? null, lastMessage: lastMessage ?? null } as MatchWithProfile;
  });
}

export async function checkNewMatch(
  userId: string,
  swipedId: string
): Promise<Match | null> {
  // Use ensure_match RPC to recover matches lost to concurrent-swipe race
  const { data: matchId } = await supabase.rpc("ensure_match", {
    other_user: swipedId,
  });

  if (!matchId) return null;

  const { data } = await supabase
    .from("matches")
    .select("*")
    .eq("id", matchId)
    .single();
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

/* ── Verification (server-side RPC) ──────────────────────────── */

export async function verifyProfile(userId: string): Promise<boolean> {
  const { error } = await supabase.rpc("verify_profile", {
    user_uuid: userId,
  });
  return !error;
}

/* ── Subscriptions (Premium) ─────────────────────────────────── */

export async function getActiveSubscription(
  userId: string
): Promise<Subscription | null> {
  const { data } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .gt("end_date", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function createSubscription(
  userId: string,
  tier: "weekly" | "monthly" | "yearly",
  price: number
): Promise<Subscription | null> {
  const now = new Date();
  let endDate: Date;
  if (tier === "weekly") {
    endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  } else if (tier === "monthly") {
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
  } else {
    endDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  }

  const { data } = await supabase
    .from("subscriptions")
    .insert({
      user_id: userId,
      tier,
      price,
      status: "active",
      start_date: now.toISOString(),
      end_date: endDate.toISOString(),
    })
    .select()
    .single();

  // Update profile premium flag
  if (data) {
    await supabase
      .from("profiles")
      .update({ premium: true, subscription_tier: tier })
      .eq("id", userId);
  }

  return data;
}

/* ── Swipe Limits ────────────────────────────────────────────── */

export async function checkSwipeLimit(): Promise<boolean> {
  const { data, error } = await supabase.rpc("check_swipe_limit");
  if (error) return true; // default allow on error
  return data as boolean;
}

export async function incrementSwipeCount(): Promise<void> {
  await supabase.rpc("increment_swipe_count");
}

/* ── Boosts ──────────────────────────────────────────────────── */

export async function activateBoost(
  durationMinutes: number = 30
): Promise<string | null> {
  const { data, error } = await supabase.rpc("activate_boost", {
    duration: durationMinutes,
  });
  if (error) return null;
  return data as string;
}

/* ── Undo Swipe ──────────────────────────────────────────────── */

export async function undoLastSwipe(): Promise<{
  success: boolean;
  undone_profile_id?: string;
  direction?: string;
  message?: string;
}> {
  const { data, error } = await supabase.rpc("undo_last_swipe");
  if (error) return { success: false, message: error.message };
  return data as { success: boolean; undone_profile_id?: string; direction?: string; message?: string };
}

/* ── Who Liked Me ────────────────────────────────────────────── */

export async function getWhoLikedMe(): Promise<
  Array<{
    id: string;
    display_name: string;
    avatar_url: string | null;
    age: number | null;
    city: string | null;
    swiped_at: string;
  }>
> {
  const { data, error } = await supabase.rpc("get_who_liked_me");
  if (error) return [];
  return (data ?? []) as Array<{
    id: string;
    display_name: string;
    avatar_url: string | null;
    age: number | null;
    city: string | null;
    swiped_at: string;
  }>;
}

/* ── Profile Views ───────────────────────────────────────────── */

export async function recordProfileView(
  viewerId: string,
  viewedId: string
): Promise<void> {
  await supabase
    .from("profile_views")
    .insert({ viewer_id: viewerId, viewed_id: viewedId });
}

/* ── Coaches ─────────────────────────────────────────────────── */

export async function getCoaches(): Promise<Coach[]> {
  const { data } = await supabase
    .from("coaches")
    .select("*")
    .eq("active", true)
    .order("rating", { ascending: false });
  return data ?? [];
}

export async function getCoach(coachId: string): Promise<Coach | null> {
  const { data } = await supabase
    .from("coaches")
    .select("*")
    .eq("id", coachId)
    .single();
  return data;
}

export async function getCoachByUserId(
  userId: string
): Promise<Coach | null> {
  const { data } = await supabase
    .from("coaches")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

export async function applyAsCoach(
  userId: string,
  fields: {
    display_name: string;
    bio: string;
    specialties: string[];
    hourly_rate: number;
    languages: string[];
  }
): Promise<Coach | null> {
  const { data } = await supabase
    .from("coaches")
    .insert({
      user_id: userId,
      ...fields,
      active: true,
      monthly_fee_paid: false,
    })
    .select()
    .single();
  return data;
}

export async function updateCoachProfile(
  coachId: string,
  fields: Partial<Coach>
): Promise<Coach | null> {
  const { data } = await supabase
    .from("coaches")
    .update(fields)
    .eq("id", coachId)
    .select()
    .single();
  return data;
}

/* ── Coach Sessions ──────────────────────────────────────────── */

export async function bookCoachSession(
  coachId: string,
  clientId: string,
  scheduledAt: string,
  durationMinutes: number,
  amount: number,
  platformFeePercent: number
): Promise<CoachSession | null> {
  const platformFee = Math.round(amount * (platformFeePercent / 100) * 100) / 100;
  const coachPayout = Math.round((amount - platformFee) * 100) / 100;

  const { data } = await supabase
    .from("coach_sessions")
    .insert({
      coach_id: coachId,
      client_id: clientId,
      scheduled_at: scheduledAt,
      duration_minutes: durationMinutes,
      amount,
      platform_fee: platformFee,
      coach_payout: coachPayout,
      status: "pending",
    })
    .select()
    .single();
  return data;
}

export async function getCoachSessions(
  coachId: string
): Promise<CoachSession[]> {
  const { data } = await supabase
    .from("coach_sessions")
    .select("*")
    .eq("coach_id", coachId)
    .order("scheduled_at", { ascending: false });
  return data ?? [];
}

export async function getClientSessions(
  clientId: string
): Promise<CoachSession[]> {
  const { data } = await supabase
    .from("coach_sessions")
    .select("*")
    .eq("client_id", clientId)
    .order("scheduled_at", { ascending: false });
  return data ?? [];
}

export async function updateSessionStatus(
  sessionId: string,
  status: "confirmed" | "completed" | "canceled"
): Promise<void> {
  await supabase
    .from("coach_sessions")
    .update({ status })
    .eq("id", sessionId);
}

/* ── Coach Reviews ───────────────────────────────────────────── */

export async function getCoachReviews(
  coachId: string
): Promise<CoachReview[]> {
  const { data } = await supabase
    .from("coach_reviews")
    .select("*")
    .eq("coach_id", coachId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function submitCoachReview(
  coachId: string,
  clientId: string,
  sessionId: string | null,
  rating: number,
  review: string
): Promise<CoachReview | null> {
  const { data } = await supabase
    .from("coach_reviews")
    .insert({
      coach_id: coachId,
      client_id: clientId,
      session_id: sessionId,
      rating,
      review,
    })
    .select()
    .single();

  // Update coach rating
  if (data) {
    const reviews = await getCoachReviews(coachId);
    const avgRating =
      reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    await supabase
      .from("coaches")
      .update({
        rating: Math.round(avgRating * 100) / 100,
        total_reviews: reviews.length,
      })
      .eq("id", coachId);
  }

  return data;
}

/* ── Video Calls ─────────────────────────────────────────────── */

export async function initiateVideoCall(
  matchId: string,
  callerId: string,
  receiverId: string
): Promise<VideoCall | null> {
  const { data } = await supabase
    .from("video_calls")
    .insert({
      match_id: matchId,
      caller_id: callerId,
      receiver_id: receiverId,
      status: "ringing",
    })
    .select()
    .single();
  return data;
}

export async function updateVideoCallStatus(
  callId: string,
  status: "active" | "ended" | "missed" | "declined",
  extras?: { started_at?: string; ended_at?: string; duration_seconds?: number }
): Promise<void> {
  await supabase
    .from("video_calls")
    .update({ status, ...extras })
    .eq("id", callId);
}

export function subscribeToVideoCalls(
  userId: string,
  callback: (call: VideoCall) => void
) {
  return supabase
    .channel(`video_calls:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "video_calls",
        filter: `receiver_id=eq.${userId}`,
      },
      (payload) => callback(payload.new as VideoCall)
    )
    .subscribe();
}

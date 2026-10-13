import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from './supabase';

export interface Profile {
  id: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  age: number | null;
  gender: string | null;
  interested_in: string | null;
  language: string;
  verified: boolean;
  premium: boolean;
  city: string | null;
  country: string | null;
  learning_languages: string[] | null;
  relationship_goal: string | null;
  interests: string[] | null;
  cultural_interests: string[] | null;
  countries_of_interest: string[] | null;
  relocation_openness: boolean | null;
  long_distance: boolean | null;
  preferred_min_age: number | null;
  preferred_max_age: number | null;
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const PROFILE_PUBLIC_SELECT = 'id,display_name,bio,avatar_url,age,gender,interested_in,language,verified,premium,city,country,learning_languages,relationship_goal,interests,cultural_interests,countries_of_interest,relocation_openness,long_distance,preferred_min_age,preferred_max_age,onboarding_completed_at,created_at,updated_at';

const MUTABLE_PROFILE_FIELDS = [
  'display_name',
  'bio',
  'age',
  'gender',
  'interested_in',
  'language',
  'city',
  'country',
  'learning_languages',
  'relationship_goal',
  'interests',
  'cultural_interests',
  'countries_of_interest',
  'relocation_openness',
  'long_distance',
  'preferred_min_age',
  'preferred_max_age',
] as const satisfies readonly (keyof Profile)[];
export interface Photo {
  id: string;
  user_id: string;
  url: string;
  position: number;
  created_at: string;
}
export interface Match {
  id: string;
  user1_id: string;
  user2_id: string;
  created_at: string;
}
export interface Message {
  id: string;
  match_id: string;
  sender_id: string;
  body: string;
  translated_body: string | null;
  sender_language: string | null;
  created_at: string;
}
export interface UserLocation {
  id: string;
  user_id: string;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
  created_at: string;
}
export type ProfileWithPhotos = Profile & { photos: Photo[] };
export type MatchWithProfile = Match & {
  profile: Profile | null;
  lastMessage: Message | null;
};

const PHOTO_BUCKET = 'photos';
const PHOTO_LIMIT = 6;
const SIGNED_URL_TTL_SECONDS = 60 * 60;
export const SIGNED_URL_REFRESH_INTERVAL_MS = SIGNED_URL_TTL_SECONDS * 750;
const ALLOWED_PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

async function requireUser(expectedId?: string) {
  const { data, error } = await getSupabase().auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Authentication required.');
  if (expectedId && data.user.id !== expectedId) throw new Error('Owner mismatch.');
  return data.user;
}

function safeStoragePath(value: string): string | null {
  let path = value;
  if (/^https?:\/\//i.test(value)) {
    try {
      const match = new URL(value).pathname.match(
        /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/photos\/(.+)$/,
      );
      if (!match) return null;
      path = decodeURIComponent(match[1]);
    } catch {
      return null;
    }
  }
  path = path.replace(/^\/+/, '');
  const parts = path.split('/');
  if (
    parts.length < 2 ||
    path.includes('\\') ||
    /[\u0000-\u001f]/.test(path) ||
    !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
    parts.some((part) => !part || part === '.' || part === '..')
  ) return null;
  return path;
}

function ownerPhotoPath(path: string, userId: string) {
  return safeStoragePath(path)?.split('/')[0] === userId;
}

async function signedPhoto(photo: Photo): Promise<Photo> {
  const path = safeStoragePath(photo.url);
  if (!path) throw new Error('Invalid photo storage path.');
  const { data, error } = await getSupabase().storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  if (!data.signedUrl) throw new Error('Photo storage did not return a signed URL.');
  return { ...photo, url: data.signedUrl };
}

async function resolvePhotos(rows: Photo[]): Promise<Photo[]> {
  const settled = await Promise.allSettled(rows.map(signedPhoto));
  const resolved = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  const failures = settled.filter((result) => result.status === 'rejected');
  if (rows.length > 0 && resolved.length === 0) {
    const reason = failures[0]?.reason;
    throw reason instanceof Error ? reason : new Error('Unable to load profile photos.');
  }
  if (failures.length > 0) {
    console.warn(`Unable to load ${failures.length} of ${rows.length} profile photos.`);
  }
  return resolved;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  await requireUser();
  const { data, error } = await getSupabase()
    .from('profiles')
    .select(PROFILE_PUBLIC_SELECT)
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export async function upsertOwnProfile(fields: Partial<Profile>): Promise<Profile> {
  const user = await requireUser();
  const ownedFields = Object.fromEntries(
    MUTABLE_PROFILE_FIELDS
      .filter((key) => fields[key] !== undefined)
      .map((key) => [key, fields[key]]),
  );
  const client = getSupabase();
  const updateExisting = () => client
    .from('profiles')
    .update(ownedFields)
    .eq('id', user.id)
    .select(PROFILE_PUBLIC_SELECT)
    .maybeSingle();
  const updated = await updateExisting();
  if (updated.error) throw updated.error;
  if (updated.data) return updated.data as Profile;

  const inserted = await client
    .from('profiles')
    .insert({ ...ownedFields, id: user.id })
    .select(PROFILE_PUBLIC_SELECT)
    .single();
  if (!inserted.error) return inserted.data as Profile;
  if (inserted.error.code !== '23505') throw inserted.error;

  const racedUpdate = await updateExisting();
  if (racedUpdate.error) throw racedUpdate.error;
  if (!racedUpdate.data) throw inserted.error;
  return racedUpdate.data as Profile;
}

export async function getPhotos(userId: string): Promise<Photo[]> {
  await requireUser();
  const { data, error } = await getSupabase()
    .from('photos').select('*').eq('user_id', userId).order('position');
  if (error) throw error;
  return resolvePhotos(data ?? []);
}

export async function uploadOwnPhoto(file: File, position: number): Promise<Photo> {
  const user = await requireUser();
  if (!ALLOWED_PHOTO_MIME_TYPES.has(file.type)) {
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  }
  const client = getSupabase();
  const { count, error: countError } = await client
    .from('photos').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
  if (countError) throw countError;
  if ((count ?? 0) >= PHOTO_LIMIT) throw new Error('You can upload up to six photos.');

  const sourceExtension = file.name.split('.').pop()?.toLowerCase();
  const extension = sourceExtension === 'jpeg' ? 'jpg' : sourceExtension;
  const safeExtension = ['jpg', 'png', 'webp'].includes(extension ?? '') ? extension : 'jpg';
  const path = `${user.id}/${crypto.randomUUID()}.${safeExtension}`;
  const { error: uploadError } = await client.storage
    .from(PHOTO_BUCKET).upload(path, file, { contentType: file.type });
  if (uploadError) throw uploadError;
  const { data, error } = await client
    .from('photos')
    .insert({ user_id: user.id, url: path, position: Math.max(0, Math.min(position, PHOTO_LIMIT - 1)) })
    .select().single();
  if (error) {
    await client.storage.from(PHOTO_BUCKET).remove([path]);
    throw error;
  }
  return signedPhoto(data);
}

export async function deleteOwnPhoto(photoId: string): Promise<void> {
  const user = await requireUser();
  const client = getSupabase();
  const { data: photo, error: readError } = await client
    .from('photos').select('id,user_id,url').eq('id', photoId).single();
  if (readError) throw readError;
  if (photo.user_id !== user.id) throw new Error('You can only delete your own photos.');
  const path = safeStoragePath(photo.url);
  if (!path || !ownerPhotoPath(path, user.id)) throw new Error('Invalid photo storage path.');
  const { error: storageError } = await client.storage.from(PHOTO_BUCKET).remove([path]);
  if (storageError) throw storageError;
  const { error } = await client.from('photos').delete().eq('id', photoId).eq('user_id', user.id);
  if (error) throw error;
}

export type DiscoveryProfileFilters = {
  minAge?: number;
  maxAge?: number;
  gender?: 'male' | 'female' | 'non_binary' | null;
  location?: string;
  countries?: string[];
  languages?: string[];
  globalMode?: boolean;
  relationshipGoal?: string | null;
  interestsOverlap?: boolean;
  verifiedOnly?: boolean;
  longDistance?: boolean;
  relocation?: boolean;
};

function safeLanguageFilter(values: unknown[]): string | null {
  const languages = values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => /^[\p{L}][\p{L} .'-]{0,49}$/u.test(value));
  if (!languages.length) return null;
  const quoted = languages.map((value) => `"${value}"`).join(',');
  return `language.in.(${quoted}),learning_languages.ov.{${quoted}}`;
}

export async function getDiscoveryProfiles(
  filters: DiscoveryProfileFilters = {},
  cursor?: string | null,
  limit = 20,
): Promise<ProfileWithPhotos[]> {
  const user = await requireUser();
  const client = getSupabase();
  const [
    { data: swiped, error: swipedError },
    { data: ownProfile, error: ownProfileError },
  ] = await Promise.all([
    client.from('swipes').select('swiped_id').eq('swiper_id', user.id),
    client.from('profiles').select('interests').eq('id', user.id).maybeSingle(),
  ]);
  if (swipedError) throw swipedError;
  if (ownProfileError) throw ownProfileError;
  const excluded = [user.id, ...(swiped ?? []).map((row) => row.swiped_id)];
  let query = client.from('profiles').select(PROFILE_PUBLIC_SELECT)
    .not('id', 'in', `(${excluded.join(',')})`)
    .not('display_name', 'is', null)
    .gte('age', Math.max(18, filters.minAge ?? 18))
    .lte('age', Math.min(99, filters.maxAge ?? 99));
  if (filters.gender) {
    const aliases = filters.gender === 'male'
      ? ['male', 'Male', 'man', 'Man']
      : filters.gender === 'female'
        ? ['female', 'Female', 'woman', 'Woman']
        : ['non_binary', 'Non_binary', 'non-binary', 'Non-binary', 'nonbinary', 'Nonbinary'];
    query = query.in('gender', aliases);
  }
  if (!filters.globalMode && filters.countries?.length) {
    query = query.in('country', filters.countries);
  } else if (!filters.globalMode && filters.location) {
    const location = filters.location.replace(/[%_,().]/g, '').trim();
    if (location) query = query.or(`city.ilike.%${location}%,country.ilike.%${location}%`);
  }
  if (filters.languages?.length) {
    const languageFilter = safeLanguageFilter(filters.languages);
    if (!languageFilter) return [];
    query = query.or(languageFilter);
  }
  if (filters.relationshipGoal) query = query.eq('relationship_goal', filters.relationshipGoal);
  if (filters.verifiedOnly) query = query.eq('verified', true);
  if (filters.longDistance) query = query.eq('long_distance', true);
  if (filters.relocation) query = query.eq('relocation_openness', true);
  if (filters.interestsOverlap) {
    if (!ownProfile?.interests?.length) return [];
    query = query.overlaps('interests', ownProfile.interests);
  }
  if (cursor) query = query.lt('id', cursor);
  const pageSize = Math.min(Math.max(Math.trunc(limit), 1), 50);
  const { data: profiles, error } = await query
    .order('id', { ascending: false })
    .limit(pageSize);
  if (error) throw error;
  if (!profiles?.length) return [];
  const { data: photos, error: photosError } = await client
    .from('photos').select('*').in('user_id', profiles.map((profile) => profile.id)).order('position');
  if (photosError) throw photosError;
  const resolved = await resolvePhotos(photos ?? []);
  return profiles.map((profile) => ({
    ...profile,
    photos: resolved.filter((photo) => photo.user_id === profile.id),
  }));
}

export async function recordSwipe(
  swipedId: string,
  direction: 'like' | 'pass' | 'superlike',
) {
  const user = await requireUser();
  if (swipedId === user.id) throw new Error('You cannot swipe on your own profile.');
  const { data, error } = await getSupabase().from('swipes').upsert(
    { swiper_id: user.id, swiped_id: swipedId, direction },
    { onConflict: 'swiper_id,swiped_id' },
  ).select().single();
  if (error) throw error;
  return data;
}

export async function ensureMatch(otherUserId: string): Promise<Match | null> {
  const user = await requireUser();
  if (otherUserId === user.id) throw new Error('Invalid match participant.');
  const client = getSupabase();
  const { data: matchId, error: rpcError } = await client.rpc('ensure_match', { other_user: otherUserId });
  if (rpcError) throw rpcError;
  if (!matchId) return null;
  const { data, error } = await client.from('matches').select('*').eq('id', matchId).single();
  if (error) throw error;
  return data;
}

export async function getMatches(): Promise<MatchWithProfile[]> {
  const user = await requireUser();
  const client = getSupabase();
  const { data: matches, error } = await client.from('matches').select('*')
    .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  if (!matches?.length) return [];
  const otherIds = matches.map((match) => match.user1_id === user.id ? match.user2_id : match.user1_id);
  const [
    { data: profiles, error: profileError },
    { data: messages, error: messageError },
    { data: photoRows, error: photoError },
  ] = await Promise.all([
    client.from('profiles').select(PROFILE_PUBLIC_SELECT).in('id', otherIds),
    client.from('messages').select('*').in('match_id', matches.map((match) => match.id))
      .order('created_at', { ascending: false }),
    client.from('photos').select('*').in('user_id', otherIds).order('position'),
  ]);
  if (profileError) throw profileError;
  if (messageError) throw messageError;
  if (photoError) throw photoError;
  const photos = await resolvePhotos(photoRows ?? []);
  return matches.map((match) => {
    const otherId = match.user1_id === user.id ? match.user2_id : match.user1_id;
    const profile = (profiles ?? []).find((candidate) => candidate.id === otherId);
    return {
      ...match,
      profile: profile ? {
        ...profile,
        photos: photos.filter((photo) => photo.user_id === otherId),
      } : null,
      lastMessage: (messages ?? []).find((message) => message.match_id === match.id) ?? null,
    };
  });
}

export async function getMessages(matchId: string): Promise<Message[]> {
  await requireUser();
  const { data, error } = await getSupabase().from('messages').select('*')
    .eq('match_id', matchId).order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function sendMessage(
  matchId: string,
  body: string,
  senderLanguage: string,
  translatedBody?: string,
): Promise<Message> {
  const user = await requireUser();
  const { data, error } = await getSupabase().from('messages').insert({
    match_id: matchId,
    sender_id: user.id,
    body,
    sender_language: senderLanguage,
    translated_body: translatedBody ?? null,
  }).select().single();
  if (error) throw error;
  return data;
}

export interface TextTranslation {
  originalContent: string;
  translatedContent: string;
  sourceLanguage: string | null;
  targetLanguage: string;
  status: 'done' | 'same_language';
}

export function subscribeToMessages(
  matchId: string,
  onMessage: (message: Message) => void,
  onStatus?: (status: string, error?: Error) => void,
): RealtimeChannel {
  return getSupabase().channel(`messages:${matchId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `match_id=eq.${matchId}`,
    }, (payload) => onMessage(payload.new as Message))
    .subscribe((status, error) => onStatus?.(status, error));
}

export async function unsubscribe(channel: RealtimeChannel): Promise<void> {
  await getSupabase().removeChannel(channel);
}

export async function getOwnLocations(): Promise<UserLocation[]> {
  const user = await requireUser();
  const { data, error } = await getSupabase().from('user_locations').select('*')
    .eq('user_id', user.id).order('created_at');
  if (error) throw error;
  return data ?? [];
}

export async function addOwnLocation(
  city: string,
  country: string,
  latitude?: number,
  longitude?: number,
): Promise<UserLocation> {
  const user = await requireUser();
  const { data, error } = await getSupabase().from('user_locations').insert({
    user_id: user.id,
    city,
    country,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    active: true,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function removeOwnLocation(locationId: string): Promise<void> {
  const user = await requireUser();
  const { error } = await getSupabase().from('user_locations').delete()
    .eq('id', locationId).eq('user_id', user.id);
  if (error) throw error;
}

export async function getApprovedCoaches<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<T[]> {
  await requireUser();
  const { data, error } = await getSupabase().from('coaches').select('*')
    .eq('approved', true).eq('active', true).order('rating', { ascending: false });
  if (error) throw error;
  return (data ?? []) as T[];
}

export async function getApprovedCoach<T extends Record<string, unknown> = Record<string, unknown>>(
  coachId: string,
): Promise<T | null> {
  await requireUser();
  const { data, error } = await getSupabase().from('coaches').select('*')
    .eq('id', coachId).eq('approved', true).eq('active', true).maybeSingle();
  if (error) throw error;
  return data as T | null;
}
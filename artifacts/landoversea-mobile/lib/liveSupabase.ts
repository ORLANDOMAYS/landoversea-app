import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, supabaseConfigurationError } from './supabase';
import { useAuth } from './AuthProvider';
import { PROFILE_PUBLIC_SELECT } from './profileColumns';

const PHOTO_BUCKET = 'photos';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requireClient = () => {
  if (!supabase) throw new Error(supabaseConfigurationError);
  return supabase;
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

const DISCOVERY_GENDER_ALIASES: Record<string, string[]> = {
  male: ['male', 'man', 'Male', 'Man', 'MALE', 'MAN'],
  female: ['female', 'woman', 'Female', 'Woman', 'FEMALE', 'WOMAN'],
  non_binary: [
    'non_binary', 'non-binary', 'non binary', 'nonbinary',
    'Non_binary', 'Non-binary', 'Non binary', 'Nonbinary',
    'NON_BINARY', 'NON-BINARY', 'NON BINARY', 'NONBINARY',
  ],
};

function canonicalProfileGender(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'man') return 'male';
  if (normalized === 'woman') return 'female';
  if (normalized === 'nonbinary') return 'non_binary';
  return normalized;
}

export function isSupabaseUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function requireUuid(value: unknown, label: string): string {
  if (!isSupabaseUuid(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

const storagePath = (value: string) => {
  if (!/^https?:\/\//i.test(value)) return value.replace(/^\/+/, '');
  const match = new URL(value).pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/photos\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
};

async function signedPhoto(value: string | null): Promise<string | null> {
  if (!value) return null;
  const path = storagePath(value);
  if (!path) return value;
  const { data, error } = await requireClient().storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

async function photosFor(userIds: string[]) {
  if (!userIds.length) return [];
  const { data, error } = await requireClient().from('photos').select('*').in('user_id', userIds).order('position');
  if (error) throw error;
  return Promise.all((data ?? []).map(async row => ({
    ...row,
    userId: row.user_id,
    isPrimary: row.position === 0,
    url: await signedPhoto(row.url),
  })));
}

const mapProfile = (row: any, photos: any[] = []) => ({
  ...row,
  id: row.id,
  userId: row.id,
  name: row.display_name ?? '',
  displayName: row.display_name ?? '',
  updatedAt: row.updated_at,
  relationshipGoal: row.relationship_goal,
  learningLanguages: row.learning_languages,
  culturalInterests: row.cultural_interests,
  countriesOfInterest: row.countries_of_interest,
  preferredMinAge: row.preferred_min_age,
  preferredMaxAge: row.preferred_max_age,
  longDistance: row.long_distance,
  relocationOpenness: row.relocation_openness,
  photos: photos.filter(photo => photo.user_id === row.id),
});

export async function getLiveProfile(userId: string) {
  requireUuid(userId, 'user ID');
  const [{ data, error }, photos] = await Promise.all([
    requireClient().from('profiles').select(PROFILE_PUBLIC_SELECT).eq('id', userId).maybeSingle(),
    photosFor([userId]),
  ]);
  if (error) throw error;
  return data ? mapProfile(data, photos) : null;
}

export function useLiveMyProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['supabase', 'profile', user?.id],
    queryFn: () => getLiveProfile(user!.id),
    enabled: !!user,
  });
}

export function useLiveUpdateProfile() {
  const { user, refreshProfile } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ data }: { data: Record<string, any> }) => {
      if (!user) throw new Error('Authentication required.');
      const fields: Record<string, any> = {};
      const mapping: Record<string, string> = {
        name: 'display_name', bio: 'bio', age: 'age', gender: 'gender', city: 'city',
        country: 'country', primaryLanguage: 'language', lookingFor: 'interested_in',
        learningLanguages: 'learning_languages', relationshipGoal: 'relationship_goal',
        interests: 'interests', culturalInterests: 'cultural_interests',
        countriesOfInterest: 'countries_of_interest', relocationOpenness: 'relocation_openness',
        longDistanceOpenness: 'long_distance', preferredMinAge: 'preferred_min_age',
        preferredMaxAge: 'preferred_max_age',
      };
      for (const [key, value] of Object.entries(data)) {
        if (mapping[key]) {
          fields[mapping[key]] = key === 'gender' || key === 'lookingFor'
            ? canonicalProfileGender(value)
            : value;
        }
      }
      const client = requireClient();
      const updateExisting = () => client
        .from('profiles')
        .update(fields)
        .eq('id', user.id)
        .select('id')
        .maybeSingle();
      const updated = await updateExisting();
      if (updated.error) throw updated.error;
      if (!updated.data) {
        const inserted = await client.from('profiles').insert({ id: user.id, ...fields });
        if (inserted.error?.code === '23505') {
          const racedUpdate = await updateExisting();
          if (racedUpdate.error) throw racedUpdate.error;
          if (!racedUpdate.data) throw inserted.error;
        } else if (inserted.error) {
          throw inserted.error;
        }
      }
      await refreshProfile();
      await qc.invalidateQueries({ queryKey: ['supabase', 'profile', user.id] });
      return getLiveProfile(user.id);
    },
  });
}

export function useLivePhotoMutations() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['supabase', 'profile', user?.id] });
  const upload = useMutation({
    mutationFn: async ({ data }: any) => {
      if (!user) throw new Error('Authentication required.');
      const photo = data.photo;
      const response = await fetch(photo.uri);
      if (!response.ok) throw new Error('Unable to read the selected photo.');
      const blob = await response.blob();
      const mime = photo.type || blob.type || 'image/jpeg';
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('Unsupported photo type.');
      const { count, error: countError } = await requireClient().from('photos')
        .select('id', { count: 'exact', head: true }).eq('user_id', user.id);
      if (countError) throw countError;
      if ((count ?? 0) >= 6) throw new Error('You can upload up to six photos.');
      const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
      const { error: uploadError } = await requireClient().storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: mime });
      if (uploadError) throw uploadError;
      const { error } = await requireClient().from('photos').insert({ user_id: user.id, url: path, position: count ?? 0 });
      if (error) {
        await requireClient().storage.from(PHOTO_BUCKET).remove([path]);
        throw error;
      }
    },
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: async ({ photoId }: any) => {
      if (!user) throw new Error('Authentication required.');
      requireUuid(photoId, 'photo ID');
      const { data, error } = await requireClient().from('photos').select('url,user_id').eq('id', photoId).single();
      if (error) throw error;
      if (data.user_id !== user.id) throw new Error('Photo owner mismatch.');
      const path = storagePath(data.url);
      if (!path?.startsWith(`${user.id}/`)) throw new Error('Invalid photo path.');
      const { error: storageError } = await requireClient().storage.from(PHOTO_BUCKET).remove([path]);
      if (storageError) throw storageError;
      const { error: deleteError } = await requireClient().from('photos').delete().eq('id', photoId).eq('user_id', user.id);
      if (deleteError) throw deleteError;
    },
    onSuccess: invalidate,
  });
  const reorder = useMutation({
    mutationFn: async ({ photoId, data }: any) => {
      if (!user) throw new Error('Authentication required.');
      requireUuid(photoId, 'photo ID');
      const { error } = await requireClient().from('photos').update({ position: data.position })
        .eq('id', photoId).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const primary = useMutation({
    mutationFn: async ({ photoId }: any) => {
      if (!user) throw new Error('Authentication required.');
      requireUuid(photoId, 'photo ID');
      const { data: rows, error } = await requireClient().from('photos').select('id,position').eq('user_id', user.id);
      if (error) throw error;
      const selected = rows?.find(row => row.id === photoId);
      const current = rows?.find(row => row.position === 0);
      if (!selected) throw new Error('Photo not found.');
      if (current && current.id !== selected.id) {
        const first = await requireClient().from('photos').update({ position: selected.position }).eq('id', current.id).eq('user_id', user.id);
        if (first.error) throw first.error;
      }
      const second = await requireClient().from('photos').update({ position: 0 }).eq('id', selected.id).eq('user_id', user.id);
      if (second.error) throw second.error;
    },
    onSuccess: invalidate,
  });
  return { upload, remove, reorder, primary };
}

export async function getLiveDiscovery(
  userId: string,
  filters: any,
  cursor?: string | null,
  limit = 20,
) {
  requireUuid(userId, 'user ID');
  const [
    { data: swipes, error: swipeError },
    { data: ownProfile, error: ownProfileError },
  ] = await Promise.all([
    requireClient().from('swipes').select('swiped_id').eq('swiper_id', userId),
    requireClient().from('profiles').select('interests').eq('id', userId).maybeSingle(),
  ]);
  if (swipeError) throw swipeError;
  if (ownProfileError) throw ownProfileError;
  const excluded = [userId, ...(swipes ?? []).map(row => row.swiped_id)];
  let query: any = requireClient().from('profiles').select(PROFILE_PUBLIC_SELECT).not('display_name', 'is', null)
    .gte('age', filters?.minAge ?? 18).lte('age', filters?.maxAge ?? 100);
  if (excluded.length) query = query.not('id', 'in', `(${excluded.join(',')})`);
  if (filters?.gender) {
    const genderAliases = DISCOVERY_GENDER_ALIASES[filters.gender];
    if (!genderAliases) return [];
    query = query.in('gender', genderAliases);
  }
  if (!filters?.globalMode && filters?.countries?.length) query = query.in('country', filters.countries);
  if (filters?.languages?.length) {
    const languageFilter = safeLanguageFilter(filters.languages);
    if (!languageFilter) return [];
    query = query.or(languageFilter);
  }
  if (filters?.relationshipGoal) query = query.eq('relationship_goal', filters.relationshipGoal);
  if (filters?.verifiedOnly) query = query.eq('verified', true);
  if (filters?.longDistance) query = query.eq('long_distance', true);
  if (filters?.relocation) query = query.eq('relocation_openness', true);
  if (filters?.interestsOverlap) {
    if (!ownProfile?.interests?.length) return [];
    query = query.overlaps('interests', ownProfile.interests);
  }
  if (cursor) query = query.lt('id', cursor);
  const pageSize = Math.min(Math.max(Math.trunc(limit), 1), 50);
  const { data, error } = await query.order('id', { ascending: false }).limit(pageSize);
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, any> & { id: string }>;
  const photos = await photosFor(rows.map(row => row.id));
  return rows.map(row => ({ userId: row.id, profile: mapProfile(row, photos) }));
}

export function useLiveDiscovery(filters: any) {
  const { user } = useAuth();
  const pageSize = 20;
  const query = useInfiniteQuery({
    queryKey: ['supabase', 'discover', user?.id, filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => getLiveDiscovery(user!.id, filters, pageParam, pageSize),
    getNextPageParam: (lastPage) => (
      lastPage.length === pageSize
        ? lastPage[lastPage.length - 1]?.userId
        : undefined
    ),
    enabled: !!user,
    staleTime: 15_000,
  });
  return {
    ...query,
    data: query.data?.pages.flatMap(page => page),
  };
}

export function useLiveSwipe() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { targetUserId: string; action: 'like' | 'pass' | 'superlike' }) => {
      if (!user) throw new Error('Authentication required.');
      const targetUserId = requireUuid(input.targetUserId, 'target user ID');
      const direction = input.action;
      const { error } = await requireClient().from('swipes')
        .upsert({ swiper_id: user.id, swiped_id: targetUserId, direction }, { onConflict: 'swiper_id,swiped_id' });
      if (error) throw error;
      if (direction === 'pass') return { isMatch: false };
      const { data: matchId, error: matchError } = await requireClient().rpc('ensure_match', { other_user: targetUserId });
      if (matchError) throw matchError;
      return { isMatch: !!matchId, conversationId: matchId ?? undefined };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['supabase', 'matches'] });
    },
  });
}

export async function getLiveMatches(userId: string) {
  requireUuid(userId, 'user ID');
  const { data, error } = await requireClient().from('matches').select('*')
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`).order('created_at', { ascending: false });
  if (error) throw error;
  const otherIds = (data ?? []).map(row => row.user1_id === userId ? row.user2_id : row.user1_id);
  const [{ data: profiles, error: profileError }, photos] = await Promise.all([
    otherIds.length
      ? requireClient().from('profiles').select(PROFILE_PUBLIC_SELECT).in('id', otherIds)
      : Promise.resolve({ data: [], error: null }),
    photosFor(otherIds),
  ]);
  if (profileError) throw profileError;
  const matchIds = (data ?? []).map(row => row.id);
  const messages = matchIds.length
    ? await requireClient().from('messages').select('*').in('match_id', matchIds).order('created_at', { ascending: false })
    : { data: [], error: null };
  if (messages.error) throw messages.error;
  return (data ?? []).map(row => {
    const otherId = row.user1_id === userId ? row.user2_id : row.user1_id;
    const profile = mapProfile((profiles ?? []).find(item => item.id === otherId) ?? {}, photos);
    const last = (messages.data ?? []).find(item => item.match_id === row.id);
    return {
      id: row.id, conversationId: row.id, createdAt: row.created_at, otherUser: profile,
      type: 'direct', participants: [profile], title: null, unreadCount: 0,
      lastMessage: last ? { ...last, content: last.body, createdAt: last.created_at } : null,
    };
  });
}

export function useLiveMatches() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['supabase', 'matches', user?.id],
    queryFn: () => getLiveMatches(user!.id),
    enabled: !!user,
    staleTime: 10_000,
  });
}

export async function getLiveMessages(matchId: string) {
  requireUuid(matchId, 'match ID');
  const { data, error } = await requireClient().from('messages').select('*').eq('match_id', matchId).order('created_at');
  if (error) throw error;
  return (data ?? []).map(row => ({
    ...row, conversationId: row.match_id, senderId: row.sender_id, content: row.body,
    detectedLanguage: row.sender_language, createdAt: row.created_at,
  }));
}

export async function sendLiveMessage(matchId: string, senderId: string, body: string, language: string) {
  requireUuid(matchId, 'match ID');
  requireUuid(senderId, 'sender ID');
  const { data, error } = await requireClient().from('messages').insert({
    match_id: matchId, sender_id: senderId, body, sender_language: language,
  }).select().single();
  if (error) throw error;
  return { ...data, conversationId: data.match_id, senderId: data.sender_id, content: data.body, createdAt: data.created_at };
}

export function subscribeLiveMessages(matchId: string, onMessage: (message: any) => void, onReconnect: () => void): RealtimeChannel {
  requireUuid(matchId, 'match ID');
  return requireClient().channel(`messages:${matchId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `match_id=eq.${matchId}` },
      payload => onMessage({
        ...payload.new, conversationId: payload.new.match_id, senderId: payload.new.sender_id,
        content: payload.new.body, createdAt: payload.new.created_at,
      }))
    .subscribe(status => {
      if (status === 'SUBSCRIBED') onReconnect();
    });
}

export function useLiveConversation(matchId: string, enabled = true) {
  const { user } = useAuth();
  const matches = useLiveMatches();
  const conversation = matches.data?.find(item => String(item.id) === matchId);
  const messages = useQuery({
    queryKey: ['supabase', 'messages', matchId],
    queryFn: () => getLiveMessages(matchId),
    enabled: enabled && !!user,
    staleTime: 5_000,
  });
  return { conversation, matches, messages, user };
}

export async function getLiveCoaches() {
  const { data, error } = await requireClient().from('coaches').select('*')
    .eq('approved', true).eq('active', true).order('rating', { ascending: false });
  if (error) throw error;
  return Promise.all((data ?? []).map(async row => ({
    ...row, displayName: row.display_name, photoUrl: await signedPhoto(row.avatar_url),
    ratesPerHour: row.hourly_rate,
    reviewCount: row.total_reviews, isVerified: row.verified,
  })));
}

export function useLiveCoaches() {
  return useQuery({ queryKey: ['supabase', 'coaches'], queryFn: getLiveCoaches, staleTime: 30_000 });
}

export function useLiveCoach(id: string, enabled = true) {
  return useQuery({
    queryKey: ['supabase', 'coaches', id],
    enabled,
    queryFn: async () => {
      requireUuid(id, 'coach ID');
      const { data, error } = await requireClient().from('coaches').select('*').eq('id', id)
        .eq('approved', true).eq('active', true).maybeSingle();
      if (error) throw error;
      return data ? {
        ...data, displayName: data.display_name, photoUrl: await signedPhoto(data.avatar_url),
        ratesPerHour: data.hourly_rate,
        reviewCount: data.total_reviews, isVerified: data.verified,
      } : null;
    },
  });
}

export async function getOwnedLocations(userId: string) {
  requireUuid(userId, 'user ID');
  const { data, error } = await requireClient().from('user_locations').select('*')
    .eq('user_id', userId).order('created_at');
  if (error) throw error;
  return data ?? [];
}

export function useLiveLocations() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['supabase', 'locations', user?.id],
    queryFn: () => getOwnedLocations(user!.id),
    enabled: !!user,
  });
  const add = useMutation({
    mutationFn: async ({ city, country }: { city: string; country: string }) => {
      if (!user) throw new Error('Authentication required.');
      const { data, error } = await requireClient().from('user_locations')
        .insert({ user_id: user.id, city: city.trim(), country: country.trim(), active: true })
        .select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supabase', 'locations', user?.id] }),
  });
  const remove = useMutation({
    mutationFn: async (locationId: string) => {
      if (!user) throw new Error('Authentication required.');
      requireUuid(locationId, 'location ID');
      const { error } = await requireClient().from('user_locations').delete()
        .eq('id', locationId).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supabase', 'locations', user?.id] }),
  });
  return { query, add, remove };
}
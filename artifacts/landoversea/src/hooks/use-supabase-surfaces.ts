import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authenticatedFetch, useAuth } from '@/lib/auth';
import {
  addOwnLocation,
  deleteOwnPhoto,
  ensureMatch,
  getApprovedCoaches,
  getApprovedCoach,
  getDiscoveryProfiles,
  getMatches,
  getMessages,
  getOwnLocations,
  getPhotos,
  getProfile,
  recordSwipe,
  removeOwnLocation,
  sendMessage,
  SIGNED_URL_REFRESH_INTERVAL_MS,
  uploadOwnPhoto,
  upsertOwnProfile,
  type ProfileWithPhotos,
} from '@/lib/supabase-api';
import type { DiscoverFilters } from '@workspace/api-client-react';
import { toSupabaseDiscoveryFilters } from '@/lib/discover-filters';

export const liveKeys = {
  profile: (id?: string) => ['supabase', 'profile', id] as const,
  discovery: ['supabase', 'discovery'] as const,
  matches: ['supabase', 'matches'] as const,
  messages: (id: string) => ['supabase', 'messages', id] as const,
  locations: ['supabase', 'locations'] as const,
  coaches: ['supabase', 'coaches', 'approved'] as const,
  coachBridge: (id: string) => ['api', 'coaches', 'resolve', id] as const,
};

export class CoachBridgeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'CoachBridgeError';
  }
}

const signedPhotoQueryTiming = {
  staleTime: SIGNED_URL_REFRESH_INTERVAL_MS,
  refetchInterval: SIGNED_URL_REFRESH_INTERVAL_MS,
  refetchOnWindowFocus: true,
} as const;

export function useResolvedLocalCoachId(coachIdentifier?: string) {
  return useQuery({
    queryKey: liveKeys.coachBridge(coachIdentifier ?? ''),
    enabled: Boolean(coachIdentifier),
    retry: (failureCount, error) =>
      error instanceof CoachBridgeError && error.status < 500
        ? false
        : failureCount < 2,
    queryFn: async () => {
      if (!coachIdentifier) throw new Error('A coach identifier is required.');
      const response = await authenticatedFetch(
        `${import.meta.env.BASE_URL}api/coaches/resolve/${encodeURIComponent(coachIdentifier)}`,
      );
      const body = await response.json().catch(() => ({})) as {
        coachId?: unknown;
        error?: unknown;
        code?: unknown;
      };
      if (!response.ok) {
        throw new CoachBridgeError(
          typeof body.error === 'string' ? body.error : 'Unable to resolve this coach.',
          response.status,
          typeof body.code === 'string' ? body.code : undefined,
        );
      }
      if (!Number.isSafeInteger(body.coachId) || (body.coachId as number) <= 0) {
        throw new CoachBridgeError('The coach resolver returned an invalid response.', 502);
      }
      return body.coachId as number;
    },
  });
}

function uiProfile(profile: ProfileWithPhotos) {
  return {
    ...profile,
    userId: profile.id,
    name: profile.display_name ?? '',
    primaryLanguage: profile.language,
    isVerified: profile.verified,
    isPremium: profile.premium,
    lookingFor: profile.interested_in,
    interests: profile.interests ?? [],
    otherLanguages: profile.learning_languages ?? [],
    culturalInterests: profile.cultural_interests ?? [],
    countriesOfInterest: profile.countries_of_interest ?? [],
    relationshipGoal: profile.relationship_goal ?? '',
    relocationOpenness: profile.relocation_openness ?? false,
    longDistanceOpenness: profile.long_distance ?? false,
    preferredMinAge: profile.preferred_min_age,
    preferredMaxAge: profile.preferred_max_age,
    voiceIntroUrl: null as string | null,
    photos: profile.photos.map((photo) => ({ ...photo, isPrimary: photo.position === 0 })),
  };
}

export function useLiveProfile(userId?: string) {
  const auth = useAuth();
  const id = userId ?? auth.user?.id;
  return useQuery({
    queryKey: liveKeys.profile(id),
    enabled: Boolean(id),
    queryFn: async () => {
      if (!id) throw new Error('Authentication required.');
      const [profile, photos] = await Promise.all([getProfile(id), getPhotos(id)]);
      return profile ? uiProfile({ ...profile, photos }) : null;
    },
    ...signedPhotoQueryTiming,
  });
}

export function useLiveUpdateProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ data }: { data: Record<string, unknown> }) => {
      const fields: Record<string, unknown> = {};
      const mapping: Record<string, string> = {
        name: 'display_name',
        bio: 'bio',
        age: 'age',
        gender: 'gender',
        lookingFor: 'interested_in',
        primaryLanguage: 'language',
        city: 'city',
        country: 'country',
        otherLanguages: 'learning_languages',
        learningLanguages: 'learning_languages',
        relationshipGoal: 'relationship_goal',
        interests: 'interests',
        culturalInterests: 'cultural_interests',
        countriesOfInterest: 'countries_of_interest',
        relocationOpenness: 'relocation_openness',
        longDistanceOpenness: 'long_distance',
        preferredMinAge: 'preferred_min_age',
        preferredMaxAge: 'preferred_max_age',
      };
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && mapping[key]) {
          fields[mapping[key]] = value;
        }
      }
      return upsertOwnProfile(fields);
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['supabase', 'profile'] }),
        client.invalidateQueries({ queryKey: ['supabase', 'profile-gate'] }),
      ]);
    },
  });
}

export function useLiveUploadPhoto() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ file, position = 0 }: { file: File; position?: number }) => uploadOwnPhoto(file, position),
    onSuccess: () => client.invalidateQueries({ queryKey: ['supabase', 'profile'] }),
  });
}

export function useLiveDeletePhoto() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ photoId }: { photoId: string }) => deleteOwnPhoto(photoId),
    onSuccess: () => client.invalidateQueries({ queryKey: ['supabase', 'profile'] }),
  });
}

export function useLiveDiscovery(filters?: DiscoverFilters) {
  const pageSize = 20;
  const supabaseFilters = filters
    ? toSupabaseDiscoveryFilters(filters)
    : undefined;
  const query = useInfiniteQuery({
    queryKey: [...liveKeys.discovery, supabaseFilters],
    enabled: Boolean(supabaseFilters),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      if (!supabaseFilters) {
        throw new Error('Discovery filters must load before live discovery.');
      }
      return (await getDiscoveryProfiles(supabaseFilters, pageParam, pageSize)).map((profile) => ({
      userId: profile.id,
      profile: uiProfile(profile),
      sharedLanguages: [],
      sharedInterests: [],
      distanceKm: null,
      }));
    },
    getNextPageParam: (lastPage) => (
      lastPage.length === pageSize
        ? lastPage[lastPage.length - 1]?.userId
        : undefined
    ),
    ...signedPhotoQueryTiming,
  });
  return {
    ...query,
    data: query.data?.pages.flatMap((page) => page),
  };
}

export function useLiveSwipe() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ targetUserId, action }: { targetUserId: string; action: 'like' | 'pass' | 'superlike' }) => {
      await recordSwipe(targetUserId, action);
      const match = action === 'pass' ? null : await ensureMatch(targetUserId);
      return { isMatch: Boolean(match), conversationId: match?.id };
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: liveKeys.matches });
    },
  });
}

export function useLiveMatches() {
  return useQuery({
    queryKey: liveKeys.matches,
    queryFn: async () => (await getMatches()).map((match) => {
      const otherUser = match.profile
        ? uiProfile({ ...match.profile, photos: (match.profile as ProfileWithPhotos).photos ?? [] })
        : null;
      return {
      ...match,
      createdAt: match.created_at,
      conversationId: match.id,
      otherUser,
      participants: otherUser ? [otherUser] : [],
      unreadCount: 0,
      isPinned: false,
      lastMessage: match.lastMessage ? {
        ...match.lastMessage,
        content: match.lastMessage.body,
        createdAt: match.lastMessage.created_at,
      } : null,
    };
    }),
    ...signedPhotoQueryTiming,
  });
}

export function useLiveMessages(matchId: string) {
  return useQuery({
    queryKey: liveKeys.messages(matchId),
    enabled: Boolean(matchId),
    queryFn: async () => (await getMessages(matchId)).map((message) => ({
      ...message,
      senderId: message.sender_id,
      content: message.body,
      createdAt: message.created_at,
      contentType: 'text',
      translations: message.translated_body ? [{
        targetLanguage: null,
        sourceLanguage: message.sender_language,
        translatedContent: message.translated_body,
        status: 'done',
        isStoredTranslation: true,
      }] : [],
    })),
  });
}

export function useLiveSendMessage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ matchId, body, language, translatedBody }: { matchId: string; body: string; language: string; translatedBody?: string }) => {
      const message = await sendMessage(matchId, body, language, translatedBody);
      return {
        ...message,
        senderId: message.sender_id,
        content: message.body,
        createdAt: message.created_at,
        contentType: 'text',
        translations: message.translated_body ? [{
          targetLanguage: null,
          sourceLanguage: message.sender_language,
          translatedContent: message.translated_body,
          status: 'done',
          isStoredTranslation: true,
        }] : [],
      };
    },
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: liveKeys.messages(variables.matchId) });
      client.invalidateQueries({ queryKey: liveKeys.matches });
    },
  });
}

export function useLiveLocations() {
  return useQuery({ queryKey: liveKeys.locations, queryFn: getOwnLocations });
}
export function useLiveAddLocation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ city, country, latitude, longitude }: any) => addOwnLocation(city, country, latitude, longitude),
    onSuccess: () => client.invalidateQueries({ queryKey: liveKeys.locations }),
  });
}
export function useLiveRemoveLocation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => removeOwnLocation(id),
    onSuccess: () => client.invalidateQueries({ queryKey: liveKeys.locations }),
  });
}

export function useApprovedCoaches() {
  return useQuery({
    queryKey: liveKeys.coaches,
    queryFn: async () => (await getApprovedCoaches<any>()).map((coach) => ({
      ...coach,
      displayName: coach.display_name,
      photoUrl: coach.avatar_url,
      ratesPerHour: coach.hourly_rate,
      reviewCount: coach.total_reviews,
      isVerified: coach.verified,
    })),
  });
}
export function useApprovedCoach(id: string) {
  return useQuery({
    queryKey: [...liveKeys.coaches, id],
    enabled: Boolean(id),
    queryFn: async () => {
      const coach = await getApprovedCoach<any>(id);
      return coach ? {
        ...coach,
        displayName: coach.display_name,
        photoUrl: coach.avatar_url,
        ratesPerHour: coach.hourly_rate,
        reviewCount: coach.total_reviews,
        totalSessions: coach.total_sessions,
        isVerified: coach.verified,
      } : null;
    },
  });
}
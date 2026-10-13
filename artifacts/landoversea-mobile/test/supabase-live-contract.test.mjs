import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(join(root, relative), 'utf8');

test('one env-only Supabase client owns persisted PKCE auth', async () => {
  const source = await read('lib/supabase.ts');
  assert.match(source, /EXPO_PUBLIC_SUPABASE_URL/);
  assert.match(source, /EXPO_PUBLIC_SUPABASE_ANON_KEY/);
  assert.match(source, /flowType:\s*'pkce'/);
  assert.match(source, /SecureStore/);
  assert.doesNotMatch(source, /service.?role/i);
  assert.doesNotMatch(source, /https:\/\/[^'"]+\.supabase\.co/);
});

test('profile reads are generation-bound and account changes clear profile immediately', async () => {
  const source = await read('lib/AuthProvider.tsx');
  assert.match(source, /identityGenerationRef/);
  assert.match(
    source,
    /userIdRef\.current = expectedUserId;[\s\S]*identityGenerationRef\.current \+= 1;[\s\S]*setProfile\(null\)/,
  );
  assert.match(
    source,
    /const nextProfile = expectedUserId \? await readProfile\(expectedUserId\) : null;[\s\S]*isCurrentIdentity\(expectedUserId, expectedGeneration\)[\s\S]*setProfile\(nextProfile\)/,
  );
  assert.match(
    source,
    /const nextProfile = await readProfile\(expectedUserId\);[\s\S]*isCurrentIdentity\(expectedUserId, expectedGeneration\)/,
    'manual profile refresh must reject stale account results',
  );
  assert.match(source, /if \(authStateObserved\) return;/, 'a stale startup session must not replace an auth event');
});

test('live adapter covers reviewed tables, private storage, matching, and realtime', async () => {
  const source = await read('lib/liveSupabase.ts');
  for (const table of ['profiles', 'photos', 'swipes', 'matches', 'messages', 'user_locations', 'coaches']) {
    assert.match(source, new RegExp(`from\\('${table}'\\)`));
  }
  assert.match(source, /createSignedUrl/);
  assert.match(source, /rpc\('ensure_match'/);
  assert.match(source, /postgres_changes/);
  assert.match(source, /status === 'SUBSCRIBED'/);
});

test('current mobile surfaces consume live adapters', async () => {
  const contracts = {
    'app/(tabs)/discover.tsx': ['useLiveDiscovery', 'useLiveSwipe'],
    'app/(tabs)/matches.tsx': ['useLiveMatches'],
    'app/(tabs)/messages.tsx': ['useLiveMatches'],
    'app/messages/[conversationId].tsx': ['useLiveConversation', 'subscribeLiveMessages', 'sendLiveMessage'],
    'app/(tabs)/profile.tsx': ['useLiveMyProfile'],
    'app/profile/edit.tsx': ['useLiveMyProfile', 'useLivePhotoMutations', 'useLiveUpdateProfile'],
    'app/onboarding.tsx': ['useLiveMyProfile', 'useLivePhotoMutations', 'useLiveUpdateProfile'],
    'app/(tabs)/coaches.tsx': ['useLiveCoaches'],
    'app/coaches/[id].tsx': ['useLiveCoach'],
    'app/settings.tsx': ['useLiveLocations'],
  };
  for (const [file, adapters] of Object.entries(contracts)) {
    const source = await read(file);
    for (const adapter of adapters) assert.match(source, new RegExp(`\\b${adapter}\\b`), `${file} must use ${adapter}`);
  }
});

test('mobile onboarding preserves draft precedence and round-trips profile semantics', async () => {
  const [onboarding, columns, live] = await Promise.all([
    read('app/onboarding.tsx'),
    read('lib/profileColumns.ts'),
    read('lib/liveSupabase.ts'),
  ]);

  for (const gender of ['male', 'female', 'non_binary']) {
    assert.match(onboarding, new RegExp(`["']${gender}["']`));
  }
  assert.match(onboarding, /man:\s*'male'/);
  assert.match(onboarding, /woman:\s*'female'/);
  assert.match(onboarding, /canonicalGender\(profile\?\.gender\)/);
  assert.match(onboarding, /gender:\s*formData\.gender/);
  assert.match(onboarding, /LOOKING_FOR_OPTIONS = \["male", "female", "non_binary", "everyone"\]/);
  assert.match(onboarding, /lookingFor:\s*has\(d\.lookingFor\) \? canonicalGender\(d\.lookingFor\)/);
  assert.match(live, /key === 'gender' \|\| key === 'lookingFor'[\s\S]*canonicalProfileGender\(value\)/);
  assert.match(live, /DISCOVERY_GENDER_ALIASES/);
  assert.match(live, /query = query\.in\('gender', genderAliases\)/, 'discovery must query controlled rollout aliases');
  assert.doesNotMatch(live, /query = query\.eq\('gender'/);

  assert.match(onboarding, /if \(value === 'yes'\) return true/);
  assert.match(onboarding, /if \(value === 'no'\) return false/);
  assert.match(onboarding, /return null/);
  assert.match(onboarding, /preferenceFormValue\(profile\?\.relocationOpenness\)/);
  assert.match(onboarding, /preferenceFormValue\(profile\?\.longDistance\)/);
  assert.match(onboarding, /relocationOpenness:\s*triStatePreference\(formData\.relocation\)/);
  assert.match(onboarding, /longDistanceOpenness:\s*triStatePreference\(formData\.longDistance\)/);

  assert.match(onboarding, /draftHas\('bio'\)\s*\?\s*\(d\.bio \?\? ''\)/);
  assert.match(onboarding, /draftHas\('city'\)\s*\?\s*\(d\.city \?\? ''\)/);
  assert.match(onboarding, /baseServerUpdatedAt:\s*baseServerUpdatedAtRef\.current/);
  assert.match(onboarding, /draft\.baseServerUpdatedAt !== serverVersion/);
  assert.match(onboarding, /serverVersion !== null/);
  assert.doesNotMatch(onboarding, /new Date\(profile\.updatedAt\)[\s\S]{0,100}(?:savedAt|updatedAt)/);
  assert.match(onboarding, /Date\.now\(\) - localUpdatedAt < DRAFT_MAX_AGE_MS/);
  assert.match(onboarding, /draft\?\.learningLanguages \?\? profile\?\.learningLanguages/);
  assert.match(onboarding, /if \(!initialized \|\| !userId/);
  assert.match(onboarding, /draftWriteQueueRef\.current = draftWriteQueueRef\.current\.then/);
  assert.match(onboarding, /identityGenerationRef\.current !== expectedGeneration/);
  assert.match(onboarding, /hydratedUserRef\.current !== expectedUserId/);
  assert.match(onboarding, /catch \{[\s\S]*setDraftSaveError\(true\)/);
  assert.match(onboarding, /accessibilityRole="alert"/);
  assert.match(onboarding, /accessibilityLiveRegion="polite"/);
  assert.match(onboarding, /testID="retry-onboarding-draft"/);
  assert.match(onboarding, /await draftWriteQueueRef\.current;[\s\S]*AsyncStorage\.removeItem/);
  assert.match(columns, /created_at,updated_at/);
  assert.match(live, /updatedAt:\s*row\.updated_at/);
});

test('safe UUID-independent sidecars are restored while integer-only chat actions stay disabled', async () => {
  const conversation = await read('app/messages/[conversationId].tsx');
  assert.doesNotMatch(conversation, /@workspace\/api-client-react/);
  assert.doesNotMatch(conversation, /\b(?:Number|parseInt)\s*\(\s*matchId/);
  assert.match(conversation, /saved conversation translation preferences are unavailable/);
  assert.match(conversation, /translateText/);
  const coach = await read('app/coaches/[id].tsx');
  assert.doesNotMatch(coach, /@workspace\/api-client-react/);
  assert.doesNotMatch(coach, /\b(?:Number|parseInt)\s*\(\s*liveCoachId/);
  assert.match(coach, /getUuidCoachAvailability/);
  assert.match(coach, /createUuidCoachBooking/);
  const safeApi = await read('lib/safeApi.ts');
  assert.match(safeApi, /['"]\/api\/translations\/text['"]/);
  assert.match(safeApi, /Authorization: `Bearer \$\{token\}`/);
  assert.match(safeApi, /encodeURIComponent\(coachId\)/);
  assert.doesNotMatch(safeApi, /Number\(|parseInt/);
  const settings = await read('app/settings.tsx');
  assert.match(settings, /useGetNotificationPreferences/);
  assert.match(settings, /useUpdateNotificationPreferences/);
});

test('live UUID identifiers stay strings at every reviewed mobile boundary', async () => {
  const files = [
    'lib/liveSupabase.ts',
    'lib/safeApi.ts',
    'app/messages/[conversationId].tsx',
    'app/coaches/[id].tsx',
    'app/(tabs)/messages.tsx',
    'app/(tabs)/matches.tsx',
    'app/(tabs)/coaches.tsx',
    'app/(tabs)/profile.tsx',
    'app/profile/edit.tsx',
    'app/onboarding.tsx',
    'app/settings.tsx',
  ];
  for (const file of files) {
    const source = await read(file);
    assert.doesNotMatch(
      source,
      /\b(?:Number|parseInt|Number\.parseInt)\s*\(\s*(?:matchId|conversationId|liveCoachId|coachId|messageId|userId|locationId|photoId)/,
      `${file} coerces a Supabase identifier`,
    );
    assert.doesNotMatch(source, /\.id\s*-\s*\w+\.id/, `${file} numerically sorts opaque IDs`);
  }
  const live = await read('lib/liveSupabase.ts');
  assert.match(live, /function isSupabaseUuid/);
  assert.match(live, /mutationFn:\s*async \(input: \{ targetUserId: string/);
  const discover = await read('app/(tabs)/discover.tsx');
  assert.match(discover, /mutateAsync\(\{ targetUserId: currentCard\.userId, action \}\)/);
  assert.doesNotMatch(discover, /mutateAsync\(\{\s*data:\s*\{\s*targetUserId/);
});
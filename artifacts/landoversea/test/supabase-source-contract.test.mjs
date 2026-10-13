import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (name) => readFile(new URL(`../src/lib/${name}`, import.meta.url), 'utf8');

test('browser client is lazy and accepts only Vite public Supabase configuration', async () => {
  const source = await readSource('supabase.ts');
  assert.match(source, /VITE_SUPABASE_URL/);
  assert.match(source, /VITE_SUPABASE_ANON_KEY/);
  assert.match(source, /flowType:\s*'pkce'/);
  assert.doesNotMatch(source, /service.role|SERVICE_ROLE|fallback/i);
  assert.ok(source.indexOf('createClient(') > source.indexOf('function getSupabase'));
});

test('API bridge reads the current session token per request', async () => {
  const source = await readSource('auth.tsx');
  assert.match(source, /setAuthTokenGetter\(async/);
  assert.match(source, /data\.session\?\.access_token/);
  assert.match(source, /queryClient\.clear\(\)/);
});

test('coach UUID bridge uses authenticated fetch and local IDs gate numeric APIs', async () => {
  const hooks = await readFile(
    new URL('../src/hooks/use-supabase-surfaces.ts', import.meta.url),
    'utf8',
  );
  const profile = await readFile(
    new URL('../src/pages/coach-profile.tsx', import.meta.url),
    'utf8',
  );
  const booking = await readFile(
    new URL('../src/pages/book-coach.tsx', import.meta.url),
    'utf8',
  );
  assert.match(hooks, /useResolvedLocalCoachId[\s\S]*authenticatedFetch/);
  assert.match(hooks, /api\/coaches\/resolve\//);
  assert.match(profile, /useResolvedLocalCoachId[\s\S]*useGetCoachReviews\(localCoachId/);
  assert.match(booking, /useGetCoachAvailability\(\s*localCoachId/);
  assert.match(booking, /coachId:\s*localCoachId/);
  assert.match(booking, /setLocation\(`\/coaches\/\$\{coachId\}`\)/);
  assert.doesNotMatch(booking, /parseInt\(coachId/);
});

test('private writes derive ownership from the authenticated user', async () => {
  const source = await readSource('supabase-api.ts');
  assert.match(source, /user_id:\s*user\.id/);
  assert.match(source, /\.eq\('user_id', user\.id\)/);
  assert.match(source, /ownerPhotoPath\(path, user\.id\)/);
  assert.match(source, /\.eq\('approved', true\)\.eq\('active', true\)/);
});

test('web profile mutations use the reviewed live Supabase richer columns', async () => {
  const [api, hooks, onboarding, profilePage, editProfilePage] = await Promise.all([
    readSource('supabase-api.ts'),
    readFile(new URL('../src/hooks/use-supabase-surfaces.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/onboarding.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/profile.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/edit-profile.tsx', import.meta.url), 'utf8'),
  ]);
  const richerColumns = [
    'learning_languages',
    'relationship_goal',
    'interests',
    'cultural_interests',
    'countries_of_interest',
    'relocation_openness',
    'long_distance',
    'preferred_min_age',
    'preferred_max_age',
  ];

  for (const column of richerColumns) {
    assert.match(api, new RegExp(`${column}:`));
    assert.match(hooks, new RegExp(`['"]${column}['"]`));
    assert.match(onboarding, new RegExp(`${column}:`));
  }
  assert.match(hooks, /value !== undefined/);
  assert.match(hooks, /return upsertOwnProfile\(fields\)/);
  assert.match(hooks, /otherLanguages:\s*profile\.learning_languages/);
  assert.match(hooks, /relationshipGoal:\s*profile\.relationship_goal/);
  assert.match(hooks, /culturalInterests:\s*profile\.cultural_interests/);
  assert.match(hooks, /countriesOfInterest:\s*profile\.countries_of_interest/);
  assert.match(hooks, /relocationOpenness:\s*profile\.relocation_openness/);
  assert.match(hooks, /longDistanceOpenness:\s*profile\.long_distance/);
  assert.match(hooks, /preferredMinAge:\s*profile\.preferred_min_age/);
  assert.match(hooks, /preferredMaxAge:\s*profile\.preferred_max_age/);
  assert.doesNotMatch(hooks, /updateMyProfile|\/api\/profiles\/me/);
  assert.doesNotMatch(onboarding, /useUpdateMyProfile|updateProfileMutation|\/api\/profiles\/me/);
  assert.doesNotMatch(profilePage, /useUpdateMyProfile|updateMyProfile/);
  assert.doesNotMatch(editProfilePage, /useUpdateMyProfile|updateMyProfile/);
});

test('onboarding hydrates rich server profile values instead of empty defaults', async () => {
  const onboarding = await readFile(
    new URL('../src/pages/onboarding.tsx', import.meta.url),
    'utf8',
  );
  const serverHydrationMappings = {
    relationshipGoal: 'relationship_goal',
    learningLanguages: 'learning_languages',
    interests: 'interests',
    culturalInterests: 'cultural_interests',
    countriesOfInterest: 'countries_of_interest',
    relocationOpenness: 'relocation_openness',
    longDistanceOpenness: 'long_distance',
    preferredMinAge: 'preferred_min_age',
    preferredMaxAge: 'preferred_max_age',
  };

  for (const [modelField, serverField] of Object.entries(serverHydrationMappings)) {
    assert.match(
      onboarding,
      new RegExp(`${modelField}:\\s*supabaseProfile\\.${serverField}`),
      `${serverField} must hydrate ${modelField}`,
    );
  }
  assert.doesNotMatch(onboarding, /relationshipGoal:\s*null/);
  assert.doesNotMatch(onboarding, /(?:learningLanguages|interests|culturalInterests|countriesOfInterest):\s*\[\]/);
  assert.match(onboarding, /activeDraft\?\.interests[\s\S]*profile\?\.interests/);
  assert.match(onboarding, /activeDraft\?\.learningLanguages[\s\S]*profile\?\.learningLanguages/);
  assert.match(onboarding, /activeDraft\?\.culturalGoals[\s\S]*profile\?\.culturalInterests/);
  assert.match(onboarding, /activeDraft\?\.preferredCountries[\s\S]*profile\?\.countriesOfInterest/);
});

test('onboarding round-trips canonical gender, tri-state preferences, cleared drafts, and update timestamps', async () => {
  const [onboarding, api, migration] = await Promise.all([
    readFile(new URL('../src/pages/onboarding.tsx', import.meta.url), 'utf8'),
    readSource('supabase-api.ts'),
    readFile(
      new URL('../../../supabase/migrations/20260920210000_add_profile_updated_at_and_nullable_preferences.sql', import.meta.url),
      'utf8',
    ),
  ]);

  for (const gender of ['male', 'female', 'non_binary']) {
    assert.match(onboarding, new RegExp(`value:\\s*["']${gender}["']`));
  }
  assert.match(onboarding, /man:\s*'male'/);
  assert.match(onboarding, /woman:\s*'female'/);
  assert.match(onboarding, /gender:\s*canonicalGender\(supabaseProfile\.gender\)/);
  assert.match(onboarding, /gender:\s*formData\.gender/);

  assert.match(onboarding, /if \(value === 'yes'\) return true/);
  assert.match(onboarding, /if \(value === 'no'\) return false/);
  assert.match(onboarding, /return null/);
  assert.match(onboarding, /value === true[\s\S]*return 'yes'/);
  assert.match(onboarding, /value === false[\s\S]*return 'no'/);
  assert.match(onboarding, /return 'not_sure'/);
  assert.match(onboarding, /relocation_openness:\s*relocationOpenness/);
  assert.match(onboarding, /long_distance:\s*longDistanceOpenness/);

  assert.match(onboarding, /draftHas\('bio'\)\s*\?\s*\(d\.bio \?\? ''\)/);
  assert.match(onboarding, /draftHas\('city'\)\s*\?\s*\(d\.city \?\? ''\)/);
  assert.match(onboarding, /updatedAt:\s*supabaseProfile\.updated_at/);
  assert.doesNotMatch(onboarding, /updatedAt:\s*supabaseProfile\.created_at/);
  assert.match(onboarding, /baseServerUpdatedAt:\s*baseServerUpdatedAtRef\.current/);
  assert.match(onboarding, /draft\.baseServerUpdatedAt === serverVersion/);
  assert.match(onboarding, /serverVersion === null/);
  assert.doesNotMatch(onboarding, /new Date\(profile\.updatedAt\)[\s\S]{0,100}(?:savedAt|updatedAt)/);
  assert.match(onboarding, /Date\.now\(\) - localUpdatedAt < DRAFT_MAX_AGE_MS/);
  assert.match(api, /created_at,updated_at/);

  assert.match(migration, /add column if not exists updated_at timestamptz/i);
  assert.match(migration, /set updated_at = coalesce\(created_at, now\(\)\)/i);
  assert.match(migration, /alter column updated_at set default now\(\)/i);
  assert.match(migration, /before update on public\.profiles/i);
  assert.match(migration, /alter column relocation_openness drop default/i);
  assert.match(migration, /alter column long_distance drop default/i);
});

test('onboarding completion is durable, adult-gated, and protected from hydration failures', async () => {
  const [authFlow, guard, onboarding, api, hooks, migration] = await Promise.all([
    readSource('auth-flow.ts'),
    readFile(new URL('../src/components/auth/AuthGuard.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/onboarding.tsx', import.meta.url), 'utf8'),
    readSource('supabase-api.ts'),
    readFile(new URL('../src/hooks/use-supabase-surfaces.ts', import.meta.url), 'utf8'),
    readFile(
      new URL('../../../supabase/migrations/20260928020000_preserve_onboarding_completion.sql', import.meta.url),
      'utf8',
    ),
  ]);

  assert.match(authFlow, /onboarding_completed_at/);
  assert.match(authFlow, /const isAdult = Number\.isInteger\(profile\.age\)/);
  assert.match(guard, /confirmedCompleteUserIdRef/);
  assert.match(guard, /profileCompletionConfirmed/);
  assert.match(guard, /queryKey:\s*\['supabase',\s*'profile-gate'/);
  assert.doesNotMatch(guard, /queryKey:\s*\['supabase',\s*'profile',\s*auth\.user/);
  assert.match(onboarding, /setHydrationError/);
  assert.doesNotMatch(onboarding, /\.catch\(\(\) => \{[\s\S]{0,120}setInitialized\(true\)/);
  assert.match(onboarding, /Your saved answers were not changed/);
  assert.match(api, /onboarding_completed_at/);
  assert.match(hooks, /SIGNED_URL_REFRESH_INTERVAL_MS/);
  assert.match(hooks, /refetchInterval:\s*SIGNED_URL_REFRESH_INTERVAL_MS/);
  assert.match(hooks, /invalidateQueries\(\{\s*queryKey:\s*\['supabase',\s*'profile-gate'\]/);
  assert.match(migration, /add column if not exists onboarding_completed_at timestamptz/i);
  assert.match(migration, /old\.onboarding_completed_at is not null/i);
  assert.match(migration, /new\.age >= 18/i);
  assert.match(migration, /revoke insert \(onboarding_completed_at\), update \(onboarding_completed_at\)/i);
});

test('dating, profile, location, chat, and coach pages call live Supabase hooks', async () => {
  const pages = Object.fromEntries(await Promise.all(
    ['profile', 'edit-profile', 'profile-details', 'profile-coach', 'discover', 'matches', 'messages', 'conversation', 'settings', 'coaches', 'coach-profile', 'book-coach']
      .map(async (name) => [name, await readFile(new URL(`../src/pages/${name}.tsx`, import.meta.url), 'utf8')]),
  ));
  assert.match(pages.profile, /useLiveProfile/);
  assert.match(pages['edit-profile'], /useLiveUploadPhoto/);
  assert.match(pages['profile-details'], /useLiveProfile/);
  assert.match(pages['profile-coach'], /useLiveProfile/);
  assert.match(pages.discover, /useLiveDiscovery[\s\S]*useLiveSwipe/);
  assert.match(pages.matches, /useLiveMatches/);
  assert.match(pages.messages, /useLiveMatches/);
  assert.match(pages.conversation, /useLiveMessages[\s\S]*subscribeToMessages/);
  assert.doesNotMatch(pages.matches, /useUnmatch|as unknown as number/);
  assert.doesNotMatch(pages.messages, /useCreateGroupConversation|participantIds/);
  assert.match(pages.settings, /useLiveLocations[\s\S]*useLiveAddLocation[\s\S]*useLiveRemoveLocation/);
  assert.match(pages.coaches, /useApprovedCoaches/);
  assert.match(pages['coach-profile'], /useApprovedCoach/);
  assert.match(pages['book-coach'], /useApprovedCoach/);
});

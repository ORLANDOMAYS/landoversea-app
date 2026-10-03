import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  DISCOVER_FILTER_DEFAULTS,
  normalizeDiscoverGender,
  toSupabaseDiscoveryFilters,
} from '../src/lib/discover-filters.ts';

test('persisted canonical filters translate completely into live discovery', () => {
  const saved = {
    minAge: 27,
    maxAge: 43,
    gender: 'female',
    countries: ['Japan', 'France'],
    languages: ['Japanese', 'French'],
    globalMode: false,
    relationshipGoal: 'serious',
    interestsOverlap: true,
    verifiedOnly: true,
    longDistance: true,
    relocation: true,
  };

  assert.deepEqual(toSupabaseDiscoveryFilters(saved), saved);
});

test('legacy gender aliases normalize to the canonical persisted vocabulary', () => {
  assert.equal(normalizeDiscoverGender('man'), 'male');
  assert.equal(normalizeDiscoverGender(' WOMAN '), 'female');
  assert.equal(normalizeDiscoverGender('Non-Binary'), 'non_binary');
  assert.equal(normalizeDiscoverGender('non_binary'), 'non_binary');
  assert.equal(normalizeDiscoverGender(null), null);
});

test('canonical clear defaults remain unrestricted in live discovery', () => {
  assert.deepEqual(
    toSupabaseDiscoveryFilters(DISCOVER_FILTER_DEFAULTS),
    DISCOVER_FILTER_DEFAULTS,
  );
  assert.deepEqual(DISCOVER_FILTER_DEFAULTS, {
    minAge: 18,
    maxAge: 99,
    gender: null,
    countries: [],
    languages: [],
    globalMode: true,
    relationshipGoal: null,
    interestsOverlap: false,
    verifiedOnly: false,
    longDistance: false,
    relocation: false,
  });
});

test('both filter editors invalidate generated and live discovery caches', async () => {
  const pages = await Promise.all([
    readFile(new URL('../src/pages/discover.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/filters-page.tsx', import.meta.url), 'utf8'),
  ]);

  for (const source of pages) {
    assert.match(source, /getGetDiscoverFiltersQueryKey\(\)/);
    assert.match(source, /getGetDiscoverCardsQueryKey\(\)/);
    assert.match(source, /queryKey:\s*liveKeys\.discovery/);
  }
});

test('discover waits for canonical filters and retries the filter request itself', async () => {
  const source = await readFile(new URL('../src/pages/discover.tsx', import.meta.url), 'utf8');

  assert.match(source, /isLoading:\s*areFiltersLoading/);
  assert.match(source, /isError:\s*isFiltersError/);
  assert.match(source, /refetch:\s*refetchDiscoverFilters/);
  assert.match(source, /areFiltersLoading \|\| \(!discoverFilters && !isFiltersError\) \|\| isLoading/);
  assert.match(source, /onClick=\{\(\) => refetchDiscoverFilters\(\)\}/);
  assert.ok(
    source.indexOf('if (isFiltersError)') < source.indexOf('// Empty state'),
    'filter failures are handled before the seen-everyone state',
  );
});

test('Edit Profile writes canonical gender values and discovery uses controlled aliases', async () => {
  const [editProfile, supabaseApi] = await Promise.all([
    readFile(new URL('../src/pages/edit-profile.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/supabase-api.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(editProfile, /value: 'male', label: 'Man'/);
  assert.match(editProfile, /value: 'female', label: 'Woman'/);
  assert.match(editProfile, /value: 'non_binary', label: 'Non-binary'/);
  assert.match(editProfile, /value: 'transgender', label: 'Transgender'/);
  assert.match(editProfile, /value: 'prefer_not_to_say', label: 'Prefer not to say'/);
  assert.match(editProfile, /value: 'other', label: 'Other'/);
  assert.match(editProfile, /setGender\(normalizeProfileGender\(profile\.gender\)\)/);
  assert.match(supabaseApi, /query = query\.in\('gender', aliases\)/);
  assert.doesNotMatch(supabaseApi, /query\.eq\('gender'/);
  assert.doesNotMatch(supabaseApi, /gender\.ilike/);
});
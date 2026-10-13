import type {
  DiscoverFilters,
  DiscoverFiltersInput,
} from '@workspace/api-client-react';
import type { DiscoveryProfileFilters } from '@/lib/supabase-api';

/**
 * Legacy localStorage key that previously held device-only advanced filters.
 * Kept here so both the Filters page and Discover inline controls can purge it.
 */
export const LEGACY_FILTERS_EXT_KEY = 'filters_ext';

export type CanonicalDiscoverGender = 'male' | 'female' | 'non_binary';

/** Normalize values produced by legacy filter editors and older API rows. */
export function normalizeDiscoverGender(value: unknown): CanonicalDiscoverGender | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'male' || normalized === 'man') return 'male';
  if (normalized === 'female' || normalized === 'woman') return 'female';
  if (normalized === 'non_binary' || normalized === 'nonbinary') return 'non_binary';
  return null;
}

/**
 * Shared clear defaults that genuinely remove restrictions:
 * age 18-99, no gender/countries/languages/relationship goal, globalMode true,
 * and all advanced booleans false. Both the Filters page Clear and the Discover
 * inline Clear PATCH exactly these values.
 */
export const DISCOVER_FILTER_DEFAULTS: Required<
  Pick<
    DiscoverFiltersInput,
    | 'minAge'
    | 'maxAge'
    | 'gender'
    | 'countries'
    | 'languages'
    | 'globalMode'
    | 'relationshipGoal'
    | 'interestsOverlap'
    | 'verifiedOnly'
    | 'longDistance'
    | 'relocation'
  >
> = {
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
};

/**
 * Translate the canonical API model into the existing Supabase discovery
 * query input. Keeping this explicit prevents the live deck from developing a
 * second set of defaults or silently dropping newly persisted preferences.
 */
export function toSupabaseDiscoveryFilters(
  filters: DiscoverFilters,
): DiscoveryProfileFilters {
  return {
    minAge: filters.minAge,
    maxAge: filters.maxAge,
    gender: normalizeDiscoverGender(filters.gender),
    countries: [...(filters.countries ?? [])],
    languages: [...(filters.languages ?? [])],
    globalMode: filters.globalMode,
    relationshipGoal: filters.relationshipGoal ?? null,
    interestsOverlap: filters.interestsOverlap,
    verifiedOnly: filters.verifiedOnly,
    longDistance: filters.longDistance,
    relocation: filters.relocation,
  };
}

/** Remove the legacy device-only advanced filters key, if present. */
export function clearLegacyFiltersExt(): void {
  try {
    localStorage.removeItem(LEGACY_FILTERS_EXT_KEY);
  } catch {
    // Ignore storage access errors (e.g. private mode).
  }
}

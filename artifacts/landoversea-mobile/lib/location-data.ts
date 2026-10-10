import {
  getAllCountries,
  getStatesOfCountry,
  type Country,
  type State,
} from 'localized-countries-states';

export interface LocationOption {
  code: string;
  name: string;
  canonicalName: string;
  keywords: string[];
}

const LEGACY_COUNTRY_CODES: Record<string, string> = {
  korea: 'KR',
  'south korea': 'KR',
  uk: 'GB',
  'great britain': 'GB',
  us: 'US',
  usa: 'US',
  'u.s.a.': 'US',
  'united states of america': 'US',
};

export function normalizeLocationSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase();
}

function mergeLocalizedOptions(
  localized: Array<Country | State>,
  canonical: Array<Country | State>,
): LocationOption[] {
  const canonicalNames = new Map(canonical.map(option => [option.code, option.name]));

  return localized.map(option => {
    const canonicalName = canonicalNames.get(option.code) ?? option.name;
    return {
      code: option.code,
      name: option.name,
      canonicalName,
      keywords: [option.name, canonicalName, option.code],
    };
  });
}

export function getCountryOptions(locale: string): LocationOption[] {
  return mergeLocalizedOptions(getAllCountries(locale), getAllCountries('en'));
}

export function getSubdivisionOptions(
  countryCode: string,
  locale: string,
): LocationOption[] {
  return mergeLocalizedOptions(
    getStatesOfCountry(countryCode, locale),
    getStatesOfCountry(countryCode, 'en'),
  );
}

export function findCountryOption(
  options: LocationOption[],
  storedValue: string,
): LocationOption | undefined {
  const normalized = normalizeLocationSearch(storedValue);
  if (!normalized) return undefined;

  const legacyCode = LEGACY_COUNTRY_CODES[normalized];
  if (legacyCode) return options.find(option => option.code === legacyCode);

  return options.find(option =>
    option.keywords.some(keyword => normalizeLocationSearch(keyword) === normalized),
  );
}

export function findLocationOption(
  options: LocationOption[],
  storedValue: string,
): LocationOption | undefined {
  const normalized = normalizeLocationSearch(storedValue);
  if (!normalized) return undefined;

  return options.find(option =>
    option.keywords.some(keyword => normalizeLocationSearch(keyword) === normalized),
  );
}

function matchRank(option: LocationOption, query: string): number {
  let bestRank = Number.POSITIVE_INFINITY;

  for (const keyword of option.keywords) {
    const normalized = normalizeLocationSearch(keyword);
    if (normalized === query) bestRank = Math.min(bestRank, 0);
    else if (normalized.startsWith(query)) bestRank = Math.min(bestRank, 1);
    else if (normalized.split(/[\s-]+/).some(word => word.startsWith(query))) {
      bestRank = Math.min(bestRank, 2);
    } else if (normalized.includes(query)) bestRank = Math.min(bestRank, 3);
  }

  return bestRank;
}

export function filterLocationOptions(
  options: LocationOption[],
  query: string,
  limit = 7,
): LocationOption[] {
  const normalizedQuery = normalizeLocationSearch(query);
  if (!normalizedQuery) return [];

  return options
    .map(option => ({ option, rank: matchRank(option, normalizedQuery) }))
    .filter(result => Number.isFinite(result.rank))
    .sort((left, right) =>
      left.rank - right.rank || left.option.name.localeCompare(right.option.name),
    )
    .slice(0, limit)
    .map(result => result.option);
}
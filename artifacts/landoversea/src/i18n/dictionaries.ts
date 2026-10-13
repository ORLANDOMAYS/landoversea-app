import type { Locale, Translation } from './types';
import en from './locales/en';

// English is the complete source-of-truth dictionary; the others are partial
// and fall back to English per key. Keep only English in the startup graph;
// each selected locale becomes its own Vite chunk.
export type Dictionary = Translation | Partial<Translation>;

const loaders: Record<Locale, () => Promise<Dictionary>> = {
  en: async () => en,
  ja: () => import('./locales/ja').then(({ default: dictionary }) => dictionary),
  pt: () => import('./locales/pt').then(({ default: dictionary }) => dictionary),
  fr: () => import('./locales/fr').then(({ default: dictionary }) => dictionary),
  es: () => import('./locales/es').then(({ default: dictionary }) => dictionary),
  ko: () => import('./locales/ko').then(({ default: dictionary }) => dictionary),
  de: () => import('./locales/de').then(({ default: dictionary }) => dictionary),
  it: () => import('./locales/it').then(({ default: dictionary }) => dictionary),
  ru: () => import('./locales/ru').then(({ default: dictionary }) => dictionary),
  'zh-CN': () => import('./locales/zh-CN').then(({ default: dictionary }) => dictionary),
  ar: () => import('./locales/ar').then(({ default: dictionary }) => dictionary),
  th: () => import('./locales/th').then(({ default: dictionary }) => dictionary),
  vi: () => import('./locales/vi').then(({ default: dictionary }) => dictionary),
  id: () => import('./locales/id').then(({ default: dictionary }) => dictionary),
  hi: () => import('./locales/hi').then(({ default: dictionary }) => dictionary),
  lo: () => import('./locales/lo').then(({ default: dictionary }) => dictionary),
};

const cache = new Map<Locale, Dictionary>([['en', en]]);

export function getCachedDictionary(locale: Locale): Dictionary | undefined {
  return cache.get(locale);
}

export async function loadDictionary(locale: Locale): Promise<Dictionary> {
  const cached = cache.get(locale);
  if (cached) return cached;
  const dictionary = await loaders[locale]();
  cache.set(locale, dictionary);
  return dictionary;
}

export { en as baseDictionary };

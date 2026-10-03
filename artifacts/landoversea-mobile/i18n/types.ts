import type en from './locales/en';

// The English dictionary is the source of truth. Its exact shape defines the
// canonical Translation type; every other locale must conform to this shape.
export type Translation = typeof en;

// The 16 supported locales — no more, no less.
export const LOCALES = [
  'en', 'ja', 'pt', 'fr', 'es', 'ko', 'de', 'it', 'ru',
  'zh-CN', 'ar', 'th', 'vi', 'id', 'hi', 'lo',
] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

// Locales that render right-to-left.
export const RTL_LOCALES: readonly Locale[] = ['ar'];

export interface LocaleMeta {
  code: Locale;
  /** Endonym — the language name written in its own language. */
  label: string;
  /** English name, for accessibility labels and search. */
  englishName: string;
  /** BCP-47 tag for document lang and Intl APIs. */
  bcp47: string;
  dir: 'ltr' | 'rtl';
}

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  'en':    { code: 'en',    label: 'English',     englishName: 'English',              bcp47: 'en',    dir: 'ltr' },
  'ja':    { code: 'ja',    label: '日本語',       englishName: 'Japanese',             bcp47: 'ja',    dir: 'ltr' },
  'pt':    { code: 'pt',    label: 'Português',   englishName: 'Portuguese',           bcp47: 'pt',    dir: 'ltr' },
  'fr':    { code: 'fr',    label: 'Français',    englishName: 'French',               bcp47: 'fr',    dir: 'ltr' },
  'es':    { code: 'es',    label: 'Español',     englishName: 'Spanish',              bcp47: 'es',    dir: 'ltr' },
  'ko':    { code: 'ko',    label: '한국어',       englishName: 'Korean',               bcp47: 'ko',    dir: 'ltr' },
  'de':    { code: 'de',    label: 'Deutsch',     englishName: 'German',               bcp47: 'de',    dir: 'ltr' },
  'it':    { code: 'it',    label: 'Italiano',    englishName: 'Italian',              bcp47: 'it',    dir: 'ltr' },
  'ru':    { code: 'ru',    label: 'Русский',     englishName: 'Russian',              bcp47: 'ru',    dir: 'ltr' },
  'zh-CN': { code: 'zh-CN', label: '简体中文',     englishName: 'Simplified Chinese',   bcp47: 'zh-CN', dir: 'ltr' },
  'ar':    { code: 'ar',    label: 'العربية',     englishName: 'Arabic',               bcp47: 'ar',    dir: 'rtl' },
  'th':    { code: 'th',    label: 'ไทย',         englishName: 'Thai',                 bcp47: 'th',    dir: 'ltr' },
  'vi':    { code: 'vi',    label: 'Tiếng Việt',  englishName: 'Vietnamese',           bcp47: 'vi',    dir: 'ltr' },
  'id':    { code: 'id',    label: 'Bahasa Indonesia', englishName: 'Indonesian',      bcp47: 'id',    dir: 'ltr' },
  'hi':    { code: 'hi',    label: 'हिन्दी',       englishName: 'Hindi',                bcp47: 'hi',    dir: 'ltr' },
  'lo':    { code: 'lo',    label: 'ພາສາລາວ',     englishName: 'Lao',                  bcp47: 'lo',    dir: 'ltr' },
};

// A dot-path into the Translation tree, e.g. "auth.signIn". Built recursively
// so t() only accepts keys that actually exist, and TypeScript flags typos.
type DotPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : DotPaths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type TranslationKey = DotPaths<Translation>;

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { I18nManager, Platform, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import {
  LOCALES,
  LOCALE_META,
  DEFAULT_LOCALE,
  type Locale,
  type TranslationKey,
} from './types';
import { dictionaries, baseDictionary } from './dictionaries';

const STORAGE_KEY = 'los_locale';
const LEGACY_STORAGE_KEY = 'appLanguage';

function isSupported(value: string | null | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

function resolveLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const normalized = tag.trim();
  if (isSupported(normalized)) return normalized;

  const lower = normalized.toLowerCase();
  const exact = (LOCALES as readonly string[]).find((l) => l.toLowerCase() === lower);
  if (isSupported(exact)) return exact;

  const primary = lower.split('-')[0];
  if (primary === 'zh') return 'zh-CN';
  const byPrimary = (LOCALES as readonly string[]).find(
    (l) => l.toLowerCase().split('-')[0] === primary,
  );
  return isSupported(byPrimary) ? byPrimary : null;
}

function getDeviceLocale(): Locale {
  let languageTag: string | null = getLocales()[0]?.languageTag ?? null;
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    languageTag = navigator.languages?.[0] ?? navigator.language ?? languageTag;
  }
  if (!languageTag) {
    try {
      languageTag = Intl.DateTimeFormat().resolvedOptions().locale;
    } catch {
      // Older native JavaScript engines may not expose Intl locale metadata.
    }
  }
  return resolveLocale(languageTag) ?? DEFAULT_LOCALE;
}

// Look up a dotted key in a dictionary, returning a string or undefined.
function lookup(dict: object | undefined, key: string): string | undefined {
  if (!dict) return undefined;
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === 'string' ? node : undefined;
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  dir: 'ltr' | 'rtl';
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let active = true;
    const hydrate = async () => {
      try {
        const [stored, legacyStored] = await AsyncStorage.multiGet([
          STORAGE_KEY,
          LEGACY_STORAGE_KEY,
        ]);
        const next = resolveLocale(stored[1]) ?? resolveLocale(legacyStored[1]) ?? getDeviceLocale();
        if (!active) return;
        setLocaleState(next);
        const isRtl = LOCALE_META[next].dir === 'rtl';
        I18nManager.allowRTL(true);
        if (I18nManager.isRTL !== isRtl) I18nManager.forceRTL(isRtl);
      } finally {
        if (active) setIsReady(true);
      }
    };
    void hydrate();
    return () => {
      active = false;
    };
  }, []);

  const setLocale = useCallback((next: Locale) => {
    if (!isSupported(next)) return;
    setLocaleState(next);
    AsyncStorage.multiSet([
      [STORAGE_KEY, next],
      [LEGACY_STORAGE_KEY, next],
    ]).catch(() => {});
    
    // The provider's direction wrapper updates immediately. forceRTL also keeps
    // native controls correct after Expo next reloads the JS/native hierarchy.
    const isRtl = LOCALE_META[next].dir === 'rtl';
    I18nManager.allowRTL(true);
    if (I18nManager.isRTL !== isRtl) {
      I18nManager.forceRTL(isRtl);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.documentElement.lang = LOCALE_META[locale].bcp47;
    document.documentElement.dir = LOCALE_META[locale].dir;
  }, [locale]);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>): string => {
      const active = dictionaries[locale];
      const raw = lookup(active, key) ?? lookup(baseDictionary, key) ?? key;
      if (!vars) return raw;
      return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match,
      );
    },
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, dir: LOCALE_META[locale].dir, t }),
    [locale, setLocale, t],
  );

  if (!isReady) return null;

  return (
    <I18nContext.Provider value={value}>
      <View
        key={value.dir}
        style={{ flex: 1, direction: value.dir }}
      >
        {children}
      </View>
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within an <I18nProvider>');
  }
  return ctx;
}

export function useTranslation(): I18nContextValue {
  return useI18n();
}

export function useOptionalI18n(): I18nContextValue | null {
  return useContext(I18nContext);
}

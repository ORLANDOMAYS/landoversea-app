import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  LOCALES,
  LOCALE_META,
  DEFAULT_LOCALE,
  type Locale,
  type TranslationKey,
} from './types';
import {
  baseDictionary,
  getCachedDictionary,
  loadDictionary,
  type Dictionary,
} from './dictionaries';

const STORAGE_KEY = 'los_locale';
const textOriginals = new WeakMap<Text, string>();
const attributeOriginals = new WeakMap<Element, Map<string, string>>();

function isSupported(value: string | null | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

// Map a raw navigator/stored language tag onto a supported locale.
// Handles exact matches ("zh-CN"), and primary-subtag fallbacks ("pt-BR" -> "pt").
function resolveLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const normalized = tag.trim();
  if (isSupported(normalized)) return normalized;

  // Case-insensitive exact match (e.g. "ZH-cn").
  const lower = normalized.toLowerCase();
  const exact = (LOCALES as readonly string[]).find((l) => l.toLowerCase() === lower);
  if (isSupported(exact)) return exact;

  // Primary subtag: "pt-BR" -> "pt", "en-US" -> "en".
  const primary = lower.split('-')[0];
  if (primary === 'zh') return 'zh-CN';
  const byPrimary = (LOCALES as readonly string[]).find(
    (l) => l.toLowerCase().split('-')[0] === primary,
  );
  return isSupported(byPrimary) ? byPrimary : null;
}

// Detection order: persisted preference -> device languages -> default.
function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const resolvedStored = resolveLocale(stored);
    if (resolvedStored) return resolvedStored;
  } catch {
    /* localStorage unavailable — fall through to device detection */
  }

  const candidates: string[] = [];
  if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
  if (navigator.language) candidates.push(navigator.language);

  for (const candidate of candidates) {
    const resolved = resolveLocale(candidate);
    if (resolved) return resolved;
  }

  return DEFAULT_LOCALE;
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

function flattenDictionary(
  value: object,
  prefix = '',
  output = new Map<string, TranslationKey>(),
): Map<string, TranslationKey> {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') {
      if (!output.has(child)) output.set(child, path as TranslationKey);
    } else if (child && typeof child === 'object') {
      flattenDictionary(child, path, output);
    }
  }
  return output;
}

const englishValueKeys = flattenDictionary(baseDictionary);

function translateEnglishValue(dictionary: Dictionary | undefined, value: string): string {
  const key = englishValueKeys.get(value);
  if (!key) return value;
  return lookup(dictionary, key) ?? lookup(baseDictionary, key) ?? value;
}

function shouldSkipNode(node: Node): boolean {
  const parent = node.parentElement;
  if (!parent) return true;
  if (['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE'].includes(parent.tagName)) return true;
  return !!parent.closest('[data-i18n-skip], [contenteditable="true"]');
}

function translateTextNode(node: Text, dictionary: Dictionary | undefined): void {
  if (shouldSkipNode(node)) return;
  let original = textOriginals.get(node);
  if (original === undefined) {
    const current = node.nodeValue ?? '';
    const match = current.match(/^(\s*)(.*?)(\s*)$/s);
    if (!match || !match[2] || !englishValueKeys.has(match[2])) return;
    original = current;
    textOriginals.set(node, original);
  }
  const match = original.match(/^(\s*)(.*?)(\s*)$/s);
  if (!match || !match[2]) return;
  const translated = translateEnglishValue(dictionary, match[2]);
  const next = `${match[1]}${translated}${match[3]}`;
  if (node.nodeValue !== next) node.nodeValue = next;
}

function translateElementAttributes(
  element: Element,
  dictionary: Dictionary | undefined,
): void {
  if (element.closest('[data-i18n-skip]')) return;
  const originals = attributeOriginals.get(element) ?? new Map<string, string>();
  for (const name of ['placeholder', 'title', 'aria-label']) {
    const current = element.getAttribute(name);
    if (
      current !== null
      && !originals.has(name)
      && englishValueKeys.has(current)
    ) {
      originals.set(name, current);
    }
    const original = originals.get(name);
    if (!original) continue;
    const translated = translateEnglishValue(dictionary, original);
    if (current !== translated) element.setAttribute(name, translated);
  }
  if (originals.size > 0) attributeOriginals.set(element, originals);
}

function translateDom(root: Node, dictionary: Dictionary | undefined): void {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text, dictionary);
    return;
  }
  if (!(root instanceof Element) && !(root instanceof Document)) return;

  if (root instanceof Element) translateElementAttributes(root, dictionary);
  const elementRoot = root instanceof Document ? root.documentElement : root;
  elementRoot.querySelectorAll('*').forEach((element) => {
    translateElementAttributes(element, dictionary);
  });

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    translateTextNode(current as Text, dictionary);
    current = walker.nextNode();
  }
}

function applyDocumentLang(locale: Locale): void {
  if (typeof document === 'undefined') return;
  const meta = LOCALE_META[locale];
  document.documentElement.lang = meta.bcp47;
  document.documentElement.dir = meta.dir;
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  dir: 'ltr' | 'rtl';
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale);
  const [loaded, setLoaded] = useState<{
    locale: Locale;
    dictionary: Dictionary | undefined;
  }>(() => ({ locale, dictionary: getCachedDictionary(locale) }));
  // Never display the previously selected language during an uncached switch.
  const activeDictionary = loaded.locale === locale ? loaded.dictionary : undefined;

  // Fetch only the selected locale. Cached dictionaries are restored
  // synchronously when users switch back, and English remains available as the
  // per-key fallback while a first-time selection is loading.
  useEffect(() => {
    const cached = getCachedDictionary(locale);
    setLoaded({ locale, dictionary: cached });
    if (cached) return;

    let cancelled = false;
    void loadDictionary(locale)
      .then((dictionary) => {
        if (!cancelled) setLoaded({ locale, dictionary });
      })
      .catch((error: unknown) => {
        // Keep the complete English fallback visible, but make a failed chunk
        // request explicit for diagnostics rather than creating an unhandled
        // rejection.
        console.error(`Failed to load locale dictionary "${locale}"`, error);
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  // Keep <html lang/dir> in sync for a11y + Arabic RTL.
  useEffect(() => {
    applyDocumentLang(locale);
  }, [locale]);

  // Translate legacy hardcoded labels that exactly match an English dictionary
  // value. This keeps the existing visual components intact while progressively
  // migrated screens use t() directly. User-generated content is not translated
  // unless it exactly equals a known interface label.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    let applying = false;
    const apply = (root: Node) => {
      if (applying) return;
      applying = true;
      try {
        translateDom(root, activeDictionary);
      } finally {
        applying = false;
      }
    };

    apply(document);
    const observer = new MutationObserver((mutations) => {
      if (applying) return;
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(apply);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [locale, activeDictionary]);

  const setLocale = useCallback((next: Locale) => {
    if (!isSupported(next)) return;
    setLoaded({ locale: next, dictionary: getCachedDictionary(next) });
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore persistence failure — switch still applies for this session */
    }
    applyDocumentLang(next);
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>): string => {
      // Per-key English fallback: try the active locale, then base English,
      // then the key itself so nothing ever renders blank.
      const raw = lookup(activeDictionary, key) ?? lookup(baseDictionary, key) ?? key;
      if (!vars) return raw;
      return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match,
      );
    },
    [activeDictionary],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, dir: LOCALE_META[locale].dir, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within an <I18nProvider>');
  }
  return ctx;
}

// Convenience hook: `const { t } = useTranslation();`
export function useTranslation(): I18nContextValue {
  return useI18n();
}

// Non-throwing accessor for components that may render OUTSIDE the provider
// (e.g. a top-level error boundary above <I18nProvider>). Returns null when no
// provider is present so callers can fall back to hardcoded English copy.
export function useOptionalI18n(): I18nContextValue | null {
  return useContext(I18nContext);
}

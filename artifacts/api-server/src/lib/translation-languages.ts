export const CANONICAL_LANGUAGE_CODES = [
  "en", "ja", "pt", "fr", "es", "ko", "de", "it",
  "ru", "zh-CN", "ar", "th", "vi", "id", "hi", "lo",
] as const;

export type CanonicalLanguageCode = typeof CANONICAL_LANGUAGE_CODES[number];

const canonical = new Set<string>(CANONICAL_LANGUAGE_CODES);
const aliases: Record<string, CanonicalLanguageCode> = {
  en: "en", eng: "en", english: "en", "en-us": "en", "en-gb": "en",
  ja: "ja", jpn: "ja", japanese: "ja", jp: "ja",
  pt: "pt", por: "pt", portuguese: "pt", "pt-br": "pt", "pt-pt": "pt",
  fr: "fr", fra: "fr", fre: "fr", french: "fr",
  es: "es", spa: "es", spanish: "es",
  ko: "ko", kor: "ko", korean: "ko", kr: "ko",
  de: "de", deu: "de", ger: "de", german: "de",
  it: "it", ita: "it", italian: "it",
  ru: "ru", rus: "ru", russian: "ru",
  "zh-cn": "zh-CN", "zh-hans": "zh-CN", zh: "zh-CN", zho: "zh-CN", chi: "zh-CN",
  chinese: "zh-CN", "simplified chinese": "zh-CN", mandarin: "zh-CN",
  ar: "ar", ara: "ar", arabic: "ar",
  th: "th", tha: "th", thai: "th",
  vi: "vi", vie: "vi", vietnamese: "vi",
  id: "id", ind: "id", indonesian: "id", in: "id",
  hi: "hi", hin: "hi", hindi: "hi",
  lo: "lo", lao: "lo", laotian: "lo",
};

export function normalizeLanguage(value: unknown): CanonicalLanguageCode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replaceAll("_", "-").toLowerCase();
  return aliases[normalized] ?? null;
}

/** API targets intentionally accept canonical spelling only. */
export function isCanonicalLanguage(value: unknown): value is CanonicalLanguageCode {
  return typeof value === "string" && canonical.has(value);
}

export function languageDirection(value: unknown): "rtl" | "ltr" {
  return normalizeLanguage(value) === "ar" ? "rtl" : "ltr";
}
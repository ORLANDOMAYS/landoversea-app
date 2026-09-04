/**
 * Simple translation using the free MyMemory Translation API.
 * No API key required for low-volume usage.
 * Returns the original text only when translation is unnecessary.
 */
export async function translateText(
  text: string,
  fromLang: string,
  toLang: string
): Promise<string> {
  if (fromLang === toLang || !text.trim()) return text;

  const res = await fetch(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${fromLang}|${toLang}`
  );
  if (!res.ok) throw new Error(`Translation failed (${res.status}).`);
  const data = await res.json();
  if (data.responseStatus === 200 && data.responseData?.translatedText) {
    return data.responseData.translatedText;
  }
  throw new Error(data.responseDetails || "Translation service returned no translation.");
}

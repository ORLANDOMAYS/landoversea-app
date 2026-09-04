const MYMEMORY_URL = "https://api.mymemory.translated.net/get";

export async function translateText(text, fromLang, toLang) {
  if (!text || fromLang === toLang) return text;
  const res = await fetch(
    `${MYMEMORY_URL}?q=${encodeURIComponent(text)}&langpair=${fromLang}|${toLang}`
  );
  if (!res.ok) throw new Error(`Translation failed (${res.status}).`);
  const data = await res.json();
  if (data?.responseData?.translatedText) {
    return data.responseData.translatedText;
  }
  throw new Error(data?.responseDetails || "Translation service returned no translation.");
}

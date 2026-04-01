const MYMEMORY_URL = "https://api.mymemory.translated.net/get";

export async function translateText(text, fromLang, toLang) {
  if (!text || fromLang === toLang) return text;
  try {
    const res = await fetch(
      `${MYMEMORY_URL}?q=${encodeURIComponent(text)}&langpair=${fromLang}|${toLang}`
    );
    const data = await res.json();
    if (data?.responseData?.translatedText) {
      return data.responseData.translatedText;
    }
    return text;
  } catch {
    return text;
  }
}

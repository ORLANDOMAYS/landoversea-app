export async function translateText(text, fromLang, toLang) {
  if (!text || fromLang === toLang) return text;
  throw new Error("Automatic translation is currently unavailable.");
}

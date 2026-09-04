export async function translateText(
  text: string,
  fromLang: string,
  toLang: string
): Promise<string> {
  if (fromLang === toLang || !text.trim()) return text;
  throw new Error("Automatic translation is currently unavailable.");
}

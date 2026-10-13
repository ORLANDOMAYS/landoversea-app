import {
  isCanonicalLanguage,
  normalizeLanguage,
  type CanonicalLanguageCode,
} from "./translation-languages";

export const DETECTION_SAMPLE_MAX = 500;
export const TRANSLATION_INPUT_MAX = 8_000;
export const TRANSLATION_OUTPUT_MAX = 12_000;

export type TranslationFailure = "timeout" | "rate_limited" | "malformed" | "provider_error" | "input_too_long";
export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: TranslationFailure };

type CompletionClient = {
  chat: { completions: { create(input: unknown, options?: { signal?: AbortSignal }): Promise<any> } };
};

export function createTranslationService(
  client: CompletionClient,
  options: { timeoutMs?: number; retryDelayMs?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const retryDelayMs = options.retryDelayMs ?? 100;
  const inFlight = new Map<string, Promise<unknown>>();

  const classify = (error: any): TranslationFailure => {
    if (error?.name === "AbortError" || error?.message === "translation_timeout") return "timeout";
    if (error?.status === 429 || error?.code === "rate_limit_exceeded") return "rate_limited";
    return "provider_error";
  };
  const boundedCall = async (input: unknown) => {
    let timer: NodeJS.Timeout | undefined;
    const controller = new AbortController();
    try {
      return await Promise.race([
        client.chat.completions.create(input, { signal: controller.signal }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("translation_timeout"));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const retry = async (input: unknown): Promise<ServiceResult<string>> => {
    let last: TranslationFailure = "provider_error";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await boundedCall(input);
        const output = response?.choices?.[0]?.message?.content;
        if (typeof output !== "string" || !output.trim() || output.length > TRANSLATION_OUTPUT_MAX) {
          last = "malformed";
        } else {
          return { ok: true, value: output.trim() };
        }
      } catch (error) {
        last = classify(error);
      }
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
    return { ok: false, error: last };
  };
  const dedupe = <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const existing = inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const promise = work().finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  };

  return {
    detect(text: string, key = text): Promise<ServiceResult<CanonicalLanguageCode>> {
      return dedupe(`detect:${key}`, async () => {
        const sample = text.trim().slice(0, DETECTION_SAMPLE_MAX);
        if (!sample) return { ok: false, error: "malformed" };
        const result = await retry({
          model: "gpt-5.6-luna",
          max_completion_tokens: 8,
          messages: [
            { role: "system", content: "Detect the language. Reply only with one supported canonical code: en, ja, pt, fr, es, ko, de, it, ru, zh-CN, ar, th, vi, id, hi, lo." },
            { role: "user", content: sample },
          ],
        });
        if (!result.ok) return result;
        const language = normalizeLanguage(result.value);
        return language ? { ok: true, value: language } : { ok: false, error: "malformed" };
      });
    },
    translate(
      text: string,
      targetLanguage: CanonicalLanguageCode,
      sourceLanguage?: CanonicalLanguageCode | null,
      key = text,
    ): Promise<ServiceResult<string> & { sameLanguage?: boolean }> {
      if (!isCanonicalLanguage(targetLanguage)) {
        return Promise.resolve({ ok: false, error: "malformed" });
      }
      if (sourceLanguage === targetLanguage) {
        return Promise.resolve({ ok: true, value: text, sameLanguage: true });
      }
      if (text.length > TRANSLATION_INPUT_MAX) {
        return Promise.resolve({ ok: false, error: "input_too_long" });
      }
      return dedupe(`translate:${key}:${targetLanguage}`, () => retry({
        model: "gpt-5.6-luna",
        max_completion_tokens: 8192,
        messages: [
          { role: "system", content: `Translate to ${targetLanguage}. Return only the translated text, without a prefix or explanation.` },
          { role: "user", content: text },
        ],
      }));
    },
    reset() {
      inFlight.clear();
    },
  };
}

// Lazy loading keeps the pure factory usable in deterministic tests without
// requiring provider credentials, while production still uses the existing
// Replit-managed client and its unchanged environment setup.
const managedClient: CompletionClient = {
  chat: {
    completions: {
      async create(input, options) {
        const { openai } = await import("@workspace/integrations-openai-ai-server");
        return (openai.chat.completions.create as any)(input, options);
      },
    },
  },
};

export const translationService = createTranslationService(managedClient);
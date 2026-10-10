import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../lib/auth";
import {
  isCanonicalLanguage,
  type CanonicalLanguageCode,
} from "../lib/translation-languages";
import {
  TRANSLATION_INPUT_MAX,
  translationService,
} from "../lib/translation-service";

const router: IRouter = Router();

export const TEXT_TRANSLATION_RATE_LIMIT = {
  windowMs: 60_000,
  max: 20,
} as const;

const textTranslationLimiter = rateLimit({
  ...TEXT_TRANSLATION_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many translation requests, please try again later" },
});

router.post(
  "/translations/text",
  requireAuth,
  textTranslationLimiter,
  async (req, res): Promise<void> => {
    const { text, targetLanguage, sourceLanguage } = req.body ?? {};
    if (typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "text must be a non-empty string" });
      return;
    }
    if (text.length > TRANSLATION_INPUT_MAX) {
      res.status(413).json({
        error: `text must not exceed ${TRANSLATION_INPUT_MAX} characters`,
      });
      return;
    }
    if (!isCanonicalLanguage(targetLanguage)) {
      res.status(400).json({ error: "targetLanguage must be a supported canonical language code" });
      return;
    }
    if (sourceLanguage != null && !isCanonicalLanguage(sourceLanguage)) {
      res.status(400).json({ error: "sourceLanguage must be a supported canonical language code" });
      return;
    }

    const originalContent = text.trim();
    const source = (sourceLanguage ?? null) as CanonicalLanguageCode | null;
    const result = await translationService.translate(
      originalContent,
      targetLanguage,
      source,
    );
    if (!result.ok) {
      const status = result.error === "rate_limited"
        ? 429
        : result.error === "timeout"
          ? 504
          : result.error === "input_too_long"
            ? 413
            : 502;
      res.status(status).json({
        error: "Translation failed",
        code: result.error,
      });
      return;
    }

    res.json({
      originalContent,
      translatedContent: result.value,
      sourceLanguage: source,
      targetLanguage,
      status: result.sameLanguage ? "same_language" : "done",
    });
  },
);

export default router;
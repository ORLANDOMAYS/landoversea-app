import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeUrl = new URL("../src/routes/translations.ts", import.meta.url);

test("text translation route is authenticated, bounded, validated, and ephemeral", async () => {
  const source = await readFile(routeUrl, "utf8");
  assert.match(source, /"\/translations\/text",\s*requireAuth,\s*textTranslationLimiter/s);
  assert.match(source, /TRANSLATION_INPUT_MAX/);
  assert.match(source, /isCanonicalLanguage\(targetLanguage\)/);
  assert.match(source, /isCanonicalLanguage\(sourceLanguage\)/);
  assert.match(source, /translationService\.translate/);
  assert.match(source, /rate_limited[\s\S]*429/);
  assert.doesNotMatch(source, /\bdb\.|insert\(|update\(|translationsTable/);
});
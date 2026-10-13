import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CANONICAL_LANGUAGE_CODES,
  isCanonicalLanguage,
  languageDirection,
  normalizeLanguage,
} from "../src/lib/translation-languages";
import {
  createTranslationService,
  DETECTION_SAMPLE_MAX,
  TRANSLATION_INPUT_MAX,
} from "../src/lib/translation-service";

test("all 16 canonical codes, common aliases, direction, and strict targets", () => {
  assert.equal(CANONICAL_LANGUAGE_CODES.length, 16);
  for (const code of CANONICAL_LANGUAGE_CODES) {
    assert.equal(normalizeLanguage(code), code);
    assert.equal(isCanonicalLanguage(code), true);
  }
  assert.equal(normalizeLanguage("English"), "en");
  assert.equal(normalizeLanguage("EN_us"), "en");
  assert.equal(normalizeLanguage("Japanese"), "ja");
  assert.equal(normalizeLanguage("pt-BR"), "pt");
  assert.equal(normalizeLanguage("zh_hans"), "zh-CN");
  assert.equal(normalizeLanguage("Simplified Chinese"), "zh-CN");
  assert.equal(normalizeLanguage("in"), "id");
  assert.equal(normalizeLanguage("Laotian"), "lo");
  assert.equal(normalizeLanguage("Klingon"), null);
  assert.equal(isCanonicalLanguage("English"), false);
  assert.equal(isCanonicalLanguage("zh-cn"), false);
  assert.equal(languageDirection("ar"), "rtl");
  assert.equal(languageDirection("Arabic"), "rtl");
  assert.equal(languageDirection("ja"), "ltr");
});

function client(handler: (input: any, call: number) => any) {
  let calls = 0;
  return {
    value: {
      chat: { completions: { create: async (input: any) => handler(input, ++calls) } },
    },
    calls: () => calls,
  };
}

const response = (content: unknown) => ({ choices: [{ message: { content } }] });

test("provider success, canonical detection, input bounds, and same-language bypass", async () => {
  let detectedSample = "";
  const fake = client((input) => {
    if (input.messages[0].content.startsWith("Detect")) {
      detectedSample = input.messages[1].content;
      return response("Spanish");
    }
    return response("hola");
  });
  const service = createTranslationService(fake.value, { retryDelayMs: 0 });
  const detection = await service.detect(`${"x".repeat(DETECTION_SAMPLE_MAX + 50)}`);
  assert.deepEqual(detection, { ok: true, value: "es" });
  assert.equal(detectedSample.length, DETECTION_SAMPLE_MAX);
  const translated = await service.translate("hello", "es", "en");
  assert.deepEqual(translated, { ok: true, value: "hola" });
  const calls = fake.calls();
  const same = await service.translate("unchanged", "en", "en");
  assert.equal(same.ok, true);
  assert.equal(same.sameLanguage, true);
  assert.equal(fake.calls(), calls);
  const tooLong = await service.translate("x".repeat(TRANSLATION_INPUT_MAX + 1), "es", "en");
  assert.deepEqual(tooLong, { ok: false, error: "input_too_long" });
});

test("malformed output retries once and classifies failure", async () => {
  const fake = client(() => response(""));
  const result = await createTranslationService(fake.value, { retryDelayMs: 0 })
    .translate("hello", "es", "en");
  assert.deepEqual(result, { ok: false, error: "malformed" });
  assert.equal(fake.calls(), 2);
});

test("rate limits retry once and can recover", async () => {
  const fake = client((_input, call) => {
    if (call === 1) throw Object.assign(new Error("limited"), { status: 429 });
    return response("hola");
  });
  const result = await createTranslationService(fake.value, { retryDelayMs: 0 })
    .translate("hello", "es", "en");
  assert.deepEqual(result, { ok: true, value: "hola" });
  assert.equal(fake.calls(), 2);
});

test("timeouts are bounded and retried once", async () => {
  const fake = client(() => new Promise(() => {}));
  const result = await createTranslationService(fake.value, { timeoutMs: 2, retryDelayMs: 0 })
    .translate("hello", "es", "en");
  assert.deepEqual(result, { ok: false, error: "timeout" });
  assert.equal(fake.calls(), 2);
});

test("in-flight translation calls dedupe by key and target", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fake = client(async () => {
    await gate;
    return response("hola");
  });
  const service = createTranslationService(fake.value, { retryDelayMs: 0 });
  const first = service.translate("hello", "es", "en", "message-1");
  const second = service.translate("hello", "es", "en", "message-1");
  release();
  assert.deepEqual(await first, { ok: true, value: "hola" });
  assert.deepEqual(await second, { ok: true, value: "hola" });
  assert.equal(fake.calls(), 1);
});

test("post-send notifications and language processing are independently scheduled", () => {
  const source = readFileSync(new URL("../src/routes/messages.ts", import.meta.url), "utf8");
  const responseAt = source.indexOf("res.status(201).json({ ...msg");
  const notificationAt = source.indexOf("const notificationWork = (async () =>");
  const languageAt = source.indexOf("const languageWork = (async () =>");
  const concurrentAt = source.indexOf("Promise.allSettled([notificationWork, languageWork])");
  assert.ok(responseAt >= 0 && responseAt < notificationAt, "send response precedes background work");
  assert.ok(notificationAt < concurrentAt && languageAt < concurrentAt,
    "both independently caught tasks start before concurrent settlement");
  assert.match(source, /notificationWork[\s\S]*?\.catch\(\(\) =>/);
  assert.match(source, /languageWork[\s\S]*?\.catch\(\(\) =>/);
});
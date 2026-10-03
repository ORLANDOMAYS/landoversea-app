import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import test from 'node:test';

// ─────────────────────────────────────────────────────────────────────────────
// Read-only i18n locale-coverage test.
//
// English (locales/en.ts) is the source of truth. Every OTHER locale is a
// Partial<Translation>, so it is allowed to omit keys (the provider falls back
// to English per key). This test does NOT require non-English locales to be
// complete.
//
// What it DOES enforce: every leaf key that a non-English locale DOES define
// must correspond to a real leaf key in English. In other words, a non-English
// dictionary may not reference a path that English lacks — that would be a dead
// / mistyped key. Conversely, the test reports (and fails) whenever a
// non-English locale is missing English leaf keys, so it stays visible which
// dictionaries still need translation after new keys are added to English.
//
// It is intentionally allowed to fail while translation dictionaries are being
// filled in. Failures are grouped per locale and list the exact missing paths.
// ─────────────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const localesDir = join(here, '..', 'src', 'i18n', 'locales');

// Extract and evaluate the default-exported object literal from a locale .ts
// file. Locale files are plain object literals plus TS-only type syntax, so we
// strip the type-only bits and evaluate the literal in an isolated scope.
async function loadLocaleObject(filePath) {
  const source = await readFile(filePath, 'utf8');

  // Grab the object literal assigned to the default-exported const, tolerating
  // an optional `: Type` annotation, e.g.
  //   const ja: Translation = { ... };
  //   const en = { ... };
  const match = source.match(
    /const\s+\w+\s*(?::\s*[\w.<>\[\]| ]+)?\s*=\s*(\{[\s\S]*?\});\s*\n\s*export\s+default\s+\w+;/,
  );
  assert.ok(
    match,
    `Could not locate the default-exported object literal in ${basename(filePath)}`,
  );

  const literal = match[1];
  // The literal is valid JS on its own (no TS-only syntax inside the object).
  // Evaluate it in a function scope with nothing in scope.
  // eslint-disable-next-line no-new-func
  const factory = new Function(`"use strict"; return (${literal});`);
  return factory();
}

// Collect the set of dotted leaf paths (paths whose value is a string).
function collectLeafPaths(obj, prefix = '', out = new Set()) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out.add(path);
    } else if (value && typeof value === 'object') {
      collectLeafPaths(value, path, out);
    }
  }
  return out;
}

const enPath = join(localesDir, 'en.ts');
const englishLeafPaths = collectLeafPaths(await loadLocaleObject(enPath));

const files = (await readdir(localesDir)).filter(
  (f) => f.endsWith('.ts') && f !== 'en.ts',
);

test('production i18n loads only English and the selected locale at startup', async () => {
  const source = await readFile(join(localesDir, '..', 'dictionaries.ts'), 'utf8');
  assert.match(source, /import en from ['"]\.\/locales\/en['"]/);
  assert.doesNotMatch(
    source,
    /import \w+ from ['"]\.\/locales\/(?!en(?:['"]))/,
    'non-English dictionaries must not be eager imports',
  );
  for (const file of files) {
    const locale = basename(file, '.ts');
    assert.match(
      source,
      new RegExp(`import\\(['"]\\.\\/locales\\/${locale.replace('-', '\\-')}['"]\\)`),
      `${locale} must remain available through a lazy loader`,
    );
  }
  assert.match(source, /const cache = new Map<Locale, Dictionary>/);
});

test('every route page stays outside the application startup chunk', async () => {
  const app = await readFile(join(localesDir, '..', '..', 'App.tsx'), 'utf8');
  assert.doesNotMatch(
    app,
    /^import \w+ from ['"]\.\/pages\//m,
    'route pages must use React.lazy instead of entering the startup graph',
  );
  for (const page of [
    'login',
    'register',
    'onboarding',
    'forgot-password',
    'reset-password',
    'verify-email',
    'delete-account',
    'discover',
    'profile-details',
  ]) {
    assert.match(app, new RegExp(`lazy\\(\\(\\) => import\\(['"]\\.\\/pages\\/${page}['"]\\)\\)`));
  }
});

for (const file of files) {
  const locale = basename(file, '.ts');

  test(`locale "${locale}" only defines keys that exist in English`, async () => {
    const dict = await loadLocaleObject(join(localesDir, file));
    const localeLeaves = collectLeafPaths(dict);
    const unknown = [...localeLeaves].filter((p) => !englishLeafPaths.has(p));
    assert.deepEqual(
      unknown,
      [],
      `Locale "${locale}" defines keys not present in English:\n  ${unknown.join('\n  ')}`,
    );
  });

  test(`locale "${locale}" covers every English leaf key`, async () => {
    const dict = await loadLocaleObject(join(localesDir, file));
    const localeLeaves = collectLeafPaths(dict);
    const missing = [...englishLeafPaths].filter((p) => !localeLeaves.has(p));
    assert.deepEqual(
      missing,
      [],
      `Locale "${locale}" is missing ${missing.length} English leaf key(s):\n  ${missing.join('\n  ')}`,
    );
  });
}

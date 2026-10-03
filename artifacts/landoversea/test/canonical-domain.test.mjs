import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const CANONICAL_ORIGIN = 'https://landover-sea.com';
const LEGACY_REPLIT_HOST = 'land-over-sea-international.replit.app';

test('web metadata, robots, and sitemap publish only canonical URLs', async () => {
  const [index, robots, sitemap] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/robots.txt', import.meta.url), 'utf8'),
    readFile(new URL('../public/sitemap.xml', import.meta.url), 'utf8'),
  ]);

  assert.match(index, new RegExp(`<link rel="canonical" href="${CANONICAL_ORIGIN}/"`));
  assert.match(index, new RegExp(`<meta property="og:url" content="${CANONICAL_ORIGIN}/"`));
  assert.match(index, new RegExp(`<meta name="twitter:url" content="${CANONICAL_ORIGIN}/"`));
  assert.doesNotMatch(index, /built on Replit|Update this description/);
  assert.match(robots, new RegExp(`Sitemap: ${CANONICAL_ORIGIN}/sitemap\\.xml`));

  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, value]) => value);
  assert.deepEqual(locations, [`${CANONICAL_ORIGIN}/`]);
  assert.doesNotMatch(`${index}\n${robots}\n${sitemap}`, new RegExp(LEGACY_REPLIT_HOST.replaceAll('.', '\\.')));
});

test('tracked production URL settings use the canonical web and mobile host', async () => {
  const config = await readFile(new URL('../../../.replit', import.meta.url), 'utf8');
  const webOrigins = [...config.matchAll(/VITE_PUBLIC_APP_URL = "([^"]+)"/g)].map(([, value]) => value);

  assert.ok(webOrigins.length >= 2);
  assert.ok(webOrigins.every(value => value === CANONICAL_ORIGIN));
  assert.match(config, /EXPO_PUBLIC_DOMAIN = "landover-sea\.com"/);
  assert.match(config, /PUBLIC_APP_URL = "https:\/\/landover-sea\.com"/);
  assert.match(config, /ALLOWED_ORIGINS = "https:\/\/landover-sea\.com"/);
  assert.doesNotMatch(config, new RegExp(LEGACY_REPLIT_HOST.replaceAll('.', '\\.')));
});
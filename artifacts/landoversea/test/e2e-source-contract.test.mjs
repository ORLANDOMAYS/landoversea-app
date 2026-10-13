import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

test('release E2E uses only public normal-user Supabase contracts', async () => {
  const directory = new URL('../e2e/', import.meta.url);
  const files = (await readdir(directory)).filter(name => /\.(?:ts|mts)$/.test(name));
  const source = (await Promise.all(
    files.map(name => readFile(new URL(name, directory), 'utf8')),
  )).join('\n');

  const forbidden = [
    ['SERVICE', 'ROLE'].join('_'),
    ['service', 'role'].join('[\\s_-]*'),
    ['auth', 'admin'].join('\\s*\\.\\s*'),
    ['auth', 'users'].join('[\\s/._-]*'),
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(source, new RegExp(pattern, 'i'));
  }
  assert.match(source, /VITE_SUPABASE_URL/);
  assert.match(source, /VITE_SUPABASE_ANON_KEY/);
  assert.match(source, /button-register-submit/);
  assert.match(source, /status-register-verification-pending/);
  assert.match(source, /\/auth\/callback/);
  assert.match(source, /https:\/\/landover-sea\.com/);
  assert.doesNotMatch(source, /land-over-sea-international\.replit\.app/);
  assert.match(source, /redirect:\s*'manual'/);
  assert.match(source, /deliveredCallback\.origin\s*!==\s*canonicalCallbackOrigin/);
  assert.match(source, /deliveredCallback\.pathname\s*!==\s*'\/auth\/callback'/);
  assert.doesNotMatch(source, /new Set\(\[appOrigin,\s*expectedCallbackOrigin\]\)/);
  assert.match(source, /browser\.newContext\(\{\s*baseURL,\s*storageState:\s*statePath/);
  assert.match(source, /context\.storageState\(\{\s*path:\s*statePath/);
  assert.doesNotMatch(source, /candidate\.name\?\.startsWith\('sb-'\)/);
  assert.match(source, /rest\/v1\/rpc\/ensure_match/);
  assert.match(source, /direction:\s*'like'/);
  assert.match(source, /Release Secondary[\s\S]*Send message/);
});
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildAuthCallbackUrl,
  LANDOVERSEA_AUTH_SCHEME,
  NATIVE_AUTH_CALLBACK_URL,
} from '../lib/auth-callback-url.ts';
import { parseAuthCallbackUrl } from '../lib/auth-flow.ts';
import {
  completePasswordRecovery,
  PasswordRecoveryCompletionError,
} from '../lib/password-recovery-flow.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

async function read(relative) {
  return readFile(join(root, relative), 'utf8');
}

test('recovery links use the registered LandOverSEA callback scheme', async () => {
  const config = JSON.parse(await read('app.json'));
  assert.equal(LANDOVERSEA_AUTH_SCHEME, 'landoversea');
  assert.equal(config.expo.scheme, LANDOVERSEA_AUTH_SCHEME);
  assert.equal(NATIVE_AUTH_CALLBACK_URL, 'landoversea:///auth-callback');
  assert.equal(
    buildAuthCallbackUrl(NATIVE_AUTH_CALLBACK_URL, { type: 'recovery' }),
    'landoversea:///auth-callback?type=recovery',
  );

  const androidSchemes = config.expo.android.intentFilters
    .flatMap(filter => filter.data || [])
    .map(entry => entry.scheme);
  assert.ok(androidSchemes.includes(LANDOVERSEA_AUTH_SCHEME));
  assert.ok(!androidSchemes.includes('landoversea-mobile'));
});

test('PKCE recovery callbacks remain distinct from magic-link sign-in callbacks', () => {
  assert.deepEqual(
    parseAuthCallbackUrl(
      'landoversea:///auth-callback?type=recovery&code=recovery-code',
    ),
    { kind: 'pkce', code: 'recovery-code', isRecovery: true },
  );
  assert.deepEqual(
    parseAuthCallbackUrl('landoversea:///auth-callback?code=magic-link-code'),
    { kind: 'pkce', code: 'magic-link-code', isRecovery: false },
  );
});

test('successful password recovery updates the password and closes the local session', async () => {
  const calls = [];
  const auth = {
    async updateUser(attributes) {
      calls.push(['updateUser', attributes]);
      return { error: null };
    },
    async signOut(options) {
      calls.push(['signOut', options]);
      return { error: null };
    },
  };
  const clearRecoverySession = async () => {
    calls.push(['clearRecoverySession']);
  };

  await completePasswordRecovery(auth, 'new-secure-password', clearRecoverySession);

  assert.deepEqual(calls, [
    ['updateUser', { password: 'new-secure-password' }],
    ['signOut', { scope: 'local' }],
    ['clearRecoverySession'],
  ]);
});

test('cleanup failures report that the password was already updated', async () => {
  const auth = {
    async updateUser() {
      return { error: null };
    },
    async signOut() {
      return { error: null };
    },
  };

  await assert.rejects(
    completePasswordRecovery(auth, 'new-secure-password', async () => {
      throw new Error('secure storage unavailable');
    }),
    error => {
      assert.ok(error instanceof PasswordRecoveryCompletionError);
      assert.equal(error.stage, 'close-session');
      assert.equal(error.passwordUpdated, true);
      return true;
    },
  );
});

test('invalid and expired recovery callbacks remain recovery errors', () => {
  const parsed = parseAuthCallbackUrl(
    'landoversea:///auth-callback?type=recovery&error=access_denied&error_description=Email%20link%20is%20invalid%20or%20has%20expired',
  );
  assert.deepEqual(parsed, {
    kind: 'error',
    message: 'Email link is invalid or has expired',
    isRecovery: true,
  });
});

test('mobile routing exposes a public auth callback and dedicated reset page', async () => {
  const [layout, callback, reset] = await Promise.all([
    read('app/_layout.tsx'),
    read('app/auth-callback.tsx'),
    read('app/(auth)/reset-password.tsx'),
  ]);

  assert.match(layout, /<Stack\.Screen name="auth-callback" \/>/);
  assert.match(layout, /const isAuthCallback = \(segments\[0\] as string\) === 'auth-callback'/);
  assert.match(callback, /router\.replace\('\/\(auth\)\/reset-password'\)/);
  assert.match(callback, /router\.replace\('\/'\)/);
  assert.match(reset, /completePasswordRecovery/);
  assert.match(reset, /router\.replace\('\/\(auth\)\/login'\)/);
});
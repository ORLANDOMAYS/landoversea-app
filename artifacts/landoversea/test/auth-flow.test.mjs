import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildAuthCallbackUrl,
  CANONICAL_APP_ORIGIN,
  parseAuthCallback,
  resolveAuthCallbackOrigin,
  resolveDevelopmentAuthCallbackOrigin,
  validateSameAppDestination,
} from '../src/lib/auth-flow.ts';
import { getEmailRetryAfter, isEmailRateLimitError } from '../src/lib/password-recovery.ts';

test('same-app auth destinations accept local paths and reject open redirects', () => {
  assert.equal(validateSameAppDestination('/messages/abc?tab=recent#latest'), '/messages/abc?tab=recent#latest');
  assert.equal(validateSameAppDestination('https://evil.example/path'), null);
  assert.equal(validateSameAppDestination('//evil.example/path'), null);
  assert.equal(validateSameAppDestination('/\\evil.example/path'), null);
  assert.equal(validateSameAppDestination('javascript:alert(1)'), null);
});

test('production callback origin only accepts a configured bare HTTPS origin', () => {
  assert.equal(
    resolveAuthCallbackOrigin(true, CANONICAL_APP_ORIGIN, 'https://preview.example'),
    CANONICAL_APP_ORIGIN,
  );
  assert.equal(
    resolveAuthCallbackOrigin(true, 'http://app.landoversea.com', 'https://preview.example'),
    CANONICAL_APP_ORIGIN,
  );
  assert.equal(
    resolveAuthCallbackOrigin(true, 'https://app.landoversea.com/path', 'https://preview.example'),
    CANONICAL_APP_ORIGIN,
  );
  assert.equal(
    resolveAuthCallbackOrigin(true, undefined, 'https://preview.example'),
    CANONICAL_APP_ORIGIN,
  );
  assert.equal(
    resolveAuthCallbackOrigin(true, 'https://other.example', 'https://preview.example'),
    CANONICAL_APP_ORIGIN,
  );
  assert.equal(
    resolveAuthCallbackOrigin(false, 'https://app.landoversea.com', 'http://localhost:5173'),
    'http://localhost:5173',
  );
});

test('development callback origins are limited to loopback, canonical, and Replit previews', () => {
  const previewOrigin =
    'https://e7dbac09-7369-47e9-b8b0-366680a9173b-00-1g3076z16q7iu.kirk.replit.dev';
  assert.equal(resolveDevelopmentAuthCallbackOrigin(previewOrigin), previewOrigin);
  assert.equal(
    resolveDevelopmentAuthCallbackOrigin('http://localhost:5173'),
    'http://localhost:5173',
  );
  assert.equal(
    resolveDevelopmentAuthCallbackOrigin('http://127.0.0.1:5173'),
    'http://127.0.0.1:5173',
  );
  assert.equal(
    resolveDevelopmentAuthCallbackOrigin(CANONICAL_APP_ORIGIN),
    CANONICAL_APP_ORIGIN,
  );
  assert.equal(
    resolveDevelopmentAuthCallbackOrigin('https://land-over-sea-international.replit.app'),
    CANONICAL_APP_ORIGIN,
  );
  assert.equal(
    resolveDevelopmentAuthCallbackOrigin('https://landover-sea.com.evil.example'),
    CANONICAL_APP_ORIGIN,
  );
  assert.equal(
    resolveDevelopmentAuthCallbackOrigin('https://preview.example/path'),
    CANONICAL_APP_ORIGIN,
  );
});

test('callback URLs retain the Vite base path and only include validated next paths', () => {
  assert.equal(
    buildAuthCallbackUrl('https://example.test', '/landoversea/', '/messages'),
    'https://example.test/landoversea/auth/callback?next=%2Fmessages',
  );
  assert.equal(
    buildAuthCallbackUrl('https://example.test', '/landoversea/', 'https://evil.example'),
    'https://example.test/landoversea/auth/callback',
  );
  assert.equal(
    buildAuthCallbackUrl(
      'https://example.test',
      '/landoversea/',
      '/reset-password',
      'recovery',
    ),
    'https://example.test/landoversea/auth/callback?next=%2Freset-password&type=recovery',
  );
});

test('callback parsing returns a safe next destination with the PKCE code', () => {
  assert.deepEqual(
    parseAuthCallback('?code=verified-code&next=%2Fsettings%3Ftab%3Dprivacy'),
    {
      kind: 'pkce',
      code: 'verified-code',
      next: '/settings?tab=privacy',
      isRecovery: false,
    },
  );
  assert.deepEqual(
    parseAuthCallback('?code=verified-code&next=https%3A%2F%2Fevil.example'),
    { kind: 'pkce', code: 'verified-code', next: null, isRecovery: false },
  );
  assert.deepEqual(
    parseAuthCallback('?error=access_denied&error_description=expired&next=%2Freset-password'),
    {
      kind: 'error',
      message: 'expired',
      next: '/reset-password',
      isRecovery: true,
    },
  );
  assert.deepEqual(
    parseAuthCallback('?token_hash=verified-token&type=recovery'),
    {
      kind: 'recovery-token',
      tokenHash: 'verified-token',
      next: null,
      isRecovery: true,
    },
  );
  assert.deepEqual(
    parseAuthCallback(
      '?next=%2Freset-password',
      '#access_token=access&refresh_token=refresh&type=recovery',
    ),
    {
      kind: 'legacy',
      accessToken: 'access',
      refreshToken: 'refresh',
      next: '/reset-password',
      isRecovery: true,
    },
  );
});

test('Supabase rate-limit errors are recognized without depending on message wording', () => {
  assert.equal(isEmailRateLimitError({ status: 429 }), true);
  assert.equal(isEmailRateLimitError({ code: 'over_email_send_rate_limit' }), true);
  assert.equal(isEmailRateLimitError(new Error('email rate limit exceeded')), true);
  assert.equal(isEmailRateLimitError(new Error('For security purposes, you can only request this after 60 seconds.')), true);
  assert.equal(isEmailRateLimitError(new Error('invalid login credentials')), false);
});

test('email retry delays use server hints safely and only for email rate limits', () => {
  assert.equal(getEmailRetryAfter({ status: 429, retryAfter: 12.1 }), 13);
  assert.equal(getEmailRetryAfter({ code: 'over_email_send_rate_limit', data: { retry_after: 90 } }), 90);
  assert.equal(getEmailRetryAfter(new Error('Too many email requests')), 60);
  assert.equal(getEmailRetryAfter({ status: 429, retry_after: 0 }), 1);
  assert.equal(getEmailRetryAfter({ status: 429, retryAfter: 86_400 }), 3_600);
  assert.equal(getEmailRetryAfter({ message: 'invalid login credentials', retryAfter: 30 }), 0);
});

test('password auth and recovery stay on the Supabase session boundary', async () => {
  const [forgot, reset, login, register, callback] = await Promise.all([
    readFile(new URL('../src/pages/forgot-password.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/reset-password.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/login.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/register.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/auth-callback.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(forgot, /resetPasswordForEmail/);
  assert.match(forgot, /'\/reset-password'/);
  assert.match(forgot, /'recovery'/);
  assert.doesNotMatch(forgot, /api\/auth\/forgot-password/);
  assert.match(reset, /updateUser\(\{ password: newPassword \}\)/);
  assert.match(reset, /signOut\(\{ scope: 'local' \}\)/);
  assert.match(login, /signInWithPassword/);
  assert.match(register, /\.auth\.signUp/);
  assert.match(login, /signInWithOtp/);
  assert.match(login, /shouldCreateUser:\s*false/);
  assert.match(login, /magicLinkInFlight\.current/);
  assert.match(register, /\.auth\.resend\(\{\s*type: 'signup'/s);
  assert.match(register, /signupInFlight\.current/);
  assert.match(register, /resendInFlight\.current/);
  assert.match(forgot, /recoveryInFlight\.current/);
  assert.match(forgot, /getEmailRetryAfter\(error\)/);
  assert.match(register, /getEmailRetryAfter\(error\)/);
  assert.match(login, /getEmailRetryAfter\(error\)/);
  assert.doesNotMatch(login.slice(login.indexOf('const onSubmit'), login.indexOf('const requestMagicLink')), /getEmailRetryAfter/);
  assert.match(
    register.slice(register.indexOf('const onSubmit'), register.indexOf('const resendVerification')),
    /getEmailRetryAfter\(error\)[\s\S]*setResendCooldown\(emailRetryAfter\)[\s\S]*t\('auth\.verifyCooldown'\)/,
  );
  assert.match(callback, /markPasswordRecoverySession/);
  assert.match(callback, /pendingCodeExchanges/);
  assert.match(callback, /verifyOtp/);
  assert.match(callback, /setSession/);
  assert.match(callback, /upsertOwnProfile/);
  assert.doesNotMatch(callback, /\.from\('profiles'\)[\s\S]{0,300}\.upsert\(/);
});
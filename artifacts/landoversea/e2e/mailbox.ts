import { expect, type Page } from '@playwright/test';

const MAIL_API = 'https://api.mail.tm';

type Inbox = {
  address: string;
  token: string;
};

class MailRequestError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | null,
    detail: string | null,
  ) {
    super(`mail.tm request failed (${status})${detail ? `: ${detail}` : ''}`);
  }
}

function collection<T>(value: T[] | { 'hydra:member'?: T[]; member?: T[] }): T[] {
  if (Array.isArray(value)) return value;
  return value['hydra:member'] ?? value.member ?? [];
}

function retryDelay(response: Response): number | null {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

async function mailRequest<T>(
  pathname: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const response = await fetch(`${MAIL_API}${pathname}`, {
    ...init,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const raw = await response.text();
  if (!response.ok) {
    let detail: string | null = null;
    try {
      const parsed = JSON.parse(raw) as {
        detail?: string;
        'hydra:description'?: string;
        violations?: Array<{ message?: string }>;
      };
      detail = parsed.detail
        ?? parsed['hydra:description']
        ?? parsed.violations?.find(item => item.message)?.message
        ?? null;
    } catch {
      // Keep non-JSON provider bodies out of test output.
    }
    throw new MailRequestError(response.status, retryDelay(response), detail);
  }
  return JSON.parse(raw) as T;
}

async function mailRequestWithRetry<T>(request: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (
        !(error instanceof MailRequestError)
        || (error.status !== 429 && error.status < 500)
        || attempt === 2
      ) {
        throw error;
      }
      const fallbackMs = 15_000 * (attempt + 1);
      const delayMs = Math.min(Math.max(error.retryAfterMs ?? fallbackMs, 1_000), 60_000);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

export async function createInbox(label: string): Promise<Inbox> {
  const domains = await mailRequest<
    Array<{ domain: string; isActive?: boolean; isPrivate?: boolean }>
    | {
      'hydra:member'?: Array<{ domain: string; isActive?: boolean; isPrivate?: boolean }>;
      member?: Array<{ domain: string; isActive?: boolean; isPrivate?: boolean }>;
    }
  >('/domains?page=1');
  const domain = collection(domains).find(
    item => item.domain && item.isActive !== false && item.isPrivate !== true,
  )?.domain;
  if (!domain) throw new Error('mail.tm did not return an available public domain.');

  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 1) || 'x';
  let lastError: unknown;
  for (let addressAttempt = 0; addressAttempt < 3; addressAttempt += 1) {
    // mail.tm currently rejects long and hyphenated local parts.
    const localPart = `los${safeLabel}${crypto.randomUUID().replaceAll('-', '').slice(0, 11)}`;
    const address = `${localPart}@${domain}`;
    const password = `Mbx-${crypto.randomUUID()}!`;
    try {
      await mailRequestWithRetry(() => mailRequest('/accounts', {
        method: 'POST',
        body: JSON.stringify({ address, password }),
      }));
      const session = await mailRequestWithRetry(() => mailRequest<{ token: string }>('/token', {
        method: 'POST',
        body: JSON.stringify({ address, password }),
      }));
      return { address, token: session.token };
    } catch (error) {
      lastError = error;
      if (
        !(error instanceof MailRequestError)
        || (error.status !== 409 && error.status !== 422)
        || addressAttempt === 2
      ) {
        throw error;
      }
    }
  }
  throw lastError;
}

function decodeHtml(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&#x3D;', '=')
    .replaceAll('&#61;', '=')
    .replaceAll('&quot;', '"');
}

async function pollForMessage(token: string): Promise<string> {
  const deadline = Date.now() + 75_000;
  let delay = 1_000;
  while (Date.now() < deadline) {
    const list = await mailRequest<
      Array<{ id: string; subject: string }>
      | { 'hydra:member'?: Array<{ id: string; subject: string }>; member?: Array<{ id: string; subject: string }> }
    >('/messages?page=1', {}, token);
    const delivered = collection(list).find(message =>
      /sign|magic|confirm|login/i.test(message.subject),
    ) ?? collection(list)[0];
    if (delivered) {
      const message = await mailRequest<{ html?: string[] | string; text?: string }>(
        `/messages/${delivered.id}`,
        {},
        token,
      );
      return [
        ...(Array.isArray(message.html) ? message.html : [message.html ?? '']),
        message.text ?? '',
      ].join('\n');
    }
    await new Promise(resolve => setTimeout(resolve, delay));
    delay = Math.min(Math.round(delay * 1.5), 5_000);
  }
  throw new Error('Timed out waiting for the Supabase sign-in email at mail.tm.');
}

function actionLinkFromEmail(
  body: string,
  supabaseUrl: string,
): string {
  const candidates = decodeHtml(body).match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  const expectedAuthOrigin = new URL(supabaseUrl).origin;
  for (const raw of candidates) {
    let candidate: URL;
    try {
      candidate = new URL(raw.replace(/[).,]+$/, ''));
    } catch {
      continue;
    }
    if (candidate.origin !== expectedAuthOrigin || !candidate.pathname.endsWith('/auth/v1/verify')) {
      continue;
    }
    if (!candidate.searchParams.get('token') && !candidate.searchParams.get('token_hash')) {
      throw new Error('Delivered sign-in link has no verification token.');
    }
    return candidate.toString();
  }
  throw new Error('No valid Supabase sign-in action was found in the delivered email.');
}

export async function registerFromDeliveredLink(
  page: Page,
  inbox: Inbox,
  supabaseUrl: string,
  appOrigin: string,
  canonicalCallbackOrigin: string,
  trustedRequestedCallbackOrigins: readonly string[],
  displayName: string,
): Promise<void> {
  const password = `Los-${crypto.randomUUID()}!Aa1`;
  await page.goto('/register');
  await page.getByTestId('button-register-continue-language').click();
  await page.getByTestId('button-register-confirm-age').click();
  await page.getByTestId('input-register-name').fill(displayName);
  await page.getByTestId('input-register-email').fill(inbox.address);
  await page.getByTestId('input-register-password').fill(password);
  await page.getByTestId('input-register-confirm-password').fill(password);
  await page.getByTestId('button-register-submit').click();
  await expect(page.getByTestId('status-register-verification-pending')).toContainText(
    'Check your email to verify your account',
  );

  const body = await pollForMessage(inbox.token);
  const actionLink = actionLinkFromEmail(body, supabaseUrl);
  const verificationUrl = new URL(actionLink);
  const requestedRedirect = verificationUrl.searchParams.get('redirect_to');
  if (!requestedRedirect) {
    throw new Error('Delivered sign-in link does not retain the requested callback.');
  }
  const requestedCallback = new URL(requestedRedirect);
  if (
    !trustedRequestedCallbackOrigins.includes(requestedCallback.origin)
    || requestedCallback.pathname !== '/auth/callback'
  ) {
    throw new Error(
      'Delivered sign-in link contains an untrusted requested callback: '
      + `${requestedCallback.origin}${requestedCallback.pathname}.`,
    );
  }
  const canonicalCallback = new URL(
    `${requestedCallback.pathname}${requestedCallback.search}`,
    canonicalCallbackOrigin,
  );
  verificationUrl.searchParams.set('redirect_to', canonicalCallback.toString());

  const verified = await fetch(verificationUrl, { redirect: 'manual' });
  if (verified.status < 300 || verified.status >= 400) {
    throw new Error(`Supabase verification did not return a redirect (${verified.status}).`);
  }
  const location = verified.headers.get('location');
  if (!location) throw new Error('Supabase verification redirect has no Location header.');
  const deliveredCallback = new URL(location);
  if (
    deliveredCallback.origin !== canonicalCallbackOrigin
    || deliveredCallback.pathname !== '/auth/callback'
  ) {
    throw new Error(
      'Supabase verification returned an untrusted callback destination: '
      + `expected ${canonicalCallbackOrigin}/auth/callback, received `
      + `${deliveredCallback.origin}${deliveredCallback.pathname}.`,
    );
  }
  const code = deliveredCallback.searchParams.get('code');
  if (!code || !/^[A-Za-z0-9_-]+$/.test(code)) {
    throw new Error('Supabase verification redirect has no valid PKCE code.');
  }
  const localCallback = new URL('/auth/callback', appOrigin);
  localCallback.searchParams.set('code', code);
  await page.goto(localCallback.toString());
  await expect(page).toHaveURL(/\/(onboarding|discover)$/);
}

function authStorageKey(supabaseUrl: string): string {
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
  if (!/^[a-z0-9-]+$/i.test(projectRef)) throw new Error('Invalid Supabase project URL.');
  return `sb-${projectRef}-auth-token`;
}

export async function completeReleaseProfile(
  page: Page,
  supabaseUrl: string,
  anonKey: string,
  displayName: string,
): Promise<void> {
  const storageKey = authStorageKey(supabaseUrl);
  await page.evaluate(async ({ endpoint, key, name, storageKey }) => {
    const stored = localStorage.getItem(storageKey);
    if (!stored) throw new Error('Supabase browser session was not persisted.');
    const session = JSON.parse(stored);
    const accessToken = session.access_token ?? session.currentSession?.access_token;
    const userId = session.user?.id ?? session.currentSession?.user?.id;
    if (!accessToken || !userId) throw new Error('Persisted session is missing its user token.');
    const response = await fetch(`${endpoint}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: {
        apikey: key,
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body: JSON.stringify({ display_name: name, age: 30, gender: 'female' }),
    });
    if (!response.ok) throw new Error(`Normal-user profile completion failed (${response.status}).`);
  }, { endpoint: supabaseUrl, key: anonKey, name: displayName, storageKey });
  await page.goto('/profile');
  await expect(page).not.toHaveURL(/\/login$/);
}
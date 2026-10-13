import { test as setup } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  completeReleaseProfile,
  createInbox,
  registerFromDeliveredLink,
} from './mailbox';

const here = path.dirname(fileURLToPath(import.meta.url));
const authDir = path.join(here, '.auth');
const REPLIT_PREVIEW_HOST_SUFFIX = '.replit.dev';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

setup.setTimeout(300_000);

function isTrustedE2EOrigin(origin: string, canonicalOrigin: string): boolean {
  const candidate = new URL(origin);
  if (candidate.origin !== origin || candidate.pathname !== '/') return false;
  if (candidate.origin === canonicalOrigin) return true;
  if (
    LOOPBACK_HOSTS.has(candidate.hostname)
    && (candidate.protocol === 'http:' || candidate.protocol === 'https:')
  ) {
    return true;
  }
  return (
    candidate.protocol === 'https:'
    && candidate.hostname.endsWith(REPLIT_PREVIEW_HOST_SUFFIX)
    && candidate.hostname.length > REPLIT_PREVIEW_HOST_SUFFIX.length
  );
}

async function hasValidStorageState(
  browser: import('@playwright/test').Browser,
  statePath: string,
  baseURL: string,
  expectedName: string,
): Promise<boolean> {
  let context: import('@playwright/test').BrowserContext | undefined;
  try {
    context = await browser.newContext({ baseURL, storageState: statePath });
    const page = await context.newPage();
    await page.goto('/profile');
    await page.getByText(expectedName).first().waitFor({ state: 'visible', timeout: 15_000 });
    await context.storageState({ path: statePath });
    return true;
  } catch {
    return false;
  } finally {
    await context?.close();
  }
}

setup('provision two reusable normal-user sessions', async ({ browser, baseURL }) => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim();
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !anonKey) {
    throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required for release E2E.');
  }
  const appOrigin = new URL(baseURL!).origin;
  const configuredCanonical = process.env.E2E_CANONICAL_APP_ORIGIN?.trim()
    || 'https://landover-sea.com';
  const canonical = new URL(configuredCanonical);
  if (canonical.origin !== configuredCanonical || canonical.protocol !== 'https:') {
    throw new Error('E2E_CANONICAL_APP_ORIGIN must be an exact HTTPS origin.');
  }
  if (!isTrustedE2EOrigin(appOrigin, canonical.origin)) {
    throw new Error('E2E_BASE_URL must use the canonical site, loopback, or a Replit preview origin.');
  }
  const trustedCallbackOrigins = [...new Set([canonical.origin, appOrigin])];
  await mkdir(authDir, { recursive: true });

  // Exactly two identities are created per full run and then reused through
  // storage state. Supabase does not expose identity deletion to an ordinary
  // user, so these disposable mailbox identities expire naturally rather than
  // attempting privileged cleanup.
  for (const account of [
    { label: 'primary', name: 'Release Primary' },
    { label: 'secondary', name: 'Release Secondary' },
  ]) {
    const statePath = path.join(authDir, `${account.label}.json`);
    if (await hasValidStorageState(browser, statePath, baseURL!, account.name)) continue;

    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    const inbox = await createInbox(account.label);
    await registerFromDeliveredLink(
      page,
      inbox,
      supabaseUrl,
      appOrigin,
      canonical.origin,
      trustedCallbackOrigins,
      account.name,
    );
    await completeReleaseProfile(page, supabaseUrl, anonKey, account.name);
    await context.storageState({ path: statePath });
    await context.close();
  }
});
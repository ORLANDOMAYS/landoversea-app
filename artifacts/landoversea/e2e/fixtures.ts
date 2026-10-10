import { test as base, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function publicConfiguration() {
  const endpoint = process.env.VITE_SUPABASE_URL?.trim();
  const key = process.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!endpoint || !key) throw new Error('Public Supabase E2E configuration is required.');
  const projectRef = new URL(endpoint).hostname.split('.')[0];
  if (!/^[a-z0-9-]+$/i.test(projectRef)) throw new Error('Invalid Supabase project URL.');
  return { endpoint: endpoint.replace(/\/$/, ''), key, storageKey: `sb-${projectRef}-auth-token` };
}

export async function currentSupabaseUserId(page: Page): Promise<string> {
  const { storageKey } = publicConfiguration();
  return page.evaluate(key => {
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('Current Supabase session is missing.');
    const session = JSON.parse(raw);
    const userId = session.user?.id ?? session.currentSession?.user?.id;
    if (!userId) throw new Error('Current Supabase session has no user.');
    return userId;
  }, storageKey);
}

export async function publicSupabaseRequest(
  page: Page,
  pathname: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<{ status: number; data: unknown }> {
  const configuration = publicConfiguration();
  return page.evaluate(async ({ configuration, pathname, init }) => {
    const raw = localStorage.getItem(configuration.storageKey);
    if (!raw) throw new Error('Current Supabase session is missing.');
    const session = JSON.parse(raw);
    const accessToken = session.access_token ?? session.currentSession?.access_token;
    if (!accessToken) throw new Error('Current Supabase session has no access token.');
    const response = await fetch(`${configuration.endpoint}${pathname}`, {
      method: init.method ?? 'GET',
      headers: {
        apikey: configuration.key,
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        ...(init.prefer ? { prefer: init.prefer } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  }, { configuration, pathname, init });
}

export const test = base.extend<{ secondaryPage: Page }>({
  secondaryPage: async ({ browser, baseURL }, use) => {
    const context = await browser.newContext({
      baseURL,
      storageState: path.join(here, '.auth', 'secondary.json'),
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect };
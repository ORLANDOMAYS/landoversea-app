import { test, expect } from './fixtures';

function persistedUserId(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const raw = Object.keys(localStorage)
      .filter(key => key.startsWith('sb-') && key.endsWith('-auth-token'))
      .map(key => localStorage.getItem(key))
      .find(Boolean);
    if (!raw) return null;
    const session = JSON.parse(raw);
    return session.user?.id ?? session.currentSession?.user?.id ?? null;
  });
}

test('protected routes redirect a fresh browser without auth polling', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  let sessionReads = 0;
  page.on('request', request => {
    if (request.url().includes('/auth/v1/user')) sessionReads += 1;
  });
  await page.goto('/discover');
  await expect(page).toHaveURL(/\/login$/);
  await page.waitForTimeout(2_000);
  expect(sessionReads).toBeLessThanOrEqual(1);
  await context.close();
});

test('PKCE storage state survives navigation and reload', async ({ page }) => {
  await page.goto('/profile');
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByText('Release Primary').first()).toBeVisible();
  const userId = await persistedUserId(page);
  expect(userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

  await page.reload();
  await expect(page).toHaveURL(/\/profile$/);
  expect(await persistedUserId(page)).toBe(userId);
});

test('reused sessions remain isolated by immutable UUID', async ({ page, secondaryPage }) => {
  await Promise.all([page.goto('/profile'), secondaryPage.goto('/profile')]);
  await expect(page.getByText('Release Primary').first()).toBeVisible();
  await expect(secondaryPage.getByText('Release Secondary').first()).toBeVisible();
  await expect(page.getByText('Release Secondary')).toHaveCount(0);
  await expect(secondaryPage.getByText('Release Primary')).toHaveCount(0);
  expect(await persistedUserId(page)).not.toBe(await persistedUserId(secondaryPage));
});

test('invalid callbacks fail closed and never honor an external destination', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await page.goto('/auth/callback?next=https://example.com');
  await expect(page.getByRole('heading', { name: 'Sign-in link failed' })).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/callback/);
  await context.close();
});
import { test, expect } from './fixtures';

test('notifications deep link survives a retry and refresh', async ({ page }) => {
  const endpoint = (url: URL) => url.pathname.endsWith('/api/notifications');
  await page.route(endpoint, route => route.fulfill({
    status: 503,
    json: { error: 'Notifications are temporarily unavailable.' },
  }));
  await page.goto('/notifications');
  await expect(page.getByRole('alert')).toContainText('Notifications unavailable');
  await page.unroute(endpoint);
  await page.route(endpoint, route => route.fulfill({ status: 200, json: [] }));
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'All caught up!' })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/notifications$/);
});

test('notification mutation failure remains visible and retryable', async ({ page }) => {
  await page.route(url => url.pathname.endsWith('/api/notifications'), route => route.fulfill({
    status: 200,
    json: [{
      id: 987654,
      type: 'message',
      title: 'New message',
      body: 'Open your conversation',
      relatedId: null,
      isRead: false,
      createdAt: new Date().toISOString(),
    }],
  }));
  await page.route(url => url.pathname.endsWith('/api/notifications/read-all'), route =>
    route.fulfill({ status: 503, json: { error: 'Update unavailable.' } }));
  await page.goto('/notifications');
  await page.getByRole('button', { name: 'Mark all' }).click();
  await expect(page.getByRole('alert')).toContainText('Update unavailable');
  await expect(page.getByRole('alert').getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('RSVP cancellation retries and remains cancelled after refresh', async ({ page }) => {
  let attending = false;
  let cancellationAttempts = 0;
  const event = {
    id: 7654321,
    title: 'Cancellation Test Festival',
    description: 'A cultural event.',
    country: 'Testland',
    date: new Date(Date.now() + 86_400_000).toISOString(),
    imageUrl: null,
  };
  await page.route(url => url.pathname.endsWith('/api/cultural/events'), route =>
    route.fulfill({ json: [{ ...event, isRsvped: attending, hasRsvp: attending }] }));
  await page.route(url => url.pathname.endsWith(`/api/cultural/events/${event.id}/rsvp`), async route => {
    if (route.request().method() === 'POST') {
      attending = true;
      return route.fulfill({ json: { ...event, isRsvped: true } });
    }
    cancellationAttempts += 1;
    if (cancellationAttempts === 1) {
      return route.fulfill({ status: 503, json: { error: 'Cancellation temporarily unavailable.' } });
    }
    attending = false;
    return route.fulfill({ json: { ...event, isRsvped: false } });
  });
  await page.goto('/events');
  await page.getByRole('button', { name: `RSVP to ${event.title}` }).click();
  await page.getByRole('button', { name: `Cancel RSVP for ${event.title}` }).click();
  await expect(page.getByRole('alert')).toContainText('Cancellation temporarily unavailable');
  await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('button', { name: `RSVP to ${event.title}` })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: `RSVP to ${event.title}` })).toBeVisible();
  expect(cancellationAttempts).toBe(2);
});

test('live discovery failure is readable and retryable', async ({ page }) => {
  const profiles = (url: URL) => (
    url.pathname.endsWith('/rest/v1/profiles')
    && url.searchParams.get('display_name') === 'not.is.null'
  );
  let failedDiscoveryRequests = 0;
  await page.route(profiles, route => route.fulfill({
    status: 503,
    json: { message: 'Discovery temporarily unavailable.' },
  }).then(() => {
    failedDiscoveryRequests += 1;
  }));
  await page.goto('/discover');
  await expect.poll(() => failedDiscoveryRequests).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: /Couldn't load profiles/i }))
    .toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Something went wrong while fetching profiles/i)).toBeVisible();
  const retry = page.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeEnabled();
  await page.unroute(profiles);
  await page.route(profiles, route => route.fulfill({ status: 200, json: [] }));
  await retry.click();
  await expect(page.getByRole('heading', { name: /You've seen everyone/i })).toBeVisible();
});

test('disabled discovery action keeps explicit contrast classes', async ({ page }) => {
  const candidateId = '11111111-1111-4111-8111-111111111111';
  await page.route(url => url.pathname.endsWith('/rest/v1/profiles'), route => route.fulfill({
    status: 200,
    json: [{
      id: candidateId,
      display_name: 'Test User',
      age: 25,
      gender: 'female',
      bio: 'A release candidate.',
      city: 'Tokyo',
      country: 'Japan',
    }],
  }));
  await page.route(url => url.pathname.endsWith('/rest/v1/photos'), route =>
    route.fulfill({ status: 200, json: [] }));
  await page.route(url => url.pathname.endsWith('/api/premium/superlikes'), route =>
    route.fulfill({ status: 200, json: { remaining: 0, nextRefillAt: new Date(Date.now() + 86_400_000) } }));
  await page.goto('/discover');
  const action = page.getByRole('button', { name: /Superlike Test User/i });
  await expect(action).toBeDisabled();
  const classes = await action.getAttribute('class') ?? '';
  expect(classes).toContain('disabled:bg-muted');
  expect(classes).toContain('disabled:text-muted-foreground');
  expect(classes).not.toMatch(/disabled:opacity-(40|50)/);
});

test('shared form primitives expose non-opacity disabled and placeholder styling', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto('/login');
  const email = page.getByRole('textbox', { name: /email/i });
  await expect(email).toBeVisible();
  expect(await email.getAttribute('class')).toContain('placeholder:text-muted-foreground');
  expect(await page.locator('button[type="submit"]').getAttribute('class')).toContain('disabled:bg-muted');
  await context.close();
});

test('shared navigation and bright overlays preserve light and dark contrast', async ({ page }) => {
  await page.goto('/profile');
  const nav = page.getByTestId('mobile-bottom-navigation');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => nav.evaluate(element => getComputedStyle(element).backgroundColor))
    .toBe('rgba(255, 255, 255, 0.85)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => nav.evaluate(element => getComputedStyle(element).backgroundColor))
    .toBe('rgba(8, 0, 20, 0.88)');
  await page.goto('/coaches/ai');
  const icon = page.locator('.bg-gradient-to-br').first().locator('svg');
  await expect(icon).toBeVisible();
  expect(await icon.evaluate(element => getComputedStyle(element).color)).toBe('rgb(255, 255, 255)');
});
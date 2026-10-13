import { test, expect } from './fixtures';

test('discovery and approved coaching surfaces load under normal-user auth', async ({ page }) => {
  await page.goto('/discover');
  await expect(page).toHaveURL(/\/discover$/);
  await expect(page.getByRole('button', { name: 'Why Us' })).toBeVisible();
  await page.getByRole('button', { name: 'Why Us' }).click();
  await expect(page.getByRole('dialog', { name: 'Discovery Filters' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Why Us' })).toBeFocused();

  await page.goto('/coaches');
  await expect(page.getByPlaceholder('Search coaches...')).toBeVisible();
  await expect(page.getByText(/Human coaches coming soon|View Profile/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AI Coach' })).toBeVisible();
});

test('UUID-backed messaging loads without exposing unsupported group writes', async ({ page }) => {
  await page.goto('/messages');
  await expect(page).toHaveURL(/\/messages$/);
  await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible();
  await expect(page.getByPlaceholder(/Search conversations/i)).toBeVisible();
  const newGroup = page.getByRole('button', { name: /New group/i });
  await expect(newGroup).toBeDisabled();
  await expect(page.getByRole('note')).toContainText(/safe group mapping/i);
});

test('Arabic locale can switch back to English without losing the session', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('los_locale', 'ar'));
  await page.goto('/discover');
  const switcher = page.getByRole('button', { name: /Change language|تغيير اللغة/i });
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await switcher.click();
  await page.getByTestId(/option-(?:floating-)?locale-en/).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('los_locale'))).toBe('en');
  await expect(page).toHaveURL(/\/discover$/);
});

test('public privacy, terms, and deletion-request controls remain accessible', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: /Privacy/i })).toBeVisible();
  await expect(page.getByText(/identity and age/i)).toBeVisible();
  await page.goto('/terms');
  await expect(page.getByText(/at least 18 years of age/i)).toBeVisible();
  await page.goto('/delete-account');
  await expect(page.getByRole('heading', { name: /Delete LandOverSEA Account/i })).toBeVisible();
  await expect(page.getByLabel(/Email Address/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Submit Deletion Request/i })).toBeVisible();
  await context.close();
});
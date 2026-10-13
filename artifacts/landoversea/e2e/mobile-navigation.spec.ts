import { test, expect } from './fixtures';

const TABS = [
  { id: 'discover', root: '/discover' },
  { id: 'matches', root: '/matches' },
  { id: 'messages', root: '/messages' },
  { id: 'coaches', root: '/coaches' },
  { id: 'profile', root: '/profile' },
] as const;

test.describe('mobile bottom navigation', () => {
  test('all roots route correctly and rapid taps settle on the final control', async ({ page }) => {
    await page.goto('/discover');
    for (const tab of TABS) {
      const control = page.getByTestId(`mobile-tab-${tab.id}`);
      await control.click();
      await expect(page).toHaveURL(new RegExp(`${tab.root}$`));
      await expect(control).toHaveAttribute('aria-current', 'page');
    }
    await page.getByTestId('mobile-tab-discover').click();
    await page.getByTestId('mobile-tab-coaches').click();
    await page.getByTestId('mobile-tab-profile').click();
    await expect(page).toHaveURL(/\/profile$/);
  });

  test('active deep child controls return to UUID-safe roots', async ({ page }) => {
    const deepRoutes = [
      { id: 'discover', deep: '/filters', root: '/discover' },
      { id: 'matches', deep: '/who-liked-me', root: '/matches' },
      { id: 'coaches', deep: '/coaches/ai', root: '/coaches' },
      { id: 'profile', deep: '/settings', root: '/profile' },
    ] as const;
    for (const route of deepRoutes) {
      await page.goto(route.deep);
      const control = page.getByTestId(`mobile-tab-${route.id}`);
      await expect(control).toHaveAttribute('aria-current', 'page');
      await control.click();
      await expect(page).toHaveURL(new RegExp(`${route.root}$`));
    }
  });

  test('re-tapping a root scrolls both containers without growing history', async ({ page }) => {
    for (const tab of TABS) {
      await page.goto(tab.root);
      const control = page.getByTestId(`mobile-tab-${tab.id}`);
      await expect(control).toBeVisible();
      await page.locator('#app-main-scroll').waitFor({ state: 'attached' });
      const before = await page.evaluate(() => {
        const main = document.getElementById('app-main-scroll')!;
        main.style.height = '400px';
        main.style.flex = 'none';
        const spacer = document.createElement('div');
        spacer.style.height = '2000px';
        main.appendChild(spacer);
        main.scrollTop = 500;
        window.scrollTo(0, 500);
        return history.length;
      });
      await control.click();
      await expect.poll(() => page.evaluate(() => ({
        main: document.getElementById('app-main-scroll')?.scrollTop ?? -1,
        window: scrollY,
      }))).toEqual({ main: 0, window: 0 });
      expect(await page.evaluate(() => history.length)).toBe(before);
    }
  });

  test('group creation remains visibly disabled until a safe mapping exists', async ({ page }) => {
    await page.goto('/messages');
    const button = page.getByRole('button', { name: /New group/i });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('title', /safe group mapping/i);
    await expect(page.getByRole('note')).toContainText(/safe group mapping/i);
  });
});
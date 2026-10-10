import { test, expect } from './fixtures';

test.describe('public account-deletion and legal surfaces', () => {
  test('deletion page explains both in-app and public request paths', async ({ page }) => {
    await page.goto('/delete-account');
    await expect(page.getByRole('heading', { name: /Delete LandOverSEA Account/i })).toBeVisible();
    await expect(page.getByText(/Immediate In-App Deletion/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /Go to Profile Settings/i })).toHaveAttribute('href', '/profile');
    await expect(page.getByLabel(/Email Address/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Submit Deletion Request/i })).toBeVisible();
    await expect(page.getByText(/cascades remove messages you authored/i)).toBeVisible();
    await expect(page.getByText(/coach credentials, bookings, and payment metadata/i)).toBeVisible();
  });

  test('public deletion request remains retryable after a network failure', async ({ page }) => {
    await page.route('**/api/auth/account-deletion-requests', route => route.abort('connectionfailed'));
    await page.goto('/delete-account');
    await page.getByLabel(/Email Address/i).fill('ordinary-user@example.com');
    const submit = page.getByRole('button', { name: /Submit Deletion Request/i });
    await submit.click();
    await expect(page.getByRole('alert')).toContainText(/could not submit/i);
    await expect(submit).toBeVisible();
    await expect(page.getByText(/Request Received/i)).toHaveCount(0);
  });

  test('privacy and terms retain identity, age, retention, and safety disclosures', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByText(/identity and age/i)).toBeVisible();
    await expect(page.getByText(/do not use automated face or liveness detection/i)).toBeVisible();
    await expect(page.getByText(/keyed email hash and status/i)).toBeVisible();
    await page.goto('/terms');
    await expect(page.getByText(/at least 18 years of age/i)).toBeVisible();
    await expect(page.getByText(/coach credentials, bookings, and payment metadata/i)).toBeVisible();
    await expect(page.getByText(/keyed email hash and status/i)).toBeVisible();
  });
});
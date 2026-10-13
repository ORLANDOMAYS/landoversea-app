import { test, expect } from './fixtures';
import type { Page, Route } from '@playwright/test';

const coach = {
  id: 41,
  userId: 7,
  displayName: 'Coach Casey',
  verificationStatus: 'rejected',
  isVerified: false,
  isPayoutReady: false,
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function coachRoutes(page: Page) {
  await page.route('**/api/coaches/me', route => json(route, coach));
  await page.route('**/api/coaches/me/credentials', route =>
    route.request().method() === 'GET' ? json(route, []) : route.fallback());
}

async function reachDocuments(page: Page) {
  await page.goto('/coaches/verify');
  await page.getByRole('button', { name: /Begin Verification/ }).click();
  await page.getByRole('button', { name: 'Passport' }).click();
}

test.describe('secure coach credential controls', () => {
  test('finalizes an owner-bound upload before enabling continue', async ({ page }) => {
    await coachRoutes(page);
    await page.route('**/api/storage/uploads/request-url', route => json(route, {
      uploadURL: 'https://storage.test/credential',
      objectPath: '/objects/current-owner/new-document',
      uploadToken: 'owner-bound-token',
    }));
    await page.route('https://storage.test/credential', route => route.fulfill({ status: 200 }));
    await page.route('**/api/coaches/me/credentials', route => json(route, {
      id: 91,
      coachId: 41,
      kind: 'id_document',
      originalName: 'passport.png',
      contentType: 'image/png',
      size: 4,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }, 201));
    await reachDocuments(page);
    const next = page.getByRole('button', { name: /Continue/ });
    await expect(next).toBeDisabled();
    await page.locator('input[type=file]').setInputFiles({
      name: 'passport.png',
      mimeType: 'image/png',
      buffer: Buffer.from('data'),
    });
    await expect(page.getByText('Upload complete and saved')).toBeVisible();
    await expect(next).toBeEnabled();
  });

  test('rejects invalid and oversized documents before requesting upload', async ({ page }) => {
    await coachRoutes(page);
    let uploadRequests = 0;
    await page.route('**/api/storage/uploads/request-url', route => {
      uploadRequests += 1;
      return json(route, {});
    });
    await reachDocuments(page);
    const input = page.locator('input[type=file]');
    await input.setInputFiles({ name: 'credential.txt', mimeType: 'text/plain', buffer: Buffer.from('no') });
    await expect(page.locator('li[data-state="open"]').filter({ hasText: 'Unsupported file type' })).toBeVisible();
    await input.setInputFiles({
      name: 'large.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
    });
    await expect(page.locator('li[data-state="open"]').filter({ hasText: 'File too large' })).toBeVisible();
    expect(uploadRequests).toBe(0);
  });

  test('retries both object upload and metadata finalization failures', async ({ page }) => {
    await coachRoutes(page);
    let uploads = 0;
    await page.route('**/api/storage/uploads/request-url', route => {
      uploads += 1;
      return json(route, {
        uploadURL: `https://storage.test/retry-${uploads}`,
        objectPath: `/objects/current-owner/retry-${uploads}`,
        uploadToken: `token-${uploads}`,
      });
    });
    await page.route('https://storage.test/retry-1', route => route.fulfill({ status: 503 }));
    await page.route(/https:\/\/storage\.test\/retry-[23]/, route => route.fulfill({ status: 200 }));
    let finalizations = 0;
    await page.route('**/api/coaches/me/credentials', route => {
      if (route.request().method() === 'GET') return route.fallback();
      finalizations += 1;
      return finalizations === 1
        ? json(route, { error: 'Finalization unavailable' }, 503)
        : json(route, { id: 92, status: 'pending' }, 201);
    });
    await reachDocuments(page);
    await page.locator('input[type=file]').setInputFiles({
      name: 'passport.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('data'),
    });
    await page.getByRole('button', { name: 'Retry upload' }).click();
    await expect(page.getByRole('alert')).toContainText(/Finalization unavailable/);
    await page.getByRole('button', { name: 'Retry upload' }).click();
    await expect(page.getByText('Upload complete and saved')).toBeVisible();
  });

  test('a normal user never requests privileged credential-review endpoints', async ({ page }) => {
    let requests = 0;
    const reviewPath = ['api', 'admin', 'coaches'].join('/');
    await page.route(`**/${reviewPath}/**/credentials**`, route => {
      requests += 1;
      return json(route, { error: 'Forbidden' }, 403);
    });
    await page.goto('/admin');
    await expect(page.getByText('Admin access only.')).toBeVisible();
    expect(requests).toBe(0);
  });
});
import { test, expect } from './fixtures';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('selfie verification rejects invalid files and retries private upload', async ({ page }) => {
  let attempts = 0;
  let status = 'none';
  await page.route('**/api/verification/status', route => route.fulfill({ json: { status } }));
  await page.route('**/api/verification/request', route => {
    attempts += 1;
    expect(route.request().headers()['content-type']).toContain('multipart/form-data');
    expect(route.request().postDataBuffer()?.toString('latin1')).toContain('name="selfie"');
    if (attempts === 1) {
      return route.fulfill({ status: 502, json: { error: 'Private object storage upload failed' } });
    }
    status = 'pending';
    return route.fulfill({ status: 201, json: { id: 1, status: 'pending' } });
  });
  await page.goto('/verification');
  const input = page.getByTestId('input-selfie');
  await input.setInputFiles({
    name: 'not-supported.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from('GIF89a'),
  });
  await expect(
    page.getByText('Invalid file type', { exact: true }),
  ).toBeVisible();
  await input.setInputFiles({ name: 'selfie.png', mimeType: 'image/png', buffer: TINY_PNG });
  await page.getByTestId('button-submit-selfie').click();
  await expect(
    page.getByText('Upload service unavailable', { exact: true }),
  ).toBeVisible();
  await page.getByTestId('button-submit-selfie').click();
  await expect(page.getByTestId('status-verification')).toContainText('Under Review');
  expect(attempts).toBe(2);
});

test('hosted checkout reports failure, retries, and hands off', async ({ page }) => {
  const bookingId = 912_345;
  await page.route('**/api/bookings', route => route.fulfill({
    json: [{
      id: bookingId,
      coachId: 55,
      clientId: 66,
      status: 'pending',
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      durationMinutes: 60,
      rateAtBooking: 100,
      currency: 'USD',
      coach: { id: 55, displayName: 'Checkout Coach', specialties: ['Dating'] },
    }],
  }));
  await page.route(`**/api/bookings/${bookingId}/payment`, route => route.fulfill({
    json: { configured: true, amount: 10_000, currency: 'USD', status: 'none' },
  }));
  let attempts = 0;
  await page.route(`**/api/bookings/${bookingId}/checkout`, route => {
    attempts += 1;
    expect(route.request().postDataJSON().returnPath).toMatch(/\/coaching$/);
    return attempts === 1
      ? route.fulfill({ status: 503, json: { error: 'Payment provider is not configured' } })
      : route.fulfill({
          status: 201,
          json: {
            paymentId: 77,
            checkoutUrl: 'https://checkout.test/session',
            amount: 10_000,
            currency: 'USD',
            status: 'requires_payment',
          },
        });
  });
  await page.route('https://checkout.test/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<h1>Hosted checkout</h1>',
  }));
  await page.goto('/coaching');
  const pay = page.getByTestId('button-pay-booking');
  await pay.click();
  await expect(page.getByText('Payments unavailable', { exact: true })).toBeVisible();
  await pay.click();
  await expect(page).toHaveURL('https://checkout.test/session');
  await expect(page.getByRole('heading', { name: 'Hosted checkout' })).toBeVisible();
  expect(attempts).toBe(2);
});

test('galaxy tokens follow operating-system light and dark appearance', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/login');
  const read = () => page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      background: style.getPropertyValue('--background').trim(),
      foreground: style.getPropertyValue('--foreground').trim(),
      scheme: style.colorScheme,
    };
  });
  const dark = await read();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(async () => (await read()).background).toBe('258 60% 97%');
  const light = await read();
  expect(dark).toEqual({ background: '260 100% 4%', foreground: '0 0% 100%', scheme: 'light dark' });
  expect(light).toEqual({ background: '258 60% 97%', foreground: '260 55% 12%', scheme: 'light dark' });
});
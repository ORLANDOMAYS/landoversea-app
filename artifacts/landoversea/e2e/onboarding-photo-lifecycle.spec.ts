import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { test, expect, currentSupabaseUserId } from './fixtures';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlR7WQAAAAASUVORK5CYII=',
  'base64',
);

async function currentAccessToken(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const raw = Object.keys(localStorage)
      .filter((key) => key.startsWith('sb-') && key.endsWith('-auth-token'))
      .map((key) => localStorage.getItem(key))
      .find(Boolean);
    if (!raw) throw new Error('Current Supabase session is missing.');
    const session = JSON.parse(raw);
    const token = session.access_token ?? session.currentSession?.access_token;
    if (!token) throw new Error('Current Supabase session has no access token.');
    return token;
  });
}

test('completed profile and private photo survive mobile and desktop lifecycle changes', async ({
  context,
  page,
}) => {
  const endpoint = process.env.VITE_SUPABASE_URL?.trim();
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!endpoint || !anonKey) throw new Error('Public Supabase E2E configuration is required.');

  await page.goto('/profile');
  const userId = await currentSupabaseUserId(page);
  const accessToken = await currentAccessToken(page);
  const supabase = createClient(endpoint, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { authorization: `Bearer ${accessToken}` } },
  });
  const objectPath = `${userId}/e2e-${randomUUID()}.png`;
  let photoId: string | null = null;

  try {
    const upload = await supabase.storage.from('photos').upload(objectPath, ONE_PIXEL_PNG, {
      contentType: 'image/png',
      upsert: false,
    });
    if (upload.error) throw upload.error;

    const inserted = await supabase
      .from('photos')
      .insert({ user_id: userId, url: objectPath, position: 0 })
      .select('id')
      .single();
    if (inserted.error) throw inserted.error;
    photoId = inserted.data.id;

    const assertProfileAndPhoto = async () => {
      await expect(page).toHaveURL(/\/profile$/);
      await expect(page).not.toHaveURL(/\/onboarding$/);
      await expect(page.getByText('Release Primary').first()).toBeVisible();
      const photo = page.locator('img[src*="/storage/v1/object/sign/photos/"]').first();
      await expect(photo).toBeVisible();
      await expect.poll(() => photo.evaluate((image: HTMLImageElement) => ({
        complete: image.complete,
        naturalWidth: image.naturalWidth,
      }))).toEqual({ complete: true, naturalWidth: 1 });
    };

    await page.setViewportSize({ width: 420, height: 900 });
    await page.reload();
    await assertProfileAndPhoto();

    await page.getByTestId('mobile-tab-discover').click();
    await expect(page).toHaveURL(/\/discover$/);
    await expect(page).not.toHaveURL(/\/onboarding$/);
    await page.getByTestId('mobile-tab-profile').click();
    await assertProfileAndPhoto();

    const backgroundPage = await context.newPage();
    await backgroundPage.goto('/terms');
    await backgroundPage.bringToFront();
    await page.waitForTimeout(300);
    await page.bringToFront();
    await assertProfileAndPhoto();
    await backgroundPage.close();

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await assertProfileAndPhoto();
    await page.goto('/discover');
    await expect(page).toHaveURL(/\/discover$/);
    await expect(page).not.toHaveURL(/\/onboarding$/);
    await page.goto('/profile');
    await assertProfileAndPhoto();
  } finally {
    if (photoId) {
      await supabase.from('photos').delete().eq('id', photoId);
    }
    await supabase.storage.from('photos').remove([objectPath]);
  }
});
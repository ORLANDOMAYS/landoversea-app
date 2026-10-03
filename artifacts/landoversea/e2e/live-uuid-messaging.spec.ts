import {
  currentSupabaseUserId,
  expect,
  publicSupabaseRequest,
  test,
} from './fixtures';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('two reusable users match and exchange a realtime UUID message', async ({ page, secondaryPage }) => {
  await Promise.all([page.goto('/profile'), secondaryPage.goto('/profile')]);
  const [primaryId, secondaryId] = await Promise.all([
    currentSupabaseUserId(page),
    currentSupabaseUserId(secondaryPage),
  ]);
  expect(primaryId).toMatch(UUID);
  expect(secondaryId).toMatch(UUID);

  for (const [actor, actorId, targetId] of [
    [page, primaryId, secondaryId],
    [secondaryPage, secondaryId, primaryId],
  ] as const) {
    const swipe = await publicSupabaseRequest(
      actor,
      '/rest/v1/swipes?on_conflict=swiper_id,swiped_id',
      {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: { swiper_id: actorId, swiped_id: targetId, direction: 'like' },
      },
    );
    expect(swipe.status).toBeLessThan(300);
  }

  const ensured = await publicSupabaseRequest(page, '/rest/v1/rpc/ensure_match', {
    method: 'POST',
    body: { other_user: secondaryId },
  });
  expect(ensured.status).toBe(200);
  expect(ensured.data).toMatch(UUID);
  const matchId = ensured.data as string;

  await Promise.all([
    page.goto(`/messages/${matchId}`),
    secondaryPage.goto(`/messages/${matchId}`),
  ]);
  await expect(page.getByText('Release Secondary').first()).toBeVisible();
  await expect(secondaryPage.getByText('Release Primary').first()).toBeVisible();

  const message = `release-realtime-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const input = page.locator('form input:not([type=file])').last();
  await input.fill(message);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(secondaryPage.getByText(message, { exact: true })).toBeVisible({ timeout: 20_000 });
  await secondaryPage.reload();
  await expect(secondaryPage.getByText(message, { exact: true })).toBeVisible();
});
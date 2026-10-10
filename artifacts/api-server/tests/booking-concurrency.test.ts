/**
 * API integration test: concurrent booking protection.
 *
 * Sends two simultaneous booking requests for the same coach slot and asserts
 * exactly one succeeds (201) and the other is rejected with a conflict (409).
 *
 * Requires the API server to be running (dev proxy at http://localhost:80/api
 * by default; override with API_BASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { db, coachesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const BASE = process.env.API_BASE_URL || "http://localhost:80/api";

async function waitForReady(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/readyz`);
      if (response.ok) return;
      lastError = new Error(`readiness returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`API did not become ready within ${timeoutMs}ms`, { cause: lastError });
}

function cookieFrom(resp: Response): string {
  const setCookie = resp.headers.get("set-cookie");
  assert.ok(setCookie, "expected Set-Cookie header");
  return setCookie.split(";")[0];
}

async function register(tag: string): Promise<string> {
  const resp = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `conc-${Date.now()}-${Math.floor(Math.random() * 1e6)}-${tag}@example.com`,
      password: "test-password-1",
      name: `Concurrency ${tag}`,
      acceptedAgeRequirement: true,
    }),
  });
  const body = await resp.text();
  assert.equal(resp.status, 201, body);
  return cookieFrom(resp);
}

test("two simultaneous bookings for one slot -> exactly one 201 and one 409", async () => {
  await waitForReady();
  // 1. Coach with availability every day, 00:00-23:59 UTC
  const coachCookie = await register("coach");
  const coachResp = await fetch(`${BASE}/coaches/me`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: coachCookie },
    body: JSON.stringify({
      displayName: "Concurrency Coach",
      bio: "Coach used by the concurrent booking regression test",
      specialties: ["Cultural Adaptation"],
      languages: ["English"],
      sessionLengthsMinutes: [60],
      ratesPerHour: 50,
      availability: {
        timeZone: "UTC",
        slots: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          startTime: "00:00",
          endTime: "23:59",
        })),
      },
    }),
  });
  const coachBody = await coachResp.text();
  assert.equal(coachResp.status, 201, coachBody);
  const coach = JSON.parse(coachBody);
  // Public booking correctly requires an approved coach. This test is about
  // slot concurrency, so establish that prerequisite directly as test setup.
  await db
    .update(coachesTable)
    .set({ isVerified: true, verificationStatus: "approved" })
    .where(eq(coachesTable.id, coach.id));

  // 2. Two independent clients
  const [cookieA, cookieB] = await Promise.all([register("client-a"), register("client-b")]);

  // 3. One slot tomorrow at 10:00 UTC, requested simultaneously
  const scheduledAt = new Date();
  scheduledAt.setUTCDate(scheduledAt.getUTCDate() + 1);
  scheduledAt.setUTCHours(10, 0, 0, 0);

  const book = (cookie: string) =>
    fetch(`${BASE}/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        coachId: coach.id,
        scheduledAt: scheduledAt.toISOString(),
        durationMinutes: 60,
      }),
    });

  const [respA, respB] = await Promise.all([book(cookieA), book(cookieB)]);
  const statuses = [respA.status, respB.status].sort();

  assert.deepEqual(
    statuses,
    [201, 409],
    `expected exactly one 201 and one 409, got ${respA.status} and ${respB.status}`
  );
});

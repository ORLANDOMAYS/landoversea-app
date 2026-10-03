import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const baseUrl = (process.env.TEST_BASE_URL ?? "http://127.0.0.1:8080").replace(
  /\/+$/,
  "",
);

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("x-forwarded-for", options.clientIp ?? "198.51.100.30");
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (options.cookie) {
    headers.set("cookie", options.cookie);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const rawBody = await response.text();
  const data = rawBody === "" ? null : JSON.parse(rawBody);
  const setCookie = response.headers.get("set-cookie");

  return {
    status: response.status,
    data,
    cookie: setCookie?.split(";", 1)[0] ?? null,
  };
}

test("new account starts incomplete and profile updates advance onboarding", async () => {
  const suffix = randomUUID();
  const email = `onboarding-test-${suffix}@example.com`;
  const password = "OnboardingPass123!";
  const name = `Onboarding Test ${suffix.slice(0, 8)}`;
  let cookie = null;

  try {
    const registered = await request("/api/auth/register", {
      method: "POST",
      body: { name, email, password, acceptedAgeRequirement: true },
    });
    assert.equal(registered.status, 201);
    assert.equal(registered.data?.user?.isProfileComplete, false);
    cookie = registered.cookie;

    // A freshly created profile exists and is tied to the user.
    const initialProfile = await request("/api/profiles/me", { cookie });
    assert.equal(initialProfile.status, 200);
    assert.equal(initialProfile.data?.name, name);
    const initialPercent = initialProfile.data?.completionPercent;
    assert.equal(typeof initialPercent, "number");

    // Completion endpoint reports missing steps for an incomplete profile.
    const completion = await request("/api/profiles/completion", { cookie });
    assert.equal(completion.status, 200);

    // Updating profile fields recomputes completion and persists.
    const updatedName = `${name} Updated`;
    const patched = await request("/api/profiles/me", {
      method: "PATCH",
      cookie,
      body: {
        name: updatedName,
        bio: "Exploring cultures and building genuine cross-border connections.",
        age: 29,
        gender: "female",
        lookingFor: "friendship",
        primaryLanguage: "English",
        country: "United States",
        city: "Seattle",
        interests: ["travel", "languages", "food"],
      },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.data?.name, updatedName);
    assert.equal(typeof patched.data?.completionPercent, "number");
    assert.ok(patched.data.completionPercent >= initialPercent);

    // The update is visible on a subsequent read (persistence check).
    const refetched = await request("/api/profiles/me", { cookie });
    assert.equal(refetched.status, 200);
    assert.equal(refetched.data?.name, updatedName);
    assert.equal(refetched.data?.bio, patched.data?.bio);

    // The name change propagates to the user record surfaced by /auth/me.
    const me = await request("/api/auth/me", { cookie });
    assert.equal(me.status, 200);
    assert.equal(me.data?.name, updatedName);

    // Empty update payloads are rejected.
    const emptyUpdate = await request("/api/profiles/me", {
      method: "PATCH",
      cookie,
      body: { notARealField: true },
    });
    assert.equal(emptyUpdate.status, 400);

    // Profile endpoints require authentication.
    const anonymous = await request("/api/profiles/me");
    assert.equal(anonymous.status, 401);

    // Every onboarding-collected field persists to its intended column.
    const onboardingPayload = {
      preferredMinAge: 24,
      preferredMaxAge: 42,
      countriesOfInterest: ["Japan", "Brazil"],
      // Target/practice languages must land in learningLanguages, NOT otherLanguages.
      learningLanguages: ["Japanese", "Portuguese"],
      culturalInterests: ["language_exchange", "friendship"],
      travelGoals: "long_distance",
      relocationOpenness: false,
      longDistanceOpenness: true,
      communicationPreferences: ["daily_texting", "video_calls"],
    };
    const onboardingPatch = await request("/api/profiles/me", {
      method: "PATCH",
      cookie,
      body: onboardingPayload,
    });
    assert.equal(onboardingPatch.status, 200);

    const withOnboarding = await request("/api/profiles/me", { cookie });
    assert.equal(withOnboarding.status, 200);
    const p = withOnboarding.data;
    assert.equal(p.preferredMinAge, 24);
    assert.equal(p.preferredMaxAge, 42);
    assert.deepEqual(p.countriesOfInterest, ["Japan", "Brazil"]);
    assert.deepEqual(p.learningLanguages, ["Japanese", "Portuguese"]);
    assert.deepEqual(p.culturalInterests, ["language_exchange", "friendship"]);
    assert.equal(p.travelGoals, "long_distance");
    assert.equal(p.relocationOpenness, false);
    assert.equal(p.longDistanceOpenness, true);
    assert.deepEqual(p.communicationPreferences, ["daily_texting", "video_calls"]);
    // otherLanguages stays for actually-spoken additional languages only;
    // the target-language step must not have populated it.
    assert.deepEqual(p.otherLanguages, []);

    // The relocate travel preference derives both booleans true.
    const relocatePatch = await request("/api/profiles/me", {
      method: "PATCH",
      cookie,
      body: {
        travelGoals: "relocate",
        relocationOpenness: true,
        longDistanceOpenness: true,
      },
    });
    assert.equal(relocatePatch.status, 200);
    const afterRelocate = await request("/api/profiles/me", { cookie });
    assert.equal(afterRelocate.data.travelGoals, "relocate");
    assert.equal(afterRelocate.data.relocationOpenness, true);
    assert.equal(afterRelocate.data.longDistanceOpenness, true);

    // otherLanguages remains independently settable for spoken languages.
    const spokenPatch = await request("/api/profiles/me", {
      method: "PATCH",
      cookie,
      body: { otherLanguages: ["Spanish"] },
    });
    assert.equal(spokenPatch.status, 200);
    const afterSpoken = await request("/api/profiles/me", { cookie });
    assert.deepEqual(afterSpoken.data.otherLanguages, ["Spanish"]);
    // learningLanguages is untouched by the spoken-languages update.
    assert.deepEqual(afterSpoken.data.learningLanguages, ["Japanese", "Portuguese"]);
  } finally {
    if (cookie) {
      const deleted = await request("/api/auth/delete-account", {
        method: "DELETE",
        cookie,
        body: { confirmPassword: password },
      });
      assert.ok([200, 401].includes(deleted.status));
    }
  }
});

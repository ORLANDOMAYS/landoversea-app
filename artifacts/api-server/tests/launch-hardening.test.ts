import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SESSION_SECRET ??= "launch-hardening-test-secret-at-least-32-bytes";

const authModule = await import("../src/routes/auth");
const coachingModule = await import("../src/routes/coaching");
const appModule = await import("../src/app");

test("verification codes are securely generated six-digit OTPs", () => {
  const codes = Array.from({ length: 200 }, () => authModule.generateVerificationCode());
  assert.ok(codes.every((code) => /^\d{6}$/.test(code)));
  assert.ok(new Set(codes).size > 190, "codes should not be deterministic");
});

test("recovery codes can never be exposed in production", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousTestMode = process.env.AUTH_RECOVERY_TEST_MODE;
  process.env.NODE_ENV = "production";
  process.env.AUTH_RECOVERY_TEST_MODE = "1";
  assert.equal(authModule.isRecoveryTestMode(), false);
  process.env.NODE_ENV = previousNodeEnv;
  process.env.AUTH_RECOVERY_TEST_MODE = previousTestMode;
});

test("verify-email has a bounded dedicated IP rate-limit configuration", () => {
  assert.equal(appModule.VERIFY_EMAIL_RATE_LIMIT.windowMs, 15 * 60 * 1000);
  assert.equal(appModule.VERIFY_EMAIL_RATE_LIMIT.max, 10);
});

test("verify-email returns the standard 429 response in production", async (t) => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousTestMode = process.env.AUTH_RECOVERY_TEST_MODE;
  process.env.NODE_ENV = "production";
  process.env.AUTH_RECOVERY_TEST_MODE = "1";

  const server = appModule.default.listen(0, "127.0.0.1");
  t.after(() => {
    server.close();
    process.env.NODE_ENV = previousNodeEnv;
    if (previousTestMode === undefined) delete process.env.AUTH_RECOVERY_TEST_MODE;
    else process.env.AUTH_RECOVERY_TEST_MODE = previousTestMode;
  });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  let response: Response | undefined;
  for (let attempt = 0; attempt < 11; attempt += 1) {
    response = await fetch(`http://127.0.0.1:${address.port}/api/auth/verify-email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "198.51.100.44",
      },
      body: JSON.stringify({ code: "not-a-code" }),
    });
  }

  assert.equal(response?.status, 429);
  assert.deepEqual(await response?.json(), {
    error: "Too many attempts, please try again later",
  });
});

test("social providers remain unavailable even with both credential halves", () => {
  const previousId = process.env.GOOGLE_CLIENT_ID;
  const previousSecret = process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  assert.equal(authModule.socialProviderAvailable("google"), false);
  process.env.GOOGLE_CLIENT_ID = "client-id";
  assert.equal(authModule.socialProviderAvailable("google"), false);
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  assert.equal(authModule.socialProviderAvailable("google"), false);
  assert.equal(authModule.socialProviderUnavailableReason("google"), "callback_unavailable");
  if (previousId === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = previousId;
  if (previousSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
  else process.env.GOOGLE_CLIENT_SECRET = previousSecret;
});

test("deletion request hashing is normalized, keyed, and not plaintext", () => {
  const hash = authModule.hashDeletionRequestEmail(" Person@Example.com ", "pepper");
  assert.equal(hash, authModule.hashDeletionRequestEmail("person@example.com", "pepper"));
  assert.notEqual(hash, authModule.hashDeletionRequestEmail("person@example.com", "other"));
  assert.doesNotMatch(hash, /person|example/i);
  assert.match(hash, /^[a-f0-9]{64}$/);
});

test("coach credential magic bytes match only allowed declared types", () => {
  assert.equal(coachingModule.credentialMagicMatches("application/pdf", Buffer.from("%PDF-1.7")), true);
  assert.equal(coachingModule.credentialMagicMatches("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0])), true);
  assert.equal(
    coachingModule.credentialMagicMatches("image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    true,
  );
  assert.equal(coachingModule.credentialMagicMatches("image/png", Buffer.from("%PDF-1.7")), false);
  assert.equal(coachingModule.credentialMagicMatches("image/gif", Buffer.from("GIF89a")), false);
});
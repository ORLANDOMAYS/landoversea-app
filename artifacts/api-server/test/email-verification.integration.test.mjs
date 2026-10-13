import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import { db, emailVerificationTokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const baseUrl = (process.env.TEST_BASE_URL ?? "http://127.0.0.1:8080").replace(
  /\/+$/,
  "",
);

// Verification tokens are only returned in explicit test mode. Without it we
// cannot obtain a token to exercise verify, so those assertions are skipped.
const testMode =
  process.env.AUTH_RECOVERY_TEST_MODE === "1" ||
  process.env.NODE_ENV === "test";

function hashVerificationCode(code) {
  const secret = process.env.SESSION_SECRET;
  assert.ok(secret, "SESSION_SECRET must be available to the integration test");
  return createHmac("sha256", secret).update(code).digest("hex");
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("x-forwarded-for", options.clientIp ?? "198.51.100.40");
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

test("native mobile sessions return a bearer token accepted by authenticated routes", async () => {
  const suffix = randomUUID();
  const email = `mobile-session-${suffix}@example.com`;
  const password = "MobileSession123!";
  let cookie = null;

  try {
    const registered = await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "Mobile Session",
        email,
        password,
        acceptedAgeRequirement: true,
      },
    });
    assert.equal(registered.status, 201);
    cookie = registered.cookie;

    const session = await request("/api/auth/mobile/session", {
      method: "POST",
      body: { email, password },
    });
    assert.equal(session.status, 200);
    assert.equal(session.data?.user?.email, email);
    assert.match(session.data?.token, /^[^.]+\.[^.]+\.[^.]+$/);

    const me = await request("/api/auth/me", {
      headers: { authorization: `Bearer ${session.data.token}` },
    });
    assert.equal(me.status, 200);
    assert.equal(me.data?.email, email);
  } finally {
    if (cookie) {
      await request("/api/auth/delete-account", {
        method: "DELETE",
        cookie,
        body: { confirmPassword: password },
      });
    }
  }
});

test("email verification is one-time, non-enumerating, and idempotent for already-verified", async () => {
  const suffix = randomUUID();
  const email = `verify-test-${suffix}@example.com`;
  const password = "VerifyPass123!";
  const name = `Verify Test ${suffix.slice(0, 8)}`;
  let cookie = null;

  try {
    const registered = await request("/api/auth/register", {
      method: "POST",
      body: { name, email, password, acceptedAgeRequirement: true },
    });
    assert.equal(registered.status, 201);
    cookie = registered.cookie;
    assert.equal(registered.data?.verificationDelivery, "development");
    assert.equal(registered.data?.verificationEmailSent, false);
    assert.equal(registered.data?.retryAfter, 60);

    // New accounts start unverified.
    assert.equal(registered.data?.user?.isEmailVerified, false);

    const duplicate = await request("/api/auth/register", {
      method: "POST",
      body: { name, email, password, acceptedAgeRequirement: true },
    });
    assert.equal(duplicate.status, 409);

    // Bad token is rejected generically.
    const bad = await request("/api/auth/verify-email", {
      method: "POST",
      body: { token: "deadbeef".repeat(8) },
    });
    assert.equal(bad.status, 400);

    // Empty token => 400 validation.
    const empty = await request("/api/auth/verify-email", {
      method: "POST",
      body: { token: "" },
    });
    assert.equal(empty.status, 400);

    if (!testMode) {
      // Cannot obtain a real token outside test mode; stop after negative paths.
      return;
    }

    // Registration exposes a verification token in test mode.
    const token = registered.data?.verificationToken;
    assert.equal(typeof token, "string");
    assert.match(token, /^\d{6}$/);

    // Verify successfully.
    const verified = await request("/api/auth/verify-email", {
      method: "POST",
      body: { token },
    });
    assert.equal(verified.status, 200);
    assert.equal(verified.data?.verified, true);
    assert.equal(verified.data?.sessionEstablished, true);
    assert.ok(verified.cookie, "verification must establish a fresh web session");

    // The user is now marked verified.
    const me = await request("/api/auth/me", { cookie: verified.cookie });
    assert.equal(me.status, 200);
    assert.equal(me.data?.isEmailVerified, true);

    // Token is one-time: a second redemption returns already-verified (owner
    // is verified) rather than re-verifying.
    const reuse = await request("/api/auth/verify-email", {
      method: "POST",
      body: { token },
    });
    assert.equal(reuse.status, 200);
    assert.equal(reuse.data?.alreadyVerified, true);

    // Resend for an already-verified account short-circuits with a clear signal.
    const resendVerified = await request("/api/auth/resend-verification", {
      method: "POST",
      cookie,
    });
    assert.equal(resendVerified.status, 200);
    assert.equal(resendVerified.data?.alreadyVerified, true);
  } finally {
    if (cookie) {
      await request("/api/auth/delete-account", {
        method: "DELETE",
        cookie,
        body: { confirmPassword: password },
      });
    }
  }
});

test("authenticated failed guesses lock the newest code and resend recovers", async () => {
  if (!testMode) return;

  const suffix = randomUUID();
  const email = `verify-lock-${suffix}@example.com`;
  const password = "VerifyLock123!";
  let cookie = null;

  try {
    const registered = await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "Verify Lock",
        email,
        password,
        acceptedAgeRequirement: true,
      },
      clientIp: "198.51.100.42",
    });
    assert.equal(registered.status, 201);
    cookie = registered.cookie;
    const originalCode = registered.data?.verificationCode;
    assert.match(originalCode, /^\d{6}$/);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await request("/api/auth/verify-email", {
        method: "POST",
        cookie,
        body: { code: String((Number(originalCode) + attempt + 1) % 1_000_000).padStart(6, "0") },
        clientIp: "198.51.100.42",
      });
      assert.equal(wrong.status, attempt === 4 ? 423 : 400);
    }

    const locked = await request("/api/auth/verify-email", {
      method: "POST",
      cookie,
      body: { code: originalCode },
      clientIp: "198.51.100.42",
    });
    assert.equal(locked.status, 423);

    // Locked tokens bypass the ordinary resend cooldown. The replacement is a
    // fresh newest token with a fresh failed-attempt budget.
    const resent = await request("/api/auth/resend-verification", {
      method: "POST",
      cookie,
      clientIp: "198.51.100.42",
    });
    assert.equal(resent.status, 200, JSON.stringify(resent.data));
    assert.match(resent.data?.token, /^\d{6}$/);
    assert.equal(resent.data?.verificationDelivery, "development");
    assert.equal(resent.data?.retryAfter, 60);

    const recovered = await request("/api/auth/verify-email", {
      method: "POST",
      cookie,
      body: { code: resent.data.token },
      clientIp: "198.51.100.42",
    });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.data?.verified, true);
  } finally {
    if (cookie) {
      await request("/api/auth/delete-account", {
        method: "DELETE",
        cookie,
        body: { confirmPassword: password },
      });
    }
  }
});

test("expired verification codes return an explicit expiry response", async () => {
  if (!testMode) return;

  const suffix = randomUUID();
  const password = "VerifyExpired123!";
  let cookie = null;
  try {
    const registered = await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "Verify Expired",
        email: `verify-expired-${suffix}@example.com`,
        password,
        acceptedAgeRequirement: true,
      },
      clientIp: "198.51.100.44",
    });
    assert.equal(registered.status, 201);
    cookie = registered.cookie;
    const code = registered.data?.verificationCode;
    assert.match(code, /^\d{6}$/);

    await db
      .update(emailVerificationTokensTable)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(emailVerificationTokensTable.tokenHash, hashVerificationCode(code)));

    const expired = await request("/api/auth/verify-email", {
      method: "POST",
      cookie,
      body: { code },
      clientIp: "198.51.100.44",
    });
    assert.equal(expired.status, 410);
    assert.equal(expired.data?.code, "verification_code_expired");
  } finally {
    if (cookie) {
      await request("/api/auth/delete-account", {
        method: "DELETE",
        cookie,
        body: { confirmPassword: password },
      });
    }
  }
});

test("a successful resend activates a fresh code and invalidates the old code", async () => {
  if (!testMode) return;

  const suffix = randomUUID();
  const password = "VerifyFresh123!";
  let cookie = null;
  try {
    const registered = await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "Verify Fresh",
        email: `verify-fresh-${suffix}@example.com`,
        password,
        acceptedAgeRequirement: true,
      },
      clientIp: "198.51.100.45",
    });
    assert.equal(registered.status, 201);
    cookie = registered.cookie;
    const originalCode = registered.data?.verificationCode;
    assert.match(originalCode, /^\d{6}$/);

    await db
      .update(emailVerificationTokensTable)
      .set({ deliveryAcceptedAt: new Date(Date.now() - 61_000) })
      .where(
        eq(
          emailVerificationTokensTable.tokenHash,
          hashVerificationCode(originalCode),
        ),
      );

    const resent = await request("/api/auth/resend-verification", {
      method: "POST",
      cookie,
      clientIp: "198.51.100.45",
    });
    assert.equal(resent.status, 200, JSON.stringify(resent.data));
    const freshCode = resent.data?.code;
    assert.match(freshCode, /^\d{6}$/);
    assert.notEqual(freshCode, originalCode);

    const oldCode = await request("/api/auth/verify-email", {
      method: "POST",
      cookie,
      body: { code: originalCode },
      clientIp: "198.51.100.45",
    });
    assert.equal(oldCode.status, 400);
    assert.equal(oldCode.data?.code, "verification_code_invalid");

    const fresh = await request("/api/auth/verify-email", {
      method: "POST",
      cookie,
      body: { code: freshCode },
      clientIp: "198.51.100.45",
    });
    assert.equal(fresh.status, 200);
    assert.equal(fresh.data?.verified, true);
  } finally {
    if (cookie) {
      await request("/api/auth/delete-account", {
        method: "DELETE",
        cookie,
        body: { confirmPassword: password },
      });
    }
  }
});

test("parallel resends serialize acceptance so exactly one fresh code is issued", async () => {
  if (!testMode) return;

  const suffix = randomUUID();
  const password = "VerifyParallel123!";
  let cookie = null;
  try {
    const registered = await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "Verify Parallel",
        email: `verify-parallel-${suffix}@example.com`,
        password,
        acceptedAgeRequirement: true,
      },
      clientIp: "198.51.100.46",
    });
    assert.equal(registered.status, 201);
    cookie = registered.cookie;
    const originalCode = registered.data?.verificationCode;

    await db
      .update(emailVerificationTokensTable)
      .set({ deliveryAcceptedAt: new Date(Date.now() - 61_000) })
      .where(
        eq(
          emailVerificationTokensTable.tokenHash,
          hashVerificationCode(originalCode),
        ),
      );

    const responses = await Promise.all([
      request("/api/auth/resend-verification", {
        method: "POST",
        cookie,
        clientIp: "198.51.100.46",
      }),
      request("/api/auth/resend-verification", {
        method: "POST",
        cookie,
        clientIp: "198.51.100.47",
      }),
    ]);
    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [200, 429],
    );

    const accepted = responses.find((response) => response.status === 200);
    assert.match(accepted?.data?.code, /^\d{6}$/);
    const verified = await request("/api/auth/verify-email", {
      method: "POST",
      cookie,
      body: { code: accepted.data.code },
      clientIp: "198.51.100.46",
    });
    assert.equal(verified.status, 200);
    assert.equal(verified.data?.verified, true);
  } finally {
    if (cookie) {
      await request("/api/auth/delete-account", {
        method: "DELETE",
        cookie,
        body: { confirmPassword: password },
      });
    }
  }
});

test("a valid OTP still succeeds after fewer than five authenticated failures", async () => {
  if (!testMode) return;

  const suffix = randomUUID();
  const password = "VerifyFew123!";
  let cookie = null;
  try {
    const registered = await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "Verify Few",
        email: `verify-few-${suffix}@example.com`,
        password,
        acceptedAgeRequirement: true,
      },
      clientIp: "198.51.100.43",
    });
    assert.equal(registered.status, 201);
    cookie = registered.cookie;
    const code = registered.data?.verificationCode;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const wrong = await request("/api/auth/verify-email", {
        method: "POST",
        cookie,
        body: { code: String((Number(code) + attempt + 1) % 1_000_000).padStart(6, "0") },
        clientIp: "198.51.100.43",
      });
      assert.equal(wrong.status, 400);
    }

    const verified = await request("/api/auth/verify-email", {
      method: "POST",
      cookie,
      body: { code },
      clientIp: "198.51.100.43",
    });
    assert.equal(verified.status, 200);
    assert.equal(verified.data?.verified, true);
  } finally {
    if (cookie) {
      await request("/api/auth/delete-account", {
        method: "DELETE",
        cookie,
        body: { confirmPassword: password },
      });
    }
  }
});

test("resend verification enforces a cooldown and generic response for unverified accounts", async () => {
  if (!testMode) return; // needs test-mode token exposure to be deterministic

  const suffix = randomUUID();
  const email = `resend-test-${suffix}@example.com`;
  const password = "ResendPass123!";
  const name = `Resend Test ${suffix.slice(0, 8)}`;
  let cookie = null;

  try {
    const registered = await request("/api/auth/register", {
      method: "POST",
      body: { name, email, password, acceptedAgeRequirement: true },
    });
    assert.equal(registered.status, 201);
    cookie = registered.cookie;

    // A resend immediately after registration hits the cooldown window.
    const resend = await request("/api/auth/resend-verification", {
      method: "POST",
      cookie,
    });
    assert.equal(resend.status, 429);
    assert.equal(typeof resend.data?.retryAfter, "number");
    assert.ok(resend.data.retryAfter > 0 && resend.data.retryAfter <= 60);
  } finally {
    if (cookie) {
      await request("/api/auth/delete-account", {
        method: "DELETE",
        cookie,
        body: { confirmPassword: password },
      });
    }
  }
});

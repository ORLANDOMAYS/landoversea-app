import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const baseUrl = (process.env.TEST_BASE_URL ?? "http://127.0.0.1:8080").replace(
  /\/+$/,
  "",
);

// Recovery flows only return a token when the server is running in an explicit
// test mode. Without it we cannot obtain a token to exercise reset, so the
// token-dependent assertions are skipped rather than failing the suite.
const recoveryTestMode =
  process.env.AUTH_RECOVERY_TEST_MODE === "1" ||
  process.env.NODE_ENV === "test";

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("x-forwarded-for", options.clientIp ?? "198.51.100.20");
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

test("password recovery issues one-time, generic, non-leaking reset flow", async () => {
  const suffix = randomUUID();
  const email = `recovery-test-${suffix}@example.com`;
  const password = "RecoveryPass123!";
  const name = `Recovery Test ${suffix.slice(0, 8)}`;
  let cookie = null;
  let finalPassword = password;

  try {
    const registered = await request("/api/auth/register", {
      method: "POST",
      body: { name, email, password, acceptedAgeRequirement: true },
    });
    assert.equal(registered.status, 201);
    cookie = registered.cookie;

    // Generic response for a well-formed request regardless of account state.
    const unknown = await request("/api/auth/forgot-password", {
      method: "POST",
      body: { email: `nobody-${suffix}@example.com` },
    });
    // Either a generic 200 (delivery configured / test mode) or an explicit
    // 503 unavailable when no delivery channel exists. Never a token leak.
    assert.ok([200, 503].includes(unknown.status));
    if (unknown.status === 200) {
      assert.equal(typeof unknown.data?.message, "string");
      if (!recoveryTestMode) {
        assert.equal(unknown.data?.token, undefined);
      } else {
        // Unknown accounts must never receive a token even in test mode.
        assert.equal(unknown.data?.token, undefined);
      }
    } else {
      assert.equal(unknown.data?.deliveryAvailable, false);
    }

    // Invalid email shape still returns a generic 200 (no enumeration).
    const malformed = await request("/api/auth/forgot-password", {
      method: "POST",
      body: { email: "not-an-email" },
    });
    assert.equal(malformed.status, 200);
    assert.equal(typeof malformed.data?.message, "string");
    assert.equal(malformed.data?.token, undefined);

    const forgot = await request("/api/auth/forgot-password", {
      method: "POST",
      body: { email: email.toUpperCase() },
    });

    if (!recoveryTestMode || forgot.status === 503) {
      // No delivery channel and not in test mode: cannot obtain a token.
      // Assert reset rejects an arbitrary token and stop here.
      const rejected = await request("/api/auth/reset-password", {
        method: "POST",
        body: { token: "deadbeef".repeat(8), newPassword: "BrandNewPass1!" },
      });
      assert.equal(rejected.status, 400);
      return;
    }

    assert.equal(forgot.status, 200);
    const token = forgot.data?.token;
    assert.equal(typeof token, "string");
    assert.ok(token.length >= 32);

    // Reset validation: short passwords rejected.
    const shortReset = await request("/api/auth/reset-password", {
      method: "POST",
      body: { token, newPassword: "short" },
    });
    assert.equal(shortReset.status, 400);

    // Redeem the token successfully.
    const newPassword = "BrandNewRecovery1!";
    const reset = await request("/api/auth/reset-password", {
      method: "POST",
      body: { token, newPassword },
    });
    assert.equal(reset.status, 200);
    finalPassword = newPassword;

    // Token is one-time: a second redemption must fail.
    const reuse = await request("/api/auth/reset-password", {
      method: "POST",
      body: { token, newPassword: "AnotherPass1!" },
    });
    assert.equal(reuse.status, 400);

    // Old password no longer works; new password does.
    const oldLogin = await request("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    assert.equal(oldLogin.status, 401);

    const newLogin = await request("/api/auth/login", {
      method: "POST",
      body: { email, password: newPassword },
    });
    assert.equal(newLogin.status, 200);
    cookie = newLogin.cookie;
  } finally {
    if (cookie) {
      const deleted = await request("/api/auth/delete-account", {
        method: "DELETE",
        cookie,
        body: { confirmPassword: finalPassword },
      });
      assert.ok([200, 401].includes(deleted.status));
    }
  }
});

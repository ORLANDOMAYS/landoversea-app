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

test("account deletion requires correct password and only then removes the account", async () => {
  const suffix = randomUUID();
  const email = `delete-test-${suffix}@example.com`;
  const password = "DeleteMe123!";
  const name = `Delete Test ${suffix.slice(0, 8)}`;
  let cookie = null;

  try {
    const registered = await request("/api/auth/register", {
      method: "POST",
      body: { name, email, password, acceptedAgeRequirement: true },
    });
    assert.equal(registered.status, 201);
    cookie = registered.cookie;
    assert.match(cookie ?? "", /^los_token=.+/);

    // Missing confirmPassword => 400, account preserved.
    const missing = await request("/api/auth/delete-account", {
      method: "DELETE",
      cookie,
      body: {},
    });
    assert.equal(missing.status, 400);

    // Wrong password => 401, account and session fully preserved.
    const wrong = await request("/api/auth/delete-account", {
      method: "DELETE",
      cookie,
      body: { confirmPassword: "TotallyWrong123!" },
    });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.data?.error, "Incorrect password");

    // The account still exists: session works and login works.
    const stillMe = await request("/api/auth/me", { cookie });
    assert.equal(stillMe.status, 200);
    assert.equal(stillMe.data?.email, email);

    const stillLogin = await request("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    assert.equal(stillLogin.status, 200);
    cookie = stillLogin.cookie;

    // The profile (private owned data) still exists.
    const profileBefore = await request("/api/profiles/me", { cookie });
    assert.equal(profileBefore.status, 200);

    // Correct password => 200, session cleared.
    const deleted = await request("/api/auth/delete-account", {
      method: "DELETE",
      cookie,
      body: { confirmPassword: password },
    });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.data?.message, "Account deleted");
    assert.equal(deleted.cookie, "los_token=");

    // Auth is gone: the old session no longer resolves to a user.
    const afterMe = await request("/api/auth/me", { cookie });
    assert.equal(afterMe.status, 401);

    // Login with the deleted account's credentials fails (auth removed).
    const afterLogin = await request("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    assert.equal(afterLogin.status, 401);
    assert.equal(afterLogin.data?.error, "Invalid credentials");

    cookie = null; // nothing left to clean up
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

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const baseUrl = (process.env.TEST_BASE_URL ?? "http://127.0.0.1:8080").replace(
  /\/+$/,
  "",
);

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("x-forwarded-for", options.clientIp ?? "198.51.100.10");
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (options.cookie) {
    headers.set("cookie", options.cookie);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body:
      options.body === undefined ? undefined : JSON.stringify(options.body),
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

test("registration creates one account, profile, and durable session with recoverable errors", async () => {
  const suffix = randomUUID();
  const email = `registration-test-${suffix}@example.com`;
  const password = "RegistrationPass123!";
  const expectedName = `Registration Test ${suffix.slice(0, 8)}`;
  let cookie = null;

  try {
    const malformedJson = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "198.51.100.10",
      },
      body: '{"email":',
    });
    assert.equal(malformedJson.status, 400);
    assert.deepEqual(await malformedJson.json(), {
      error: "Invalid JSON body",
    });

    const invalidPassword = await request("/api/auth/register", {
      method: "POST",
      body: {
        name: expectedName,
        email: `invalid-password-${suffix}@example.com`,
        password: "short",
        acceptedAgeRequirement: true,
      },
    });
    assert.equal(invalidPassword.status, 400);
    assert.equal(
      invalidPassword.data?.error,
      "Password must be at least 8 characters",
    );

    const invalidEmail = await request("/api/auth/register", {
      method: "POST",
      body: {
        name: expectedName,
        email: "not-an-email",
        password,
        acceptedAgeRequirement: true,
      },
    });
    assert.equal(invalidEmail.status, 400);
    assert.equal(invalidEmail.data?.error, "Invalid email address");

    const invalidShape = await request("/api/auth/register", {
      method: "POST",
      body: {
        name: ["not", "a", "name"],
        email: `invalid-shape-${suffix}@example.com`,
        password,
        acceptedAgeRequirement: true,
      },
    });
    assert.equal(invalidShape.status, 400);
    assert.equal(invalidShape.data?.error, "Name is required");

    const oversizedMultibytePassword = await request("/api/auth/register", {
      method: "POST",
      body: {
        name: expectedName,
        email: `oversized-password-${suffix}@example.com`,
        password: "🙂".repeat(20),
        acceptedAgeRequirement: true,
      },
    });
    assert.equal(oversizedMultibytePassword.status, 400);
    assert.equal(
      oversizedMultibytePassword.data?.error,
      "Password must be 72 bytes or fewer",
    );

    const missingAgeAttestation = await request("/api/auth/register", {
      method: "POST",
      body: { name: expectedName, email, password },
    });
    assert.equal(missingAgeAttestation.status, 400);
    assert.match(missingAgeAttestation.data?.error, /acceptedAgeRequirement/);

    const falseAgeAttestation = await request("/api/auth/register", {
      method: "POST",
      body: {
        name: expectedName,
        email,
        password,
        acceptedAgeRequirement: false,
      },
    });
    assert.equal(falseAgeAttestation.status, 400);
    assert.match(falseAgeAttestation.data?.error, /acceptedAgeRequirement/);

    const registered = await request("/api/auth/register", {
      method: "POST",
      body: {
        name: `  ${expectedName}  `,
        email: `  ${email.toUpperCase()}  `,
        password,
        acceptedAgeRequirement: true,
      },
    });
    assert.equal(registered.status, 201);
    assert.equal(registered.data?.user?.email, email);
    assert.equal(registered.data?.user?.name, expectedName);
    assert.equal(registered.data?.user?.isProfileComplete, false);
    assert.match(registered.cookie ?? "", /^los_token=.+/);
    const [persistedUser] = await db
      .select({
        ageRequirementAcceptedAt: usersTable.ageRequirementAcceptedAt,
      })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    assert.ok(
      persistedUser?.ageRequirementAcceptedAt instanceof Date,
      "registration must persist the 18+ attestation timestamp",
    );
    cookie = registered.cookie;

    const duplicate = await request("/api/auth/register", {
      method: "POST",
      body: { name: expectedName, email, password, acceptedAgeRequirement: true },
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.data?.error, "Email already in use");

    const currentUser = await request("/api/auth/me", { cookie });
    assert.equal(currentUser.status, 200);
    assert.equal(currentUser.data?.email, email);

    const refreshedSession = await request("/api/auth/me", { cookie });
    assert.equal(refreshedSession.status, 200);
    assert.equal(refreshedSession.data?.id, currentUser.data?.id);

    const profile = await request("/api/profiles/me", { cookie });
    assert.equal(profile.status, 200);
    assert.equal(profile.data?.userId, currentUser.data?.id);
    assert.equal(profile.data?.name, expectedName);

    const logout = await request("/api/auth/logout", {
      method: "POST",
      cookie,
    });
    assert.equal(logout.status, 200);
    assert.equal(logout.cookie, "los_token=");

    const anonymousAfterLogout = await request("/api/auth/me");
    assert.equal(anonymousAfterLogout.status, 401);
    assert.equal(anonymousAfterLogout.data?.error, "Unauthorized");

    const loggedIn = await request("/api/auth/login", {
      method: "POST",
      body: { email: ` ${email.toUpperCase()} `, password },
    });
    assert.equal(loggedIn.status, 200);
    assert.equal(loggedIn.data?.user?.email, email);
    assert.match(loggedIn.cookie ?? "", /^los_token=.+/);
    cookie = loggedIn.cookie;

    const wrongPassword = await request("/api/auth/login", {
      method: "POST",
      body: { email, password: "WrongPassword123!" },
    });
    assert.equal(wrongPassword.status, 401);
    assert.equal(wrongPassword.data?.error, "Invalid credentials");

    const unknownEmail = await request("/api/auth/login", {
      method: "POST",
      body: {
        email: `unknown-login-${suffix}@example.com`,
        password,
      },
    });
    assert.equal(unknownEmail.status, 401);
    assert.equal(unknownEmail.data?.error, "Invalid credentials");
  } finally {
    if (cookie) {
      const deleted = await request("/api/auth/delete-account", {
        method: "DELETE",
        cookie,
        body: { confirmPassword: password },
      });
      assert.equal(deleted.status, 200);
    }
  }
});
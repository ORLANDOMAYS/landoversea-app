import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = (process.env.TEST_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.45",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json();
  return { status: response.status, data };
}

test("social providers are never advertised and start never constructs a redirect", async () => {
  const providers = await request("/api/auth/providers");
  assert.equal(providers.status, 200);
  for (const provider of ["apple", "google", "facebook"]) {
    assert.equal(providers.data[provider].available, false);
    assert.ok(["credentials_unavailable", "callback_unavailable"].includes(providers.data[provider].reason));

    const started = await request(`/api/auth/social/${provider}/start`, {
      method: "POST",
      body: { redirectUri: "https://attacker.example/callback" },
    });
    assert.equal(started.status, 503);
    assert.equal(started.data.available, false);
    assert.equal(started.data.authorizationUrl, undefined);
  }
});
import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = (process.env.TEST_BASE_URL ?? "http://127.0.0.1:8080").replace(
  /\/+$/,
  "",
);

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "x-forwarded-for": "198.51.100.40" },
  });
  const rawBody = await response.text();
  return {
    status: response.status,
    data: rawBody === "" ? null : JSON.parse(rawBody),
  };
}

test("liveness endpoint reports ok", async () => {
  const res = await getJson("/api/healthz");
  assert.equal(res.status, 200);
  assert.equal(res.data?.status, "ok");
});

test("readiness verifies DB and reports capability states without leaking secrets", async () => {
  const res = await getJson("/api/readyz");
  // DB is reachable in a running dev server, so readiness should be OK.
  assert.equal(res.status, 200);
  assert.equal(res.data?.status, "ok");
  assert.equal(res.data?.checks?.database, "ok");

  const capabilities = res.data?.capabilities ?? {};
  for (const key of ["storage", "openai", "stripe", "email"]) {
    assert.ok(
      ["configured", "unavailable"].includes(capabilities[key]),
      `capability ${key} should be a configured/unavailable state`,
    );
  }

  // No secret material may appear anywhere in the readiness payload.
  const serialized = JSON.stringify(res.data);
  assert.doesNotMatch(serialized, /sk-[A-Za-z0-9]/); // OpenAI/Stripe secret keys
  assert.doesNotMatch(serialized, /postgres:\/\//); // DB connection string
  assert.doesNotMatch(serialized, /SG\.[A-Za-z0-9]/); // SendGrid key
});

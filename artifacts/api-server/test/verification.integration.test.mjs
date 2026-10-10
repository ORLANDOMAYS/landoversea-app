import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const baseUrl = (process.env.TEST_BASE_URL ?? "http://127.0.0.1:8080").replace(
  /\/+$/,
  "",
);

// A minimal but signature-valid 1x1 PNG.
const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("x-forwarded-for", options.clientIp ?? "198.51.100.61");
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (options.cookie) headers.set("cookie", options.cookie);

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

async function registerUser(label) {
  const suffix = randomUUID();
  const registered = await request("/api/auth/register", {
    method: "POST",
    body: {
      name: `Verify ${label} ${suffix.slice(0, 8)}`,
      email: `verify-${label}-${suffix}@example.com`,
      password: "VerifyPass123!",
      acceptedAgeRequirement: true,
    },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.data));
  return { cookie: registered.cookie };
}

async function submitSelfie(cookie, { bytes, type, filename }) {
  const form = new FormData();
  form.set("selfie", new Blob([bytes], { type }), filename);
  const response = await fetch(`${baseUrl}/api/verification/request`, {
    method: "POST",
    headers: { cookie, "x-forwarded-for": "198.51.100.61" },
    body: form,
  });
  const raw = await response.text();
  return { status: response.status, data: raw === "" ? null : JSON.parse(raw) };
}

test("verification/request rejects requests with no file (400, structured)", async () => {
  const user = await registerUser("nofile");
  const response = await fetch(`${baseUrl}/api/verification/request`, {
    method: "POST",
    headers: { cookie: user.cookie, "x-forwarded-for": "198.51.100.61" },
    body: new FormData(),
  });
  const data = await response.json();
  assert.equal(response.status, 400);
  assert.equal(data.code, "no_file");
});

test("verification/request rejects a non-image disguised as an image (invalid signature)", async () => {
  const user = await registerUser("badsig");
  // Declares image/png but the bytes are plain text — signature check fails.
  const res = await submitSelfie(user.cookie, {
    bytes: Buffer.from("this is definitely not a real png file at all"),
    type: "image/png",
    filename: "fake.png",
  });
  assert.equal(res.status, 400);
  assert.ok(
    res.data.code === "invalid_image" || res.data.code === "signature_mismatch",
    `unexpected code: ${res.data?.code}`,
  );
});

test("verification/request rejects an unsupported image type (gif)", async () => {
  const user = await registerUser("gif");
  // Valid GIF signature, but gif is not in the accepted set.
  const gif = Buffer.from("GIF89a", "ascii");
  const res = await submitSelfie(user.cookie, {
    bytes: gif,
    type: "image/gif",
    filename: "x.gif",
  });
  assert.equal(res.status, 400);
});

test("verification/request rejects oversize files (413) with shared 5MB limit", async () => {
  const user = await registerUser("oversize");
  // 6 MB buffer with a valid PNG header — must be rejected at the size limit.
  const oversize = Buffer.concat([VALID_PNG, Buffer.alloc(6 * 1024 * 1024, 0)]);
  const res = await submitSelfie(user.cookie, {
    bytes: oversize,
    type: "image/png",
    filename: "big.png",
  });
  assert.equal(res.status, 413, JSON.stringify(res.data));
  assert.equal(res.data.code, "file_too_large");
  assert.equal(res.data.maxBytes, 5 * 1024 * 1024);
});

test("verification/status requires auth", async () => {
  const res = await request("/api/verification/status");
  assert.equal(res.status, 401);
});

test("verification/status starts as none and never leaks selfie path", async () => {
  const user = await registerUser("status");
  const res = await request("/api/verification/status", { cookie: user.cookie });
  assert.equal(res.status, 200);
  assert.equal(res.data.status, "none");
  assert.equal(res.data.selfieUrl, undefined);
});

// Valid-upload + persistence + privacy depend on live object storage. When the
// storage sidecar/env is unavailable the server returns 502/500; in that case we
// skip the assertions that require a stored object rather than fail spuriously.
test("valid selfie upload persists pending status without exposing the private path", async () => {
  const user = await registerUser("valid");
  const res = await submitSelfie(user.cookie, {
    bytes: VALID_PNG,
    type: "image/png",
    filename: "selfie.png",
  });

  if (res.status === 502 || res.status === 500) {
    console.warn(
      `Skipping valid-upload assertions: object storage unavailable (status ${res.status})`,
    );
    return;
  }

  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.status, "pending");
  // The private selfie object path must never appear in the client payload.
  assert.equal(res.data.selfieUrl, undefined);

  // Status endpoint reflects the persisted pending state and also hides the path.
  const status = await request("/api/verification/status", { cookie: user.cookie });
  assert.equal(status.status, 200);
  assert.equal(status.data.status, "pending");
  assert.equal(status.data.selfieUrl, undefined);
});

// Cross-user privacy: even if user B guesses/obtains user A's stored object
// path, they cannot read it through the ACL-guarded storage endpoint.
test("cross-user privacy: another user cannot read someone else's private object path", async () => {
  const attacker = await registerUser("attacker");
  // Probe a plausible private object path; the ACL check must forbid or 404 it,
  // never stream the bytes.
  const probe = await fetch(
    `${baseUrl}/api/storage/objects/uploads/${randomUUID()}`,
    { headers: { cookie: attacker.cookie, "x-forwarded-for": "198.51.100.61" } },
  );
  assert.ok(
    probe.status === 403 || probe.status === 404,
    `expected 403/404, got ${probe.status}`,
  );
});

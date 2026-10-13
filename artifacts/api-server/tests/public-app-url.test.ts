import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_PUBLIC_APP_URL,
  getAllowedCorsOrigins,
  resolvePublicAppUrl,
} from "../src/lib/publicAppUrl";

test("production public links use the canonical origin and reject malformed configuration", () => {
  assert.equal(
    resolvePublicAppUrl({
      nodeEnv: "production",
      publicAppUrl: CANONICAL_PUBLIC_APP_URL,
      requestOrigin: "https://internal-preview.replit.app",
    }),
    CANONICAL_PUBLIC_APP_URL,
  );
  assert.equal(
    resolvePublicAppUrl({ nodeEnv: "production" }),
    CANONICAL_PUBLIC_APP_URL,
  );
  assert.throws(
    () => resolvePublicAppUrl({
      nodeEnv: "production",
      publicAppUrl: `${CANONICAL_PUBLIC_APP_URL}/path`,
    }),
    /bare HTTPS origin/,
  );
  assert.throws(
    () => resolvePublicAppUrl({
      nodeEnv: "production",
      publicAppUrl: "https://other.example",
    }),
    /must equal https:\/\/landover-sea\.com/,
  );
});

test("development public links retain the current localhost or preview origin", () => {
  assert.equal(
    resolvePublicAppUrl({
      nodeEnv: "development",
      publicAppUrl: CANONICAL_PUBLIC_APP_URL,
      requestOrigin: "http://localhost:5173",
    }),
    "http://localhost:5173",
  );
  assert.equal(
    resolvePublicAppUrl({
      nodeEnv: "development",
      requestOrigin: "https://preview.example",
    }),
    "https://preview.example",
  );
});

test("production CORS allows exact canonical and internal fallback origins only", () => {
  const origins = getAllowedCorsOrigins({
    publicAppUrl: CANONICAL_PUBLIC_APP_URL,
    allowedOrigins: CANONICAL_PUBLIC_APP_URL,
    replitDomains: "internal-preview.replit.app",
  });

  assert.ok(origins.has(CANONICAL_PUBLIC_APP_URL));
  assert.ok(origins.has("https://internal-preview.replit.app"));
  assert.equal(origins.has("https://evil.example"), false);
  assert.equal(origins.has("https://landover-sea.com.evil.example"), false);
});
const test = require("node:test");
const assert = require("node:assert/strict");

const mobile = require("../apps/mobile/lib/auth-flow.js");
const web = require("../apps/web/src/lib/auth-flow.js");

test("mobile parser accepts PKCE links", () => {
  assert.deepEqual(
    mobile.parseAuthCallbackUrl("landoversea://auth-callback?code=abc123"),
    { kind: "pkce", code: "abc123" }
  );
});

test("mobile parser accepts legacy hash sessions", () => {
  assert.deepEqual(
    mobile.parseAuthCallbackUrl(
      "landoversea://auth-callback#access_token=access&refresh_token=refresh"
    ),
    { kind: "legacy", accessToken: "access", refreshToken: "refresh" }
  );
});

test("callback parsers surface provider and invalid-link errors", () => {
  assert.deepEqual(
    mobile.parseAuthCallbackUrl(
      "landoversea://auth-callback?error=access_denied&error_description=Expired"
    ),
    { kind: "error", message: "Expired" }
  );
  assert.equal(web.parseWebAuthCallback("?unrelated=1").kind, "invalid");
  assert.deepEqual(web.parseWebAuthCallback("?code=web-code"), {
    kind: "pkce",
    code: "web-code",
  });
});

test("guards require an authenticated and complete adult profile", () => {
  const complete = { display_name: "Ada", age: 30, gender: "female" };
  assert.equal(
    mobile.decideAuthDestination({ hasSession: true, profile: complete }),
    "/(tabs)/discover"
  );
  assert.equal(
    mobile.decideAuthDestination({
      hasSession: true,
      profile: { ...complete, gender: "" },
    }),
    "/(tabs)/profile"
  );
  assert.equal(
    web.decideAuthDestination({ hasSession: false, profile: complete }),
    "/auth"
  );
  assert.equal(
    web.decideAuthDestination({ hasSession: true, profile: null }),
    "/app/profile?onboarding=1"
  );
});
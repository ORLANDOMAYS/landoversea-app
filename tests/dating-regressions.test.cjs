const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const state = require("../apps/mobile/lib/dating-state.js");

test("discovery filters clamp ages and sanitize PostgREST filter punctuation", () => {
  assert.deepEqual(
    state.normalizeDiscoveryFilters({ minAge: "15", maxAge: "200", gender: " female ", location: "Paris,%" }),
    { minAge: 18, maxAge: 120, gender: "female", location: "Paris" }
  );
  assert.equal(state.normalizeDiscoveryFilters({ minAge: 40, maxAge: 20 }).maxAge, 40);
});

test("swipes advance only after persistence succeeds", () => {
  assert.equal(state.nextSwipeState(3, false), 3);
  assert.equal(state.nextSwipeState(3, true), 4);
});

test("translation and failed draft state avoid duplicates and data loss", () => {
  assert.equal(state.translatedBodyOrNull("Hello", "Hello"), null);
  assert.equal(state.translatedBodyOrNull("Hello", " Bonjour "), "Bonjour");
  assert.equal(state.restoreFailedDraft("", "retry me"), "retry me");
  assert.equal(state.restoreFailedDraft("new text", "retry me"), "new text");
});

test("web and mobile source contracts persist swipes and surface realtime state", () => {
  const files = [
    "apps/web/src/lib/api.ts",
    "apps/mobile/lib/api.js",
    "apps/web/src/app/app/chat/page.tsx",
    "apps/mobile/app/chat.js",
  ].map((file) => fs.readFileSync(path.join(root, file), "utf8"));
  for (const api of files.slice(0, 2)) {
    assert.match(api, /\.upsert\(/);
    assert.match(api, /onConflict:\s*["']swiper_id,swiped_id["']/);
    assert.match(api, /if \(error\) throw error/);
  }
  for (const chat of files.slice(2)) {
    assert.match(chat, /connectionStatus/);
    assert.match(chat, /Reconnect/);
    assert.match(chat, /finally/);
  }
});

test("profile surfaces cap photos and expose delete controls", () => {
  const web = fs.readFileSync(path.join(root, "apps/web/src/app/app/profile/page.tsx"), "utf8");
  const mobile = fs.readFileSync(path.join(root, "apps/mobile/app/(tabs)/profile.js"), "utf8");
  assert.match(web, /photos\.length < 6/);
  assert.match(mobile, /photos\.length < 6/);
  assert.match(web, /aria-label="Delete profile photo"/);
  assert.match(mobile, /accessibilityLabel="Delete profile photo"/);
});
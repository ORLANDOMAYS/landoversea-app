const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const state = require("../apps/mobile/lib/dating-state.js");
const matchLoader = require("../apps/mobile/lib/match-loader.js");

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

test("mobile matches retry resolves a recovered session before querying matches", async () => {
  let sessionAttempts = 0;
  const queriedUserIds = [];
  const getCurrentUser = async () => {
    sessionAttempts += 1;
    if (sessionAttempts === 1) throw new Error("session unavailable");
    return { id: "recovered-user" };
  };
  const getMatches = async (userId) => {
    queriedUserIds.push(userId);
    return [{ id: "match-1" }];
  };

  await assert.rejects(
    matchLoader.loadMatchesForCurrentUser(getCurrentUser, getMatches),
    /session unavailable/
  );
  assert.deepEqual(queriedUserIds, []);
  assert.deepEqual(
    await matchLoader.loadMatchesForCurrentUser(getCurrentUser, getMatches),
    { userId: "recovered-user", matches: [{ id: "match-1" }] }
  );
  assert.deepEqual(queriedUserIds, ["recovered-user"]);

  const mobile = fs.readFileSync(path.join(root, "apps/mobile/app/(tabs)/matches.js"), "utf8");
  assert.match(mobile, /loadMatchesForCurrentUser\(getCurrentUser, getMatches\)/);
  assert.match(
    mobile,
    /accessibilityLabel="Retry loading matches"[\s\S]{0,180}onPress=\{loadMatches\}/
  );
  assert.doesNotMatch(mobile, /getMatches\(userId\)/);
});
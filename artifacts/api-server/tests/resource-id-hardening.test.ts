import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parsePositiveSafeInteger } from "../src/lib/positiveSafeInteger";

const malformedIds = [
  "3f06a90c-b7bd-4bb2-93f8-43b322ca620d",
  "12abc",
  "12.9",
  "1e3",
  "0",
  "-1",
  "01",
  "9007199254740992",
];

test("positive resource IDs accept only canonical safe base-10 strings", () => {
  for (const [raw, expected] of [
    ["1", 1],
    ["42", 42],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ] as const) {
    assert.equal(parsePositiveSafeInteger(raw), expected, raw);
  }

  for (const raw of [
    ...malformedIds,
    "",
    " 1",
    "1 ",
    "+1",
    "١",
    1,
    null,
    undefined,
  ]) {
    assert.equal(parsePositiveSafeInteger(raw), null, String(raw));
  }
});

test("representative resource route families use the shared parser before lookup", async () => {
  const cases = [
    ["../src/routes/coaching.ts", "const bId = parsePositiveSafeInteger", "db.select().from(bookingsTable)"],
    ["../src/routes/payments.ts", "const bId = parsePositiveSafeInteger", "db.select().from(bookingsTable)"],
    ["../src/routes/matches.ts", "const matchId = parsePositiveSafeInteger", "db.select().from(matchesTable)"],
    ["../src/routes/cultural.ts", "const eventId = parsePositiveSafeInteger", "db.select().from(culturalEventsTable)"],
    ["../src/routes/admin-migrations.ts", "const runId = parsePositiveSafeInteger", "getRunDetail(runId)"],
    ["../src/routes/admin.ts", "const requestId = parsePositiveSafeInteger", "db.update(accountDeletionRequestsTable)"],
    ["../src/routes/profiles.ts", "const userId = parsePositiveId", "const profile = await getProfileWithPhotos(userId)"],
  ] as const;

  for (const [path, parseMarker, lookupMarker] of cases) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    const parseAt = source.indexOf(parseMarker);
    assert.notEqual(parseAt, -1, `${path} must parse with the shared helper`);
    assert.notEqual(source.indexOf("if (", parseAt), -1, `${path} must check the parse result`);
    assert.ok(source.indexOf(lookupMarker, parseAt) > parseAt, `${path} must parse before lookup`);
  }
});
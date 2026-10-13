import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Supabase request context is Bearer-only and non-enumerable", async () => {
  const source = await readFile(
    new URL("../src/lib/auth.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /selected\.source === "cookie"[\s\S]*else \{/);
  assert.match(source, /provider:\s*"supabase"[\s\S]*subject:\s*identity\.id[\s\S]*accessToken:\s*token/);
  assert.match(source, /Object\.defineProperty\(req,\s*"supabaseAuth"/);
  assert.match(source, /enumerable:\s*false/);
});

test("coach resolver precedes numeric coach detail and maps immutable owner subject", async () => {
  const source = await readFile(
    new URL("../src/routes/coaching.ts", import.meta.url),
    "utf8",
  );
  const resolver = source.indexOf('router.get("/coaches/resolve/:coachIdentifier"');
  const detail = source.indexOf('router.get("/coaches/:coachId"');
  assert.ok(resolver >= 0 && detail > resolver);
  assert.match(source, /externalIdentitiesTable\.provider,\s*"supabase"/);
  assert.match(source, /externalIdentitiesTable\.subject,\s*supabaseCoach\.ownerId/);
  assert.match(source, /if \(!linked\)[\s\S]*code:\s*"coach_not_linked"/);
  assert.match(source, /code:\s*"coach_not_linked"/);
  assert.doesNotMatch(source.slice(resolver, detail), /parseInt/);
});

test("all UUID-capable coach routes share strict resolution before local logic", async () => {
  const source = await readFile(
    new URL("../src/routes/coaching.ts", import.meta.url),
    "utf8",
  );
  const availabilityStart = source.indexOf('router.get("/coaches/:coachId/availability"');
  const availabilityEnd = source.indexOf('router.get("/coaches/:coachId/reviews"', availabilityStart);
  const detailStart = source.indexOf('router.get("/coaches/:coachId"');
  const detailEnd = availabilityStart;
  const reviewsStart = availabilityEnd;
  const reviewsEnd = source.indexOf('router.post("/coaches/me"', reviewsStart);
  const bookingStart = source.indexOf('router.post("/bookings"');
  const bookingEnd = source.indexOf('router.get("/bookings/:bookingId"', bookingStart);
  assert.ok(availabilityStart >= 0 && availabilityEnd > availabilityStart);
  assert.ok(detailStart >= 0 && detailEnd > detailStart);
  assert.ok(reviewsStart >= 0 && reviewsEnd > reviewsStart);
  assert.ok(bookingStart >= 0 && bookingEnd > bookingStart);

  const detail = source.slice(detailStart, detailEnd);
  const availability = source.slice(availabilityStart, availabilityEnd);
  const reviews = source.slice(reviewsStart, reviewsEnd);
  const booking = source.slice(bookingStart, bookingEnd);
  assert.match(detail, /resolveCoachIdentifierForRequest\(req,\s*rawCoachId\)/);
  assert.match(availability, /resolveCoachIdentifierForRequest\(req,\s*rawCoachId\)/);
  assert.match(reviews, /resolveCoachIdentifierForRequest\(req,\s*rawCoachId\)/);
  assert.match(booking, /resolveCoachIdentifierForRequest\(req,\s*coachIdentifier\)/);
  assert.match(booking, /const coachId = resolution\.coachId[\s\S]*db\.transaction/);
  assert.doesNotMatch(detail, /parseInt/);
  assert.doesNotMatch(availability, /parseInt/);
  assert.doesNotMatch(reviews, /parseInt/);
  assert.doesNotMatch(booking, /parseInt/);

  const helperStart = source.indexOf("async function resolveCoachIdentifierForRequest");
  const helperEnd = source.indexOf("const MAX_CREDENTIAL_BYTES", helperStart);
  const helper = source.slice(helperStart, helperEnd);
  assert.match(helper, /parseCoachIdentifier\(rawIdentifier\)/);
  assert.match(helper, /fetchVisibleSupabaseCoach\([\s\S]*auth\.accessToken/);
  assert.match(helper, /externalIdentitiesTable\.subject,\s*supabaseCoach\.ownerId/);
  assert.match(helper, /eq\(coachesTable\.isVerified,\s*true\)/);
  assert.match(helper, /eq\(coachesTable\.verificationStatus,\s*"approved"\)/);
  assert.doesNotMatch(helper, /parseInt/);
});

test("legacy-only coach filters are strict and no coach identifier uses permissive parseInt", async () => {
  const source = await readFile(
    new URL("../src/routes/coaching.ts", import.meta.url),
    "utf8",
  );
  const workshopsStart = source.indexOf('router.get("/workshops"');
  const workshopsEnd = source.indexOf('router.get("/workshops/:workshopId"', workshopsStart);
  const workshops = source.slice(workshopsStart, workshopsEnd);
  assert.match(workshops, /strictLocalCoachId\(coachId\)/);
  assert.match(workshops, /if \(!localCoachId\)[\s\S]*res\.status\(400\)/);
  assert.doesNotMatch(workshops, /parseInt/);
  assert.doesNotMatch(
    source,
    /parseInt\([^\n;]*(?:coachId|coachIdentifier)|(?:coachId|coachIdentifier)[^\n;]*parseInt\(/i,
  );
  assert.doesNotMatch(source, /Number\((?:coachId|coachIdentifier)\)/);
  assert.match(source, /const coachId = strictLocalCoachId\(req\.body\.coachId\)/);

  const resolver = source.indexOf('router.get("/coaches/resolve/:coachIdentifier"');
  const me = source.indexOf('router.get("/coaches/me"');
  const detail = source.indexOf('router.get("/coaches/:coachId"');
  assert.ok(me >= 0 && resolver > me && detail > resolver, "static coach routes must precede identifier routes");
});
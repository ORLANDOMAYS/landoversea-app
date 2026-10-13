import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchVisibleSupabaseCoach,
  parseCoachIdentifier,
} from "../src/lib/coach-id-bridge";
import { SupabaseAuthError } from "../src/lib/supabase-auth";

const alphaLeadingUuid = "af06a90c-b7bd-4bb2-93f8-43b322ca620d";
const digitLeadingUuid = "3f06a90c-b7bd-4bb2-93f8-43b322ca620d";

test("coach identifiers accept strict positive decimals and alpha- or digit-leading UUIDs", () => {
  assert.deepEqual(parseCoachIdentifier("42"), { kind: "local", id: 42 });
  assert.deepEqual(parseCoachIdentifier(alphaLeadingUuid), {
    kind: "supabase",
    id: alphaLeadingUuid,
  });
  assert.deepEqual(parseCoachIdentifier(digitLeadingUuid), {
    kind: "supabase",
    id: digitLeadingUuid,
  });
  for (const invalid of ["", "0", "-1", "01", "1x", "1.5", "1e3", " 1", "42 ", "Infinity", "coach"]) {
    assert.equal(parseCoachIdentifier(invalid), null);
  }
});

test("Supabase coach lookup uses the public key and the viewer's token with eligibility filters", async () => {
  let requestedUrl = "";
  let requestedHeaders = new Headers();
  const coach = await fetchVisibleSupabaseCoach(alphaLeadingUuid, "viewer-access-token", {
    url: "https://project.supabase.co",
    publishableKey: "public-key",
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      requestedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify([{
        id: alphaLeadingUuid,
        owner_id: "verified-owner-subject",
        approved: true,
        active: true,
        verified: true,
      }]), { status: 200 });
    },
  });

  const endpoint = new URL(requestedUrl);
  assert.equal(endpoint.pathname, "/rest/v1/coaches");
  assert.equal(endpoint.searchParams.get("id"), `eq.${alphaLeadingUuid}`);
  assert.equal(endpoint.searchParams.get("approved"), "eq.true");
  assert.equal(endpoint.searchParams.get("active"), "eq.true");
  assert.equal(endpoint.searchParams.get("verified"), "eq.true");
  assert.equal(requestedHeaders.get("apikey"), "public-key");
  assert.equal(requestedHeaders.get("authorization"), "Bearer viewer-access-token");
  assert.deepEqual(coach, { id: alphaLeadingUuid, ownerId: "verified-owner-subject" });
});

test("Supabase coach lookup fails closed for invisible and malformed rows", async () => {
  const options = {
    url: "https://project.supabase.co",
    publishableKey: "public-key",
  };
  assert.equal(await fetchVisibleSupabaseCoach(digitLeadingUuid, "token", {
    ...options,
    fetchImpl: async () => new Response("[]", { status: 200 }),
  }), null);

  await assert.rejects(
    fetchVisibleSupabaseCoach(digitLeadingUuid, "token", {
      ...options,
      fetchImpl: async () => new Response(JSON.stringify([{
        id: digitLeadingUuid,
        owner_id: "owner",
        approved: true,
        active: false,
        verified: true,
      }]), { status: 200 }),
    }),
    (error: unknown) =>
      error instanceof SupabaseAuthError &&
      error.code === "provider_unavailable",
  );
});
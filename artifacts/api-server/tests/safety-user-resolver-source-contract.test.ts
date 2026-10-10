import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("safety resolver validates UUIDs and resolves only exact Supabase identity subjects", async () => {
  const source = await readFile(
    new URL("../src/routes/safety.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf('router.get("/safety/users/resolve/:supabaseUserId"');
  const end = source.indexOf('router.post("/safety/block"', start);
  assert.ok(start >= 0 && end > start, "resolver must precede safety mutations");
  const resolver = source.slice(start, end);

  assert.match(resolver, /UUID_PATTERN\.test\(supabaseUserId\)/);
  assert.match(resolver, /res\.status\(400\)/);
  assert.match(resolver, /externalIdentitiesTable\.provider,\s*"supabase"/);
  assert.match(resolver, /externalIdentitiesTable\.subject,\s*supabaseUserId/);
  assert.match(resolver, /res\.status\(404\)/);
  assert.match(resolver, /res\.json\(\{\s*userId:\s*linked\.userId\s*\}\)/);
  assert.doesNotMatch(resolver, /email|hash|parseInt|Number\(/i);
});

test("OpenAPI and generated client expose the authenticated safety UUID resolver", async () => {
  const [spec, generated] = await Promise.all([
    readFile(
      new URL("../../../lib/api-spec/openapi.yaml", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../../../lib/api-client-react/src/generated/api.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(spec, /\/safety\/users\/resolve\/\{supabaseUserId\}:/);
  assert.match(spec, /operationId:\s*resolveSafetyUser/);
  assert.match(spec, /pattern:\s*'\^\[0-9a-fA-F\]/);
  assert.match(spec, /"400":\s*\n\s*description: Invalid Supabase user ID/);
  assert.match(spec, /"404":\s*\n\s*description: Supabase user has no linked local safety identity/);
  assert.match(generated, /export function useResolveSafetyUser/);
  assert.match(generated, /resolveSafetyUser\(supabaseUserId/);
});

test("fallback safety copy does not promise unavailable actions at any time", async () => {
  const source = await readFile(
    new URL("../src/routes/safety.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /unmatch or block anyone at any time/i);
  assert.match(
    source,
    /safety controls currently available[\s\S]*temporarily unavailable/i,
  );
});
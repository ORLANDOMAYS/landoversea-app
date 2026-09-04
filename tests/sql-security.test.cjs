const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/004_auth_and_rls_security.sql"),
  "utf8"
);

test("security fix is a new forward-only migration", () => {
  const migrations = fs
    .readdirSync(path.join(root, "supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.deepEqual(migrations.slice(0, 4), [
    "001_init.sql",
    "002_dating_app.sql",
    "003_premium_upgrade.sql",
    "004_auth_and_rls_security.sql",
  ]);
});

test("self verification and premium upgrade are not client executable", () => {
  for (const signature of ["verify_profile(uuid)", "upgrade_to_premium()"]) {
    assert.match(
      migration,
      new RegExp(
        `revoke all on function public\\.${signature.replace(/[()]/g, "\\$&")} from public, anon, authenticated`,
        "i"
      )
    );
  }
});

test("security-definer functions have fixed search paths and auth guards", () => {
  for (const signature of [
    "ensure_profile()",
    "check_match()",
    "ensure_match(uuid)",
    "protect_privileged_columns()",
    "verify_profile(uuid)",
    "upgrade_to_premium()",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `alter function public\\.${signature.replace(/[()]/g, "\\$&")} set search_path`,
        "i"
      )
    );
  }
  assert.match(migration, /if me is null then/i);
  assert.match(migration, /if auth\.uid\(\) is null then/i);
});

test("broad discovery reads require auth and locations are owner-only", () => {
  assert.match(migration, /profiles_read_authenticated[\s\S]*to authenticated/i);
  assert.match(migration, /photos_read_authenticated[\s\S]*to authenticated/i);
  assert.match(
    migration,
    /locations_read_self[\s\S]*to authenticated[\s\S]*auth\.uid\(\) = user_id/i
  );
  assert.doesNotMatch(migration, /create policy locations_read_all/i);
});
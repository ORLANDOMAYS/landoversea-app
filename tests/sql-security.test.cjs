const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migration004 = fs.readFileSync(
  path.join(root, "supabase/migrations/004_auth_and_rls_security.sql"),
  "utf8"
);
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/005_platform_security.sql"),
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
  assert.equal(migrations[4], "005_platform_security.sql");
});

test("self verification and premium upgrade are not client executable", () => {
  for (const signature of ["verify_profile(uuid)", "upgrade_to_premium()"]) {
    assert.match(
      `${migration004}\n${migration}`,
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
      migration004,
      new RegExp(
        `alter function public\\.${signature.replace(/[()]/g, "\\$&")} set search_path`,
        "i"
      )
    );
  }
  assert.match(migration004, /if me is null then/i);
  assert.match(migration004, /if auth\.uid\(\) is null then/i);
});

test("broad discovery reads require auth and locations are owner-only", () => {
  assert.match(migration004, /profiles_read_authenticated[\s\S]*to authenticated/i);
  assert.match(migration004, /photos_read_authenticated[\s\S]*to authenticated/i);
  assert.match(
    migration004,
    /locations_read_self[\s\S]*to authenticated[\s\S]*auth\.uid\(\) = user_id/i
  );
  assert.doesNotMatch(migration004, /create policy locations_read_all/i);
});

test("private photo bucket and owner paths have least-privilege policies", () => {
  assert.match(migration, /'photos',\s*'photos',\s*false,\s*10485760/i);
  assert.match(migration, /allowed_mime_types[\s\S]*image\/jpeg[\s\S]*image\/png[\s\S]*image\/webp/i);
  assert.match(migration, /photos_objects_read_authenticated[\s\S]*for select to authenticated/i);
  for (const action of ["insert", "update", "delete"]) {
    assert.match(
      migration,
      new RegExp(`photos_objects_${action}_owner[\\s\\S]*storage\\.foldername\\(name\\)\\)\\[1\\] = auth\\.uid\\(\\)::text`, "i")
    );
  }
  assert.match(migration, /A profile can have at most six photos/i);
});

test("all client tables explicitly deny anonymous grants and owned writes use RLS", () => {
  assert.match(migration, /revoke all on table[\s\S]*public\.coaches from public, anon/i);
  for (const policy of [
    "profiles_update_self",
    "profiles_delete_self",
    "photos_update_self",
    "swipes_update_self",
    "swipes_delete_self",
    "messages_update_self",
    "messages_delete_self",
    "locations_update_self",
    "locations_delete_self",
  ]) {
    assert.match(migration, new RegExp(`create policy ${policy}[\\s\\S]*to authenticated`, "i"));
  }
});

test("coaches are approved-only and cannot self-approve", () => {
  assert.match(migration, /create table public\.coaches/i);
  for (const field of ["display_name", "avatar_url", "bio", "languages", "specialties", "hourly_rate", "platform_fee_percent", "rating", "total_reviews", "total_sessions", "verified", "approved", "active"]) {
    assert.match(migration, new RegExp(`\\b${field}\\b`, "i"));
  }
  assert.match(migration, /coaches_read_approved[\s\S]*approved and active/i);
  assert.match(migration, /coaches_insert_self_unapproved[\s\S]*approved = false[\s\S]*active = false[\s\S]*verified = false/i);
  assert.match(migration, /new\.approved := old\.approved/i);
});
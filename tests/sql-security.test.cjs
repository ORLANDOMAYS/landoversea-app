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
const hostedUpgrade = fs.readFileSync(
  path.join(root, "supabase/migrations/007_hosted_legacy_security_upgrade.sql"),
  "utf8"
);
const advisorHardening = fs.readFileSync(
  path.join(root, "supabase/migrations/008_live_advisor_hardening.sql"),
  "utf8"
);
const webApi = fs.readFileSync(path.join(root, "apps/web/src/lib/api.ts"), "utf8");
const mobileApi = fs.readFileSync(path.join(root, "apps/mobile/lib/api.js"), "utf8");

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
  assert.equal(migrations[5], "006_legacy_photo_and_coordinate_privacy.sql");
  assert.equal(migrations[6], "007_hosted_legacy_security_upgrade.sql");
  assert.equal(migrations[7], "008_live_advisor_hardening.sql");
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
  for (const action of ["read", "insert", "update", "delete"]) {
    assert.match(
      migration,
      new RegExp(`photos_objects_${action}_guard[\\s\\S]*as restrictive[\\s\\S]*to public[\\s\\S]*bucket_id <> 'photos'`, "i")
    );
  }
  assert.match(migration, /A profile can have at most six photos/i);
});

test("legacy photo and location policies are replaced or neutralized", () => {
  for (const table of ["photos", "user_locations"]) {
    assert.match(
      migration,
      new RegExp(`from pg_catalog\\.pg_policies[\\s\\S]*tablename = '${table}'[\\s\\S]*drop policy if exists %I on public\\.${table}`, "i")
    );
  }
  assert.match(migration, /create policy photos_read_authenticated[\s\S]*to authenticated/i);
  assert.match(migration, /create policy locations_read_self[\s\S]*auth\.uid\(\) = user_id/i);
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
  assert.match(migration, /create table if not exists public\.coaches/i);
  for (const field of ["display_name", "avatar_url", "bio", "languages", "specialties", "hourly_rate", "platform_fee_percent", "rating", "total_reviews", "total_sessions", "verified", "approved", "active"]) {
    assert.match(migration, new RegExp(`\\b${field}\\b`, "i"));
  }
  assert.match(migration, /coaches_read_approved[\s\S]*verified and approved and active/i);
  assert.match(migration, /coaches_insert_self_unapproved[\s\S]*auth\.uid\(\) = owner_id[\s\S]*approved = false[\s\S]*active = false[\s\S]*verified = false/i);
  assert.match(migration, /new\.approved := old\.approved/i);
  assert.match(migration, /new\.approved := false/i);
});

test("legacy coaches are upgraded in place without deleting existing records", () => {
  assert.doesNotMatch(
    migration,
    /\b(?:drop\s+table|truncate\s+table|delete\s+from)\s+(?:public\.)?coaches\b/i
  );
  for (const field of ["owner_id", "approved", "active", "verified", "avatar_url", "hourly_rate", "total_reviews"]) {
    assert.match(
      migration,
      new RegExp(`add column if not exists ${field}\\b`, "i")
    );
  }
  assert.match(migration, /legacy_user_id_type = 'uuid'[\s\S]*set owner_id = user_id/i);
  assert.match(migration, /column_name = 'photo_url'[\s\S]*set avatar_url = photo_url/i);
  assert.match(migration, /column_name = 'rates_per_hour'[\s\S]*set hourly_rate/i);
  assert.match(migration, /column_name = 'review_count'[\s\S]*set total_reviews/i);
  assert.match(migration, /column_name = 'is_verified'[\s\S]*set verified = true/i);
  assert.match(migration, /column_name = 'verification_status'[\s\S]*\('approved', 'verified'\)/i);
  assert.match(migration, /set active = false[\s\S]*not approved or not verified/i);
  assert.match(migration, /pg_get_serial_sequence\('public\.coaches', 'id'\)/i);
  assert.match(migration, /grant usage, select on sequence %s to authenticated/i);
});

test("already-migrated hosted databases receive the legacy-safe hardening in migration 007", () => {
  for (const source of [migration, hostedUpgrade]) {
    assert.match(source, /create table if not exists public\.coaches/i);
    assert.doesNotMatch(
      source,
      /\b(?:drop\s+table|truncate\s+table|delete\s+from)\s+(?:public\.)?coaches\b/i
    );
    assert.match(source, /add column if not exists owner_id uuid/i);
    assert.match(source, /column_name = 'verification_status'[\s\S]*\('approved', 'verified'\)/i);
    assert.match(source, /set active = false[\s\S]*not approved or not verified/i);
    assert.match(source, /photos_objects_read_guard[\s\S]*as restrictive/i);
    assert.match(source, /tablename = 'coaches'[\s\S]*drop policy if exists %I on public\.coaches/i);
  }
});

test("all legacy coach policies are removed before moderated policies are installed", () => {
  assert.match(
    migration,
    /from pg_catalog\.pg_policies[\s\S]*tablename = 'coaches'[\s\S]*drop policy if exists %I on public\.coaches/i
  );
  assert.match(migration, /coaches_read_self[\s\S]*auth\.uid\(\) = owner_id/i);
  assert.match(migration, /before insert or update on public\.coaches/i);
  assert.match(migration, /new\.owner_id := auth\.uid\(\)/i);
});

test("advisor hardening gives authenticated clients only the intended match RPC", () => {
  assert.match(webApi, /\.rpc\("ensure_match"/);
  assert.match(mobileApi, /\.rpc\("ensure_match"/);
  assert.match(
    advisorHardening,
    /revoke all on function public\.ensure_match\(uuid\)[\s\S]*from public, anon, authenticated[\s\S]*grant execute on function public\.ensure_match\(uuid\) to authenticated/i
  );

  const authenticatedGrants = [
    ...advisorHardening.matchAll(
      /grant execute on function\s+([^\n]+?)\s+to authenticated/gi
    ),
  ].map((match) => match[1].trim());
  assert.deepEqual(authenticatedGrants, ["public.ensure_match(uuid)"]);

  for (const signature of [
    "ensure_profile()",
    "check_match()",
    "protect_privileged_columns()",
    "verify_profile(uuid)",
    "upgrade_to_premium()",
    "enforce_photo_write()",
    "enforce_location_write()",
    "protect_coach_moderation()",
  ]) {
    assert.match(
      advisorHardening,
      new RegExp(
        `revoke all on function public\\.${signature.replace(/[()]/g, "\\$&")}\\s+from public, anon, authenticated`,
        "i"
      )
    );
  }
});

test("advisor hardening fixes application function search paths and future defaults", () => {
  assert.match(
    advisorHardening,
    /alter default privileges[\s\S]*revoke execute on functions from public/i
  );
  assert.match(advisorHardening, /where n\.nspname = 'public'/i);
  assert.match(advisorHardening, /d\.deptype = 'e'/i);
  assert.match(
    advisorHardening,
    /alter function %s set search_path = pg_catalog, public/i
  );
  assert.match(
    advisorHardening,
    /target_function\.prosecdef[\s\S]*revoke all on function %s from public, anon, authenticated/i
  );
});

test("advisor hardening replaces sensitive-table policies with canonical authenticated policies", () => {
  const appPolicySection = advisorHardening.slice(
    advisorHardening.indexOf("alter table public.profiles enable row level security"),
    advisorHardening.indexOf("-- Remove anonymous table access")
  );
  for (const table of [
    "profiles",
    "photos",
    "swipes",
    "matches",
    "messages",
    "user_locations",
    "coaches",
  ]) {
    assert.match(advisorHardening, new RegExp(`'${table}'`, "i"));
    assert.match(
      advisorHardening,
      /drop policy if exists %I on public\.%I/i
    );
  }
  assert.doesNotMatch(
    appPolicySection,
    /create policy [\s\S]*?\bto (?:anon|public)\b/i
  );
  assert.match(
    advisorHardening,
    /revoke all on table[\s\S]*public\.coaches[\s\S]*from public, anon/i
  );
  assert.match(
    advisorHardening,
    /create policy coaches_read_allowed[\s\S]*verified and approved and active[\s\S]*or \(select auth\.uid\(\)\) = owner_id/i
  );
});

test("advisor hardening preserves authenticated product policy behavior with init-plan auth lookups", () => {
  for (const policy of [
    "profiles_read_authenticated",
    "profiles_insert_self",
    "photos_read_authenticated",
    "photos_insert_self",
    "swipes_read_participant",
    "swipes_insert_self",
    "matches_read_participant",
    "messages_read_participant",
    "messages_insert_self",
    "locations_read_self",
    "locations_insert_self",
    "coaches_insert_self_unapproved",
  ]) {
    assert.match(
      advisorHardening,
      new RegExp(`create policy ${policy}[\\s\\S]*?\\(select auth\\.uid\\(\\)\\)`, "i")
    );
  }
  assert.match(
    advisorHardening,
    /grant select on public\.matches to authenticated/i
  );
  assert.doesNotMatch(
    advisorHardening,
    /grant (?:insert|update|delete)[^;]*public\.matches to authenticated/i
  );
  assert.match(
    advisorHardening,
    /create or replace function public\.enforce_location_write\(\)[\s\S]*set search_path = pg_catalog, public/i
  );
  assert.match(
    advisorHardening,
    /pg_advisory_xact_lock[\s\S]*Premium is required for saved locations[\s\S]*at most three saved locations/i
  );
  assert.doesNotMatch(
    advisorHardening,
    /create policy locations_insert_self[\s\S]*select count\(\*\)[\s\S]*from public\.user_locations/i
  );
});

test("advisor hardening adds indexes for known uncovered foreign-key lookups", () => {
  for (const index of [
    "photos_user_id_idx",
    "swipes_swiped_id_swiper_id_idx",
    "matches_user2_id_user1_id_idx",
    "messages_match_id_created_at_idx",
    "messages_sender_id_idx",
    "user_locations_user_id_idx",
    "coaches_owner_id_idx",
  ]) {
    assert.match(
      advisorHardening,
      new RegExp(`create index if not exists ${index}`, "i")
    );
  }
});
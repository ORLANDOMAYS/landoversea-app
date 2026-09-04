const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const storageHelpers = require("../lib/photo-storage.cjs");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("photo paths are owner scoped and traversal safe", () => {
  const objectPath = storageHelpers.createPhotoPath("user-123", "jpeg", "unique");
  assert.equal(objectPath, "user-123/unique.jpg");
  assert.equal(storageHelpers.isOwnerPhotoPath(objectPath, "user-123"), true);
  assert.equal(storageHelpers.isOwnerPhotoPath("other/unique.jpg", "user-123"), false);
  assert.equal(storageHelpers.isOwnerPhotoPath("user-123/../other.jpg", "user-123"), false);
});

test("object paths and legacy same-bucket URLs are freshly signed while external URLs remain compatible", async () => {
  const calls = [];
  const storage = {
    from(bucket) {
      assert.equal(bucket, "photos");
      return {
        async createSignedUrl(objectPath, expiresIn) {
          calls.push({ objectPath, expiresIn });
          return { data: { signedUrl: `https://signed.example/${objectPath}` }, error: null };
        },
      };
    },
  };
  assert.equal(
    await storageHelpers.resolvePhotoUrl(storage, "user-123/photo.jpg"),
    "https://signed.example/user-123/photo.jpg"
  );
  assert.equal(
    await storageHelpers.resolvePhotoUrl(storage, "https://legacy.example/photo.jpg"),
    "https://legacy.example/photo.jpg"
  );
  for (const access of ["public", "sign", "authenticated"]) {
    assert.equal(
      await storageHelpers.resolvePhotoUrl(
        storage,
        `https://project.supabase.co/storage/v1/object/${access}/photos/user-123/old%20photo.jpg?token=old`
      ),
      "https://signed.example/user-123/old photo.jpg"
    );
  }
  assert.deepEqual(calls, [
    { objectPath: "user-123/photo.jpg", expiresIn: 3600 },
    { objectPath: "user-123/old photo.jpg", expiresIn: 3600 },
    { objectPath: "user-123/old photo.jpg", expiresIn: 3600 },
    { objectPath: "user-123/old photo.jpg", expiresIn: 3600 },
  ]);
  assert.equal(
    storageHelpers.storagePathFromValue("https://x.supabase.co/storage/v1/object/public/photos/user-123/old.jpg"),
    "user-123/old.jpg"
  );
  await assert.rejects(
    storageHelpers.resolvePhotoUrl(
      storage,
      "https://project.supabase.co/storage/v1/object/public/photos/user-123/%2e%2e/private.jpg"
    ),
    /Invalid photo storage path/
  );
});

test("migration 006 normalizes safe legacy photo URLs and removes broad profile coordinates", () => {
  const migration = read("supabase/migrations/006_legacy_photo_and_coordinate_privacy.sql");
  assert.match(migration, /storage\/v1\/object\/\(public\|sign\|authenticated\)\/photos/i);
  assert.match(migration, /split_part\(legacy_paths\.object_path, '\/', 1\) = p\.user_id::text/i);
  assert.match(migration, /insert into public\.user_locations/i);
  assert.match(migration, /not exists[\s\S]*ul\.latitude is not distinct from p\.latitude/i);
  assert.match(migration, /drop column if exists latitude/i);
  assert.match(migration, /drop column if exists longitude/i);
  const profileType = read("apps/web/src/lib/types.ts").split("export interface UserLocation")[0];
  assert.doesNotMatch(profileType, /\b(?:latitude|longitude)\b/);
});

test("clients make no third-party translation request and describe original-language delivery", () => {
  const clientSource = [
    ...walk(path.join(root, "apps/web/src")),
    ...walk(path.join(root, "apps/mobile")),
  ].filter((file) => /\.(js|jsx|ts|tsx)$/.test(file))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  assert.doesNotMatch(clientSource, /api\.mymemory|translated\.net/i);
  assert.doesNotMatch(clientSource, /fetch\([^)]*translat/i);
  assert.match(read("apps/web/src/app/app/chat/page.tsx"), /Automatic translation is currently unavailable/);
  assert.match(read("apps/mobile/app/chat.js"), /Messages are sent in their original language/);
});

test("marketing does not claim unavailable translation or facial verification", () => {
  const marketing = [
    read("apps/web/src/app/page.tsx"),
    read("apps/web/src/app/app/settings/page.tsx"),
    read("apps/web/src/app/app/profile/page.tsx"),
    read("apps/mobile/app/index.js"),
  ].join("\n");
  assert.doesNotMatch(marketing, /facial (?:recognition|verification)|100%[\s\S]{0,80}profile verified|real-time AI translation|translated live|automatically translated/i);
});

test("web and mobile photo APIs store paths, sign reads, cap uploads, and remove objects", () => {
  for (const file of ["apps/web/src/lib/api.ts", "apps/mobile/lib/api.js"]) {
    const source = read(file);
    assert.match(source, /resolvePhotoRows/);
    assert.match(source, /PHOTO_LIMIT/);
    assert.match(source, /isOwnerPhotoPath/);
    assert.match(source, /\.remove\(\[path\]\)/);
    assert.match(source, /url:\s*path/);
    assert.doesNotMatch(source, /getPublicUrl/);
  }
});

test("client code cannot invoke privileged premium or verification RPCs", () => {
  const clientFiles = [
    ...walk(path.join(root, "apps/web/src")),
    ...walk(path.join(root, "apps/mobile")),
  ].filter((file) => /\.(js|jsx|ts|tsx)$/.test(file));
  for (const file of clientFiles) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\.rpc\(\s*["'](?:upgrade_to_premium|verify_profile)["']/);
  }
});

test("coach clients request approved records and surface loading, error, retry, and empty states", () => {
  const api = read("apps/mobile/lib/api.js");
  const list = read("apps/mobile/app/(tabs)/coaches.js");
  const detail = read("apps/mobile/app/coach-detail.js");
  assert.match(api, /\.eq\(["']approved["'], true\)/);
  assert.match(api, /if \(error\) throw error/);
  for (const source of [list, detail]) {
    assert.match(source, /loading/i);
    assert.match(source, /error/i);
    assert.match(source, /Retry/);
  }
  assert.match(list, /No coaches found/);
  assert.doesNotMatch(read("supabase/migrations/005_platform_security.sql"), /insert into public\.coaches/i);
});

test("release configuration uses remote auto-increment and no obsolete storage permission", () => {
  const eas = JSON.parse(read("apps/mobile/eas.json"));
  const expo = JSON.parse(read("apps/mobile/app.json")).expo;
  assert.equal(eas.cli.appVersionSource, "remote");
  assert.equal(eas.build.production.autoIncrement, true);
  assert.equal(expo.ios.buildNumber, undefined);
  assert.equal(expo.android.versionCode, undefined);
  assert.ok(!expo.android.permissions.includes("android.permission.READ_EXTERNAL_STORAGE"));
  assert.equal(expo.ios.bundleIdentifier, "com.landoversea.app");
  assert.equal(expo.android.package, "com.landoversea.app");
  assert.ok(expo.web.favicon);
});

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}
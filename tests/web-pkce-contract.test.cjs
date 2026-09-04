const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const supabaseClient = fs.readFileSync(
  path.join(root, "apps/web/src/lib/supabase.ts"),
  "utf8"
);
const callback = fs.readFileSync(
  path.join(root, "apps/web/src/app/auth/callback/page.tsx"),
  "utf8"
);

function readSourceTree(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return readSourceTree(filePath);
    return /\.(?:js|jsx|ts|tsx)$/.test(entry.name)
      ? [fs.readFileSync(filePath, "utf8")]
      : [];
  });
}

test("web Supabase client leaves PKCE URL consumption to the callback", () => {
  assert.match(supabaseClient, /detectSessionInUrl:\s*false/);
  assert.match(supabaseClient, /persistSession:\s*true/);
  assert.match(supabaseClient, /autoRefreshToken:\s*true/);

  const webSources = readSourceTree(path.join(root, "apps/web/src")).join("\n");
  assert.equal(
    (webSources.match(/exchangeCodeForSession\s*\(/g) ?? []).length,
    1
  );
  assert.equal(
    (callback.match(/exchangeCodeForSession\s*\(/g) ?? []).length,
    1
  );
});
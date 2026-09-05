const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("web app ships a valid multi-size favicon", () => {
  const favicon = fs.readFileSync(
    path.join(__dirname, "../apps/web/src/app/favicon.ico")
  );

  assert.ok(favicon.length > 100);
  assert.equal(favicon.readUInt16LE(0), 0);
  assert.equal(favicon.readUInt16LE(2), 1);
  assert.ok(favicon.readUInt16LE(4) >= 3);
});
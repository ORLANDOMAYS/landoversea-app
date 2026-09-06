const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("web app ships a valid multi-size favicon", () => {
  const favicon = fs.readFileSync(
    path.join(__dirname, "../apps/web/src/app/favicon.ico")
  );

  assert.equal(favicon.readUInt16LE(0), 0);
  assert.equal(favicon.readUInt16LE(2), 1);
  const imageCount = favicon.readUInt16LE(4);
  assert.equal(imageCount, 3);

  const directoryEnd = 6 + imageCount * 16;
  const entries = Array.from({ length: imageCount }, (_, index) => {
    const entryOffset = 6 + index * 16;
    return {
      width: favicon[entryOffset] || 256,
      height: favicon[entryOffset + 1] || 256,
      colorCount: favicon[entryOffset + 2],
      reserved: favicon[entryOffset + 3],
      planes: favicon.readUInt16LE(entryOffset + 4),
      bitCount: favicon.readUInt16LE(entryOffset + 6),
      byteLength: favicon.readUInt32LE(entryOffset + 8),
      imageOffset: favicon.readUInt32LE(entryOffset + 12),
    };
  });

  assert.deepEqual(
    entries.map(({ width, height }) => [width, height]),
    [
      [16, 16],
      [32, 32],
      [48, 48],
    ]
  );

  let previousEnd = directoryEnd;
  for (const entry of entries) {
    assert.equal(entry.colorCount, 0);
    assert.equal(entry.reserved, 0);
    assert.equal(entry.planes, 1);
    assert.equal(entry.bitCount, 32);
    assert.ok(entry.imageOffset >= previousEnd);
    assert.ok(entry.imageOffset + entry.byteLength <= favicon.length);

    const dibOffset = entry.imageOffset;
    assert.equal(favicon.readUInt32LE(dibOffset), 40);
    assert.equal(favicon.readInt32LE(dibOffset + 4), entry.width);
    assert.equal(favicon.readInt32LE(dibOffset + 8), entry.height * 2);
    assert.equal(favicon.readUInt16LE(dibOffset + 12), 1);
    assert.equal(favicon.readUInt16LE(dibOffset + 14), 32);
    assert.equal(favicon.readUInt32LE(dibOffset + 16), 0);

    const pixelBytes = entry.width * entry.height * 4;
    const maskRowBytes = Math.ceil(entry.width / 32) * 4;
    const maskBytes = maskRowBytes * entry.height;
    assert.equal(favicon.readUInt32LE(dibOffset + 20), pixelBytes);
    assert.equal(entry.byteLength, 40 + pixelBytes + maskBytes);

    const pixels = favicon.subarray(dibOffset + 40, dibOffset + 40 + pixelBytes);
    assert.equal(pixels.length, pixelBytes);
    assert.ok(
      Array.from({ length: entry.width * entry.height }, (_, pixel) => {
        return pixels[pixel * 4 + 3];
      }).some((alpha) => alpha > 0)
    );

    previousEnd = entry.imageOffset + entry.byteLength;
  }

  assert.equal(previousEnd, favicon.length);
});
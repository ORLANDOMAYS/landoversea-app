import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const generatedRoots = [
  new URL("../../api-client-react/src/generated/", import.meta.url),
  new URL("../../api-zod/src/generated/", import.meta.url),
];

async function normalizeDirectory(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);
    if (entry.isDirectory()) {
      await normalizeDirectory(entryUrl);
      return;
    }
    if (!entry.isFile() || extname(entry.name) !== ".ts") return;
    const source = await readFile(entryUrl, "utf8");
    const normalized = `${source.replace(/\s+$/u, "")}\n`;
    if (normalized !== source) {
      await writeFile(entryUrl, normalized, "utf8");
    }
  }));
}

await Promise.all(generatedRoots.map(normalizeDirectory));
import assert from "node:assert/strict";
import test from "node:test";
import {
  coachCredentialsTable,
  coachesTable,
  db,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  collectOwnedObjectPaths,
  deleteOwnedObjectWithRetry,
} from "../src/routes/auth";

test("coach credential paths are collected before account cascades", async () => {
  const [user] = await db.insert(usersTable).values({
    email: `credential-cleanup-${crypto.randomUUID()}@example.com`,
    passwordHash: "not-used",
    name: "Credential Cleanup",
    isTest: true,
  }).returning();
  const privatePath = `/objects/${crypto.randomUUID()}`;
  try {
    const [coach] = await db.insert(coachesTable).values({
      userId: user.id,
      displayName: "Cleanup Coach",
    }).returning();
    await db.insert(coachCredentialsTable).values({
      coachId: coach.id,
      kind: "id_document",
      objectPath: privatePath,
      originalName: "identity.pdf",
      contentType: "application/pdf",
      size: 1,
    });
    const paths = await collectOwnedObjectPaths(db, user.id);
    assert.equal(paths.has(privatePath), true);
  } finally {
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
  }
});

test("owned-object cleanup succeeds without unnecessary retries", async () => {
  const calls: string[] = [];
  await deleteOwnedObjectWithRetry({
    async deleteObjectEntityFile(path: string) {
      calls.push(path);
    },
  }, "/objects/private-credential");
  assert.equal(calls.length, 1);
});

test("owned-object cleanup retries transient failures", async () => {
  let attempts = 0;
  await deleteOwnedObjectWithRetry({
    async deleteObjectEntityFile() {
      attempts += 1;
      if (attempts < 3) throw new Error("storage unavailable");
    },
  }, "/objects/private-credential");
  assert.equal(attempts, 3);
});

test("owned-object cleanup reports permanent failure without adding the private path", async () => {
  let attempts = 0;
  const privatePath = "/objects/private-identity-document";
  await assert.rejects(
    deleteOwnedObjectWithRetry({
      async deleteObjectEntityFile() {
        attempts += 1;
        throw new Error("storage unavailable");
      },
    }, privatePath),
    (error: Error) => {
      assert.equal(error.message.includes(privatePath), false);
      return true;
    },
  );
  assert.equal(attempts, 3);
});
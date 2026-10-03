/**
 * Configured API regression coverage for strict profile updates, per-account
 * notification preferences, and profile photo ownership/order invariants.
 *
 * Requires a running API (override API_BASE_URL when it is not available at
 * the development proxy). Fixtures are inserted directly so the suite never
 * invokes email, push, object-storage, or other external providers.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  db,
  conversationsTable,
  conversationParticipantsTable,
  messagesTable,
  notificationPreferencesTable,
  profilePhotosTable,
  profilesTable,
  usersTable,
} from "@workspace/db";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

const BASE = process.env.API_BASE_URL || "http://localhost:80/api";
const PASSWORD = "strict-api-test-password";
const TINY_HEIC = Buffer.from(
  "AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAAWhtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAAImlsb2MAAAAAREAAAQABAAAAAAGMAAEAAAAAAAAALgAAACNpaW5mAAAAAAABAAAAFWluZmUCAAAAAAEAAGh2YzEAAAAA6GlwcnAAAADJaXBjbwAAAHVodmNDAQQIAAAAAAAAAAAAHvAA/P38/AAADwMgAAEAF0ABDAH//wQIAAADAJm4AAADAAAeugJAIQABACpCAQEECAAAAwCZuAAAAwAAHqAggQRSluqumubgIaDAgAAAAwCAAAADAIQiAAEABkQBwXPAiQAAABRpc3BlAAAAAAAAAEAAAABAAAAAKGNsYXAAAAAIAAAAAQAAAAgAAAAB////yAAAAAL////IAAAAAgAAABBwaXhpAAAAAAMMDAwAAAAXaXBtYQAAAAAAAAABAAEEgQIEgwAAADZtZGF0AAAAKigBrxOA5TlaUMqHlExK0xHYmxRAJ3Ar9THLoj1w5zre4y30oX/wIAAHJA==",
  "base64",
);

type Preferences = {
  pushEnabled: boolean;
  emailEnabled: boolean;
  bookingEnabled: boolean;
  showOnlineStatus: boolean;
  readReceipts: boolean;
};

async function waitForReady(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/readyz`);
      if (response.ok) return;
      lastError = new Error(`readiness returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`API did not become ready within ${timeoutMs}ms`, { cause: lastError });
}

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function expectStatus(response: Response, status: number): Promise<unknown> {
  const body = await responseBody(response);
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}

async function createAccount(tag: string): Promise<{ id: number; email: string }> {
  const email = `strict-api-${tag}-${randomUUID()}@example.com`;
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  return db.transaction(async (tx) => {
    const [user] = await tx.insert(usersTable).values({
      email,
      passwordHash,
      name: `Strict API ${tag}`,
      isTest: true,
    }).returning();
    await tx.insert(profilesTable).values({
      userId: user.id,
      name: user.name,
    });
    return { id: user.id, email };
  });
}

async function login(email: string): Promise<string> {
  const response = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  await expectStatus(response, 200);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "login must return an authentication cookie");
  return setCookie.split(";")[0];
}

function api(path: string, cookie: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
      Cookie: cookie,
    },
  });
}

function apiMultipart(path: string, cookie: string, form: FormData): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
}

function profilePngForm(mime = "image/png"): FormData {
  const form = new FormData();
  const bytes = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x00,
  ]);
  form.set("photo", new Blob([bytes], { type: mime }), "profile.png");
  return form;
}

function profileHeicForm(mime = "image/heic"): FormData {
  const form = new FormData();
  form.set("photo", new Blob([TINY_HEIC], { type: mime }), "iphone-photo.heic");
  return form;
}

function oversizedProfilePhotoForm(): FormData {
  const form = new FormData();
  form.set(
    "photo",
    new Blob([new Uint8Array(12 * 1024 * 1024 + 1)], { type: "image/jpeg" }),
    "too-large.jpg",
  );
  return form;
}

async function getOwnedPhotos(userId: number) {
  const photos = await db.select().from(profilePhotosTable)
    .where(eq(profilePhotosTable.userId, userId));
  return photos.sort((a, b) => a.position - b.position || a.id - b.id);
}

function assertPhotoInvariants(
  photos: Array<{ position: number; isPrimary: boolean }>,
): void {
  assert.deepEqual(photos.map((photo) => photo.position), photos.map((_, index) => index));
  assert.equal(
    photos.filter((photo) => photo.isPrimary).length,
    photos.length === 0 ? 0 : 1,
    "a non-empty photo list must have exactly one primary",
  );
}

test("strict profile, account settings, and photo mutation API regressions", async (t) => {
  await waitForReady();
  const accountIds: number[] = [];

  t.after(async () => {
    for (const userId of accountIds.reverse()) {
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
  });

  const owner = await createAccount("owner");
  accountIds.push(owner.id);
  const other = await createAccount("other");
  accountIds.push(other.id);
  const [ownerCookie, otherCookie] = await Promise.all([
    login(owner.email),
    login(other.email),
  ]);

  await t.test("PATCH /profiles/me strictly validates age and payload shape", async () => {
    const rejectedPayloads: Array<{ label: string; value: unknown }> = [
      { label: "unknown field", value: { nickname: "not allowed" } },
      { label: "empty object", value: {} },
      { label: "null body", value: null },
      { label: "wrong age type", value: { age: "24" } },
      { label: "fractional age", value: { age: 24.5 } },
      { label: "age below lower bound", value: { age: 17 } },
      { label: "age above upper bound", value: { age: 101 } },
    ];

    for (const payload of rejectedPayloads) {
      const response = await api("/profiles/me", ownerCookie, {
        method: "PATCH",
        body: JSON.stringify(payload.value),
      });
      await expectStatus(response, 400);
    }

    let [stored] = await db.select().from(profilesTable)
      .where(eq(profilesTable.userId, owner.id));
    assert.equal(stored.age, null, "rejected updates must not mutate age");

    const lower = await api("/profiles/me", ownerCookie, {
      method: "PATCH",
      body: JSON.stringify({ age: 18 }),
    });
    assert.equal((await expectStatus(lower, 200) as { age: number }).age, 18);

    const upper = await api("/profiles/me", ownerCookie, {
      method: "PATCH",
      body: JSON.stringify({ age: 100, bio: "A valid bounded update" }),
    });
    const upperBody = await expectStatus(upper, 200) as { age: number; bio: string };
    assert.equal(upperBody.age, 100);
    assert.equal(upperBody.bio, "A valid bounded update");

    [stored] = await db.select().from(profilesTable)
      .where(eq(profilesTable.userId, owner.id));
    assert.equal(stored.age, 100);
  });

  await t.test("notification preferences default, hydrate, update, and stay isolated", async () => {
    const defaults: Preferences = {
      pushEnabled: true,
      emailEnabled: true,
      bookingEnabled: true,
      showOnlineStatus: true,
      readReceipts: true,
    };
    const ownerDefault = await api("/notifications/preferences", ownerCookie);
    assert.deepEqual(await expectStatus(ownerDefault, 200), defaults);
    const otherDefault = await api("/notifications/preferences", otherCookie);
    assert.deepEqual(await expectStatus(otherDefault, 200), defaults);

    await db.insert(notificationPreferencesTable).values({
      userId: owner.id,
      pushEnabled: false,
      emailEnabled: true,
      showOnlineStatus: false,
      readReceipts: true,
    });
    const hydrated: Preferences = {
      pushEnabled: false,
      emailEnabled: true,
      bookingEnabled: true,
      showOnlineStatus: false,
      readReceipts: true,
    };
    const hydratedResponse = await api("/notifications/preferences", ownerCookie);
    assert.deepEqual(await expectStatus(hydratedResponse, 200), hydrated);

    const invalidPayloads: Array<{ label: string; value: unknown }> = [
      {
        label: "wrong type",
        value: { ...defaults, pushEnabled: "yes" },
      },
      {
        label: "partial",
        value: { pushEnabled: false },
      },
      {
        label: "unknown field",
        value: { ...defaults, marketingNotifications: false },
      },
    ];
    for (const payload of invalidPayloads) {
      const response = await api("/notifications/preferences", ownerCookie, {
        method: "PUT",
        body: JSON.stringify(payload.value),
      });
      await expectStatus(response, 400);
    }

    const afterInvalid = await api("/notifications/preferences", ownerCookie);
    assert.deepEqual(await expectStatus(afterInvalid, 200), hydrated);

    const updated: Preferences = {
      pushEnabled: true,
      emailEnabled: false,
      bookingEnabled: false,
      showOnlineStatus: true,
      readReceipts: false,
    };
    const updateResponse = await api("/notifications/preferences", ownerCookie, {
      method: "PUT",
      body: JSON.stringify(updated),
    });
    assert.deepEqual(await expectStatus(updateResponse, 200), updated);
    const persistedResponse = await api("/notifications/preferences", ownerCookie);
    assert.deepEqual(await expectStatus(persistedResponse, 200), updated);

    const isolatedResponse = await api("/notifications/preferences", otherCookie);
    assert.deepEqual(await expectStatus(isolatedResponse, 200), defaults);
    const otherRows = await db.select().from(notificationPreferencesTable)
      .where(eq(notificationPreferencesTable.userId, other.id));
    assert.equal(otherRows.length, 0, "reading another account's defaults must not create or copy settings");
  });

  await t.test("read-receipt privacy is enforced for the person who read the message", async () => {
    const [conversation] = await db.insert(conversationsTable).values({
      type: "direct",
      directKey: [owner.id, other.id].sort((a, b) => a - b).join(":"),
      ownerId: owner.id,
    }).returning();
    const readAt = new Date(Date.now() + 5_000);
    await db.insert(conversationParticipantsTable).values([
      { conversationId: conversation.id, userId: owner.id },
      { conversationId: conversation.id, userId: other.id, lastReadAt: readAt },
    ]);
    const [message] = await db.insert(messagesTable).values({
      conversationId: conversation.id,
      senderId: owner.id,
      content: "Read-receipt privacy regression",
      createdAt: new Date(),
    }).returning();

    const visibleResponse = await api(`/conversations/${conversation.id}/messages`, ownerCookie);
    const visibleMessages = await expectStatus(visibleResponse, 200) as Array<{ id: number; isRead: boolean }>;
    assert.equal(visibleMessages.find((item) => item.id === message.id)?.isRead, true);

    const hiddenPreferences: Preferences = {
      pushEnabled: true,
      emailEnabled: true,
      bookingEnabled: true,
      showOnlineStatus: true,
      readReceipts: false,
    };
    await expectStatus(await api("/notifications/preferences", otherCookie, {
      method: "PUT",
      body: JSON.stringify(hiddenPreferences),
    }), 200);

    const hiddenResponse = await api(`/conversations/${conversation.id}/messages`, ownerCookie);
    const hiddenMessages = await expectStatus(hiddenResponse, 200) as Array<{ id: number; isRead: boolean }>;
    assert.equal(hiddenMessages.find((item) => item.id === message.id)?.isRead, false);
  });

  await t.test("photo uploads validate bytes, require authentication to render, and stop at six", async () => {
    const uploadOwner = await createAccount("upload-owner");
    accountIds.push(uploadOwner.id);
    const uploadCookie = await login(uploadOwner.email);

    const invalidForm = new FormData();
    invalidForm.set("photo", new Blob(["not an image"], { type: "text/plain" }), "profile.txt");
    await expectStatus(await apiMultipart("/profiles/me/photos", uploadCookie, invalidForm), 400);
    await expectStatus(await apiMultipart(
      "/profiles/me/photos",
      uploadCookie,
      profilePngForm("image/jpeg"),
    ), 400);
    const tooLargeBody = await expectStatus(await apiMultipart(
      "/profiles/me/photos",
      uploadCookie,
      oversizedProfilePhotoForm(),
    ), 413) as { code: string; maxBytes: number };
    assert.equal(tooLargeBody.code, "image_too_large");
    assert.equal(tooLargeBody.maxBytes, 12 * 1024 * 1024);

    const uploadBody = await expectStatus(await apiMultipart(
      "/profiles/me/photos",
      uploadCookie,
      profilePngForm(),
    ), 201) as { id: number; url: string; isPrimary: boolean; position: number };
    assert.match(uploadBody.url, /^\/objects\/uploads\//);
    assert.equal(uploadBody.isPrimary, true);
    assert.equal(uploadBody.position, 0);

    const heicUploadBody = await expectStatus(await apiMultipart(
      "/profiles/me/photos",
      uploadCookie,
      // Older native builds mislabeled HEIC bytes as JPEG. The server safely
      // detects and converts the actual bytes rather than trusting the label.
      profileHeicForm("image/jpeg"),
    ), 201) as { id: number; url: string; isPrimary: boolean; position: number };
    assert.match(heicUploadBody.url, /^\/objects\/uploads\//);
    assert.equal(heicUploadBody.position, 1);

    const mediaPath = `/storage${uploadBody.url}`;
    const heicMediaPath = `/storage${heicUploadBody.url}`;
    const [ownerMedia, memberMedia, unauthenticatedMedia, convertedHeicMedia] = await Promise.all([
      api(mediaPath, uploadCookie),
      api(mediaPath, otherCookie),
      fetch(`${BASE}${mediaPath}`),
      api(heicMediaPath, uploadCookie),
    ]);
    assert.equal(ownerMedia.status, 200);
    assert.equal(ownerMedia.headers.get("content-type"), "image/png");
    assert.equal(ownerMedia.headers.get("cache-control"), "private, no-store");
    assert.equal(memberMedia.status, 200, "signed-in members may view profile photos");
    assert.equal(memberMedia.headers.get("cache-control"), "private, no-store");
    assert.equal(unauthenticatedMedia.status, 401, "profile photos must not be public outside the app");
    assert.equal(convertedHeicMedia.status, 200);
    assert.equal(convertedHeicMedia.headers.get("content-type"), "image/jpeg");
    assert.equal(convertedHeicMedia.headers.get("cache-control"), "private, no-store");

    await db.insert(profilePhotosTable).values(
      Array.from({ length: 4 }, (_, index) => ({
        userId: uploadOwner.id,
        url: `https://example.invalid/${randomUUID()}/cap-${index}.jpg`,
        position: index + 2,
      })),
    );
    await expectStatus(await apiMultipart(
      "/profiles/me/photos",
      uploadCookie,
      profilePngForm(),
    ), 409);
    const cappedPhotos = await getOwnedPhotos(uploadOwner.id);
    assert.equal(cappedPhotos.length, 6);
    assertPhotoInvariants(cappedPhotos);

    await expectStatus(await api(
      `/profiles/me/photos/${uploadBody.id}`,
      uploadCookie,
      { method: "DELETE" },
    ), 200);
  });

  await t.test("photo primary, reorder, and delete enforce ownership and invariants", async () => {
    const [first, second, third] = await db.insert(profilePhotosTable).values([
      {
        userId: owner.id,
        url: `https://example.invalid/${randomUUID()}/first.jpg`,
        position: 0,
        isPrimary: true,
      },
      {
        userId: owner.id,
        url: `https://example.invalid/${randomUUID()}/second.jpg`,
        position: 1,
      },
      {
        userId: owner.id,
        url: `https://example.invalid/${randomUUID()}/third.jpg`,
        position: 2,
      },
    ]).returning();
    const [foreign] = await db.insert(profilePhotosTable).values({
      userId: other.id,
      url: `https://example.invalid/${randomUUID()}/foreign.jpg`,
      position: 0,
      isPrimary: true,
    }).returning();

    await expectStatus(await api(
      `/profiles/me/photos/${foreign.id}/primary`,
      ownerCookie,
      { method: "PUT" },
    ), 404);
    await expectStatus(await api(
      `/profiles/me/photos/${foreign.id}`,
      ownerCookie,
      { method: "PATCH", body: JSON.stringify({ position: 0 }) },
    ), 404);
    await expectStatus(await api(
      `/profiles/me/photos/${foreign.id}`,
      ownerCookie,
      { method: "DELETE" },
    ), 404);
    const foreignAfter = await getOwnedPhotos(other.id);
    assert.equal(foreignAfter.length, 1);
    assert.equal(foreignAfter[0].id, foreign.id);
    assertPhotoInvariants(foreignAfter);

    const primaryResponse = await api(
      `/profiles/me/photos/${third.id}/primary`,
      ownerCookie,
      { method: "PUT" },
    );
    const primaryBody = await expectStatus(primaryResponse, 200) as { id: number; isPrimary: boolean };
    assert.equal(primaryBody.id, third.id);
    assert.equal(primaryBody.isPrimary, true);
    let photos = await getOwnedPhotos(owner.id);
    assertPhotoInvariants(photos);
    assert.deepEqual(photos.map((photo) => photo.id), [third.id, first.id, second.id]);
    assert.equal(photos.find((photo) => photo.isPrimary)?.id, third.id);

    const reorderResponse = await api(`/profiles/me/photos/${third.id}`, ownerCookie, {
      method: "PATCH",
      body: JSON.stringify({ position: 0 }),
    });
    await expectStatus(reorderResponse, 200);
    photos = await getOwnedPhotos(owner.id);
    assert.deepEqual(photos.map((photo) => photo.id), [third.id, first.id, second.id]);
    assertPhotoInvariants(photos);
    assert.equal(photos.find((photo) => photo.isPrimary)?.id, third.id);

    const deleteResponse = await api(`/profiles/me/photos/${third.id}`, ownerCookie, {
      method: "DELETE",
    });
    await expectStatus(deleteResponse, 200);
    photos = await getOwnedPhotos(owner.id);
    assert.deepEqual(photos.map((photo) => photo.id), [first.id, second.id]);
    assertPhotoInvariants(photos);
    assert.equal(photos[0].isPrimary, true, "deleting the primary promotes the first remaining photo");
  });
});
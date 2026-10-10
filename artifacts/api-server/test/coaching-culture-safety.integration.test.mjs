import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  db, usersTable, blocksTable, conversationsTable, coachesTable,
  bookingsTable, culturalEventsTable, eventRsvpsTable,
} from "@workspace/db";
import { eq, and, or } from "drizzle-orm";

const baseUrl = (process.env.TEST_BASE_URL ?? "http://127.0.0.1:8080").replace(
  /\/+$/,
  "",
);

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("x-forwarded-for", options.clientIp ?? "198.51.100.20");
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const rawBody = await response.text();
  const data = rawBody === "" ? null : JSON.parse(rawBody);
  const setCookie = response.headers.get("set-cookie");
  return { status: response.status, data, cookie: setCookie?.split(";", 1)[0] ?? null };
}

async function registerUser(role = "user") {
  const suffix = randomUUID();
  const email = `ccs-${role}-${suffix}@example.com`;
  const password = "TestPass123!";
  const res = await request("/api/auth/register", {
    method: "POST",
    body: {
      email,
      password,
      name: `CCS ${suffix.slice(0, 6)}`,
      acceptedAgeRequirement: true,
    },
  });
  assert.equal(res.status, 201, `register ${role}: ${JSON.stringify(res.data)}`);
  const me = await request("/api/auth/me", { cookie: res.cookie });
  assert.equal(me.status, 200);
  return { cookie: res.cookie, email, password, id: me.data?.user?.id ?? me.data?.id };
}

async function cleanup(user) {
  if (!user?.cookie) return;
  const result = await request("/api/auth/delete-account", {
    method: "DELETE",
    cookie: user.cookie,
    body: { confirmPassword: user.password },
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
}

test("resource routes reject malformed IDs before database lookup", async () => {
  const user = await registerUser("resource-id");
  const malformedIds = [
    "3f06a90c-b7bd-4bb2-93f8-43b322ca620d",
    "12abc",
    "12.9",
    "1e3",
    "0",
    "-1",
    "01",
    "9007199254740992",
  ];
  try {
    for (const id of malformedIds) {
      const booking = await request(`/api/bookings/${id}`, { cookie: user.cookie });
      assert.equal(booking.status, 400, `booking id ${id}: ${JSON.stringify(booking.data)}`);

      const event = await request(`/api/cultural/events/${id}/rsvp`, {
        method: "POST",
        cookie: user.cookie,
      });
      assert.equal(event.status, 400, `event id ${id}: ${JSON.stringify(event.data)}`);
    }
  } finally {
    await cleanup(user);
  }
});

test("booking cancellation rules are identical across cancel and status routes", async () => {
  const coachOwner = await registerUser("cancellation-coach");
  const client = await registerUser("cancellation-client");
  const stranger = await registerUser("cancellation-stranger");

  try {
    const createdCoach = await request("/api/coaches/me", {
      method: "POST",
      cookie: coachOwner.cookie,
      body: {
        displayName: "Cancellation Coach",
        availability: {
          timeZone: "UTC",
          slots: [{ dayOfWeek: 1, startTime: "09:00", endTime: "10:00" }],
        },
      },
    });
    assert.equal(createdCoach.status, 201, JSON.stringify(createdCoach.data));

    const insertBooking = async (status, scheduledAt) => {
      const [booking] = await db.insert(bookingsTable).values({
        coachId: createdCoach.data.id,
        clientId: client.id,
        status,
        scheduledAt,
        durationMinutes: 60,
      }).returning();
      return booking;
    };
    const pastForCancel = await insertBooking("pending", new Date(Date.now() - 60_000));
    const pastForStatus = await insertBooking("confirmed", new Date(Date.now() - 60_000));
    const completedForCancel = await insertBooking("completed", new Date(Date.now() + 3_600_000));
    const completedForStatus = await insertBooking("completed", new Date(Date.now() + 3_600_000));
    const futureForCancel = await insertBooking("pending", new Date(Date.now() + 3_600_000));
    const futureForStatus = await insertBooking("confirmed", new Date(Date.now() + 3_600_000));
    const unauthorizedForCancel = await insertBooking("pending", new Date(Date.now() + 3_600_000));
    const unauthorizedForStatus = await insertBooking("pending", new Date(Date.now() + 3_600_000));
    const invalidForCancel = await insertBooking("no_show", new Date(Date.now() + 3_600_000));

    const cancel = (bookingId, cookie) => request(`/api/bookings/${bookingId}/cancel`, {
      method: "PATCH",
      cookie,
    });
    const setStatus = (bookingId, cookie, status) => request(`/api/bookings/${bookingId}/status`, {
      method: "PATCH",
      cookie,
      body: { status },
    });

    const pastCancel = await cancel(pastForCancel.id, client.cookie);
    assert.equal(pastCancel.status, 409);
    assert.match(pastCancel.data.error, /after its start time/);
    const pastStatus = await setStatus(pastForStatus.id, coachOwner.cookie, "cancelled");
    assert.equal(pastStatus.status, 409);
    assert.match(pastStatus.data.error, /after its start time/);

    const completedCancel = await cancel(completedForCancel.id, client.cookie);
    assert.equal(completedCancel.status, 409);
    const completedStatus = await setStatus(completedForStatus.id, coachOwner.cookie, "cancelled");
    assert.equal(completedStatus.status, 409);

    assert.equal((await cancel(unauthorizedForCancel.id, stranger.cookie)).status, 404);
    assert.equal(
      (await setStatus(unauthorizedForStatus.id, client.cookie, "cancelled")).status,
      403,
    );

    const futureCancel = await cancel(futureForCancel.id, client.cookie);
    assert.equal(futureCancel.status, 200, JSON.stringify(futureCancel.data));
    assert.equal(futureCancel.data.status, "cancelled");
    assert.equal((await cancel(futureForCancel.id, client.cookie)).status, 409);

    const futureStatus = await setStatus(futureForStatus.id, coachOwner.cookie, "cancelled");
    assert.equal(futureStatus.status, 200, JSON.stringify(futureStatus.data));
    assert.equal(futureStatus.data.status, "cancelled");
    assert.equal(
      (await setStatus(futureForStatus.id, coachOwner.cookie, "cancelled")).status,
      409,
    );
    assert.equal((await cancel(invalidForCancel.id, client.cookie)).status, 409);
    assert.equal(
      (await setStatus(futureForStatus.id, coachOwner.cookie, "confirmed")).status,
      409,
    );
  } finally {
    await cleanup(stranger);
    await cleanup(client);
    await cleanup(coachOwner);
  }
});

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function uploadCredentialObject(cookie, bytes, name) {
  const requested = await request("/api/storage/uploads/request-url", {
    method: "POST",
    cookie,
    body: {
      name,
      size: bytes.length,
      contentType: "image/png",
      purpose: "coach_credential",
    },
  });
  if (requested.status !== 200) return { unavailable: requested };
  const uploaded = await fetch(requested.data.uploadURL, {
    method: "PUT",
    headers: { "content-type": "image/png" },
    body: bytes,
  });
  assert.ok(uploaded.ok, `object upload failed: ${uploaded.status}`);
  return requested.data;
}

test("reviews are rejected unless the booking is completed", async () => {
  const client = await registerUser("user");
  // A pending/non-existent booking cannot be reviewed with an out-of-range rating.
  const bad = await request("/api/bookings/999999/review", {
    method: "POST",
    cookie: client.cookie,
    body: { rating: 7 },
  });
  assert.equal(bad.status, 400, "rating 7 must be rejected as out of bounds");

  const notFound = await request("/api/bookings/999999/review", {
    method: "POST",
    cookie: client.cookie,
    body: { rating: 5 },
  });
  assert.ok([404, 409].includes(notFound.status), "review on missing booking is blocked");
});

test("credential finalization validates real bytes and enforces owner/admin access", async (t) => {
  const owner = await registerUser("credential-owner");
  const attacker = await registerUser("credential-attacker");
  const coach = await request("/api/coaches/me", {
    method: "POST",
    cookie: owner.cookie,
    body: {
      displayName: "Credential Coach",
      availability: {
        timeZone: "UTC",
        slots: [{ dayOfWeek: 1, startTime: "09:00", endTime: "10:00" }],
      },
    },
  });
  assert.equal(coach.status, 201, JSON.stringify(coach.data));

  const fakeBytes = Buffer.from("not a png despite its declared content type");
  const fakeUpload = await uploadCredentialObject(owner.cookie, fakeBytes, "fake.png");
  if (fakeUpload.unavailable) {
    t.skip(`object storage unavailable (${fakeUpload.unavailable.status})`);
    return;
  }
  const rejected = await request("/api/coaches/me/credentials", {
    method: "POST",
    cookie: owner.cookie,
    body: {
      ...fakeUpload,
      kind: "certification",
      originalName: "fake.png",
      contentType: "image/png",
      size: fakeBytes.length,
    },
  });
  assert.equal(rejected.status, 400);
  assert.match(rejected.data?.error ?? "", /file type is invalid/);

  const validUpload = await uploadCredentialObject(owner.cookie, VALID_PNG, "real.png");
  assert.equal(validUpload.unavailable, undefined);
  const finalized = await request("/api/coaches/me/credentials", {
    method: "POST",
    cookie: owner.cookie,
    body: {
      ...validUpload,
      kind: "certification",
      originalName: "real.png",
      contentType: "image/png",
      size: VALID_PNG.length,
    },
  });
  assert.equal(finalized.status, 201, JSON.stringify(finalized.data));
  assert.equal(finalized.data.objectPath, undefined, "private object path is not exposed");

  const ownerRead = await fetch(`${baseUrl}/api/storage${validUpload.objectPath}`, {
    headers: { cookie: owner.cookie, "x-forwarded-for": "198.51.100.20" },
  });
  assert.equal(ownerRead.status, 200);
  const attackerRead = await fetch(`${baseUrl}/api/storage${validUpload.objectPath}`, {
    headers: { cookie: attacker.cookie, "x-forwarded-for": "198.51.100.20" },
  });
  assert.equal(attackerRead.status, 403);

  const ownerAdminList = await request(`/api/admin/coaches/${coach.data.id}/credentials`, {
    cookie: owner.cookie,
  });
  assert.equal(ownerAdminList.status, 403, "coach owner is not implicitly an admin");

  const admin = await registerUser("credential-admin");
  await db.update(usersTable).set({ role: "admin" }).where(eq(usersTable.id, admin.id));
  const adminLogin = await request("/api/auth/login", {
    method: "POST",
    body: { email: admin.email, password: admin.password },
  });
  assert.equal(adminLogin.status, 200);

  const adminList = await request(`/api/admin/coaches/${coach.data.id}/credentials`, {
    cookie: adminLogin.cookie,
  });
  assert.equal(adminList.status, 200, JSON.stringify(adminList.data));
  const listed = adminList.data.find((credential) => credential.id === finalized.data.id);
  assert.ok(listed, "authorized admin can list the finalized credential");
  assert.match(listed.documentUrl, /\/document$/);

  const adminDocument = await fetch(`${baseUrl}${listed.documentUrl}`, {
    headers: { cookie: adminLogin.cookie, "x-forwarded-for": "198.51.100.20" },
  });
  assert.equal(adminDocument.status, 200);
  assert.match(adminDocument.headers.get("content-type") ?? "", /^image\/png/);
  assert.deepEqual(Buffer.from(await adminDocument.arrayBuffer()), VALID_PNG);
});

test("symmetric block records both directions and unblock clears the auto side", async () => {
  const a = await registerUser("user");
  const b = await registerUser("user");
  try {
    const me = await request("/api/auth/me", { cookie: b.cookie });
    const bId = me.data?.id;
    assert.ok(bId, "resolved user id");

    const blockRes = await request("/api/safety/block", {
      method: "POST",
      cookie: a.cookie,
      body: { blockedUserId: bId, reason: "test" },
    });
    assert.equal(blockRes.status, 200);

    const blocks = await request("/api/safety/blocks", { cookie: a.cookie });
    assert.ok(
      blocks.data.some((x) => x.blockedUserId === bId),
      "blocker sees the block",
    );

    // Simulate the publish-time default applied to an old automatic row that
    // predates the isExplicit column.
    await db
      .update(blocksTable)
      .set({ isExplicit: true })
      .where(and(eq(blocksTable.blockerId, bId), eq(blocksTable.blockedId, a.id)));

    const unblock = await request(`/api/safety/block/${bId}`, {
      method: "DELETE",
      cookie: a.cookie,
    });
    assert.equal(unblock.status, 200);

    const pairRows = await db
      .select()
      .from(blocksTable)
      .where(
        or(
          and(eq(blocksTable.blockerId, a.id), eq(blocksTable.blockedId, bId)),
          and(eq(blocksTable.blockerId, bId), eq(blocksTable.blockedId, a.id)),
        ),
      );
    assert.equal(pairRows.length, 0, "legacy automatic reverse row is removed");
  } finally {
    await cleanup(a);
    await cleanup(b);
  }
});

test("blocking validates targets, preserves explicit reverse blocks, and keeps groups", async () => {
  const a = await registerUser("block-a");
  const b = await registerUser("block-b");
  try {
    const group = await request("/api/conversations/group", {
      method: "POST", cookie: a.cookie,
      body: { title: "Shared group survives", participantIds: [b.id] },
    });
    assert.equal(group.status, 201);
    assert.equal((await request("/api/safety/block", {
      method: "POST", cookie: a.cookie, body: { blockedUserId: a.id },
    })).status, 400);
    assert.equal((await request("/api/safety/block", {
      method: "POST", cookie: a.cookie, body: { blockedUserId: 2147483647 },
    })).status, 404);

    assert.equal((await request("/api/safety/block", {
      method: "POST", cookie: a.cookie, body: { blockedUserId: b.id, reason: "a-explicit" },
    })).status, 200);
    assert.equal((await request("/api/discover/swipe", {
      method: "POST", cookie: a.cookie, body: { targetUserId: b.id, action: "like" },
    })).status, 403);
    assert.equal((await request("/api/discover/swipe", {
      method: "POST", cookie: b.cookie, body: { targetUserId: a.id, action: "like" },
    })).status, 403);
    assert.equal((await request("/api/safety/block", {
      method: "POST", cookie: b.cookie, body: { blockedUserId: a.id, reason: "b-explicit" },
    })).status, 200);
    assert.equal((await request(`/api/safety/block/${b.id}`, {
      method: "DELETE", cookie: a.cookie,
    })).status, 200);

    const [reverse] = await db.select().from(blocksTable).where(and(
      eq(blocksTable.blockerId, b.id),
      eq(blocksTable.blockedId, a.id),
    )).limit(1);
    assert.equal(reverse?.isExplicit, true, "the other user's explicit block remains");
    const [survivingGroup] = await db.select().from(conversationsTable)
      .where(eq(conversationsTable.id, group.data.id)).limit(1);
    assert.equal(survivingGroup?.type, "group", "blocking never deletes shared group conversations");
  } finally {
    await cleanup(a);
    await cleanup(b);
  }
});

test("unpaid coaching subscription requests never become active", async () => {
  const coachOwner = await registerUser("subscription-coach");
  const client = await registerUser("subscription-client");
  try {
    const created = await request("/api/coaches/me", {
      method: "POST", cookie: coachOwner.cookie,
      body: {
        displayName: "Subscription Coach",
        availability: {
          timeZone: "UTC",
          slots: [{ dayOfWeek: 1, startTime: "09:00", endTime: "10:00" }],
        },
      },
    });
    assert.equal(created.status, 201);
    await db.update(coachesTable).set({
      isVerified: true,
      verificationStatus: "approved",
    }).where(eq(coachesTable.id, created.data.id));

    const [first, second] = await Promise.all([
      request("/api/coaching/subscriptions", {
        method: "POST", cookie: client.cookie, body: { coachId: created.data.id },
      }),
      request("/api/coaching/subscriptions", {
        method: "POST", cookie: client.cookie, body: { coachId: created.data.id },
      }),
    ]);
    assert.equal(first.status, 503);
    assert.equal(second.status, 503);
    const subscriptions = await request("/api/coaching/subscriptions", { cookie: client.cookie });
    assert.equal(
      subscriptions.data.filter((subscription) => subscription.status === "active").length,
      0,
    );
  } finally {
    await cleanup(coachOwner);
    await cleanup(client);
  }
});

test("duplicate reports from the same reporter are deduplicated", async () => {
  const reporter = await registerUser("user");
  const target = await registerUser("user");
  const me = await request("/api/auth/me", { cookie: target.cookie });
  const targetId = me.data?.id;

  const first = await request("/api/safety/report", {
    method: "POST",
    cookie: reporter.cookie,
    body: { reportedUserId: targetId, reason: "spam" },
  });
  assert.equal(first.status, 201);

  const second = await request("/api/safety/report", {
    method: "POST",
    cookie: reporter.cookie,
    body: { reportedUserId: targetId, reason: "spam" },
  });
  assert.equal(second.status, 200, "second identical open report is collapsed");
  assert.equal(second.data.deduplicated, true);
});

test("cultural leaderboard is persisted and includes the viewer", async () => {
  const user = await registerUser("user");
  const res = await request("/api/cultural/leaderboard", { cookie: user.cookie });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.data), "leaderboard is an array");
  assert.ok(
    res.data.some((e) => e.isCurrentUser === true),
    "viewer appears in the persisted leaderboard",
  );
});

test("event RSVP can be cancelled idempotently and remains cancelled after refresh", async () => {
  const user = await registerUser("event-rsvp");
  const [event] = await db.insert(culturalEventsTable).values({
    title: `RSVP cancellation ${randomUUID()}`,
    description: "Integration test event",
    country: "Testland",
    date: new Date(Date.now() + 24 * 60 * 60 * 1000),
  }).returning();

  try {
    const unauthenticated = await request(`/api/cultural/events/${event.id}/rsvp`, { method: "DELETE" });
    assert.equal(unauthenticated.status, 401);

    const missing = await request("/api/cultural/events/2147483647/rsvp", {
      method: "DELETE",
      cookie: user.cookie,
    });
    assert.equal(missing.status, 404);

    const rsvp = await request(`/api/cultural/events/${event.id}/rsvp`, {
      method: "POST",
      cookie: user.cookie,
    });
    assert.equal(rsvp.status, 200, JSON.stringify(rsvp.data));
    assert.equal(rsvp.data.isRsvped, true);

    const cancelled = await request(`/api/cultural/events/${event.id}/rsvp`, {
      method: "DELETE",
      cookie: user.cookie,
    });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
    assert.equal(cancelled.data.isRsvped, false);

    const repeated = await request(`/api/cultural/events/${event.id}/rsvp`, {
      method: "DELETE",
      cookie: user.cookie,
    });
    assert.equal(repeated.status, 200, "repeated cancellation must be idempotent");

    const refreshed = await request("/api/cultural/events", { cookie: user.cookie });
    const refreshedEvent = refreshed.data.find(candidate => candidate.id === event.id);
    assert.equal(refreshedEvent?.isRsvped, false);
  } finally {
    await db.delete(eventRsvpsTable).where(eq(eventRsvpsTable.eventId, event.id));
    await db.delete(culturalEventsTable).where(eq(culturalEventsTable.id, event.id));
  }
});

test("culture-fact submissions enter the moderation queue as pending", async () => {
  const user = await registerUser("user");
  const res = await request("/api/cultural/facts", {
    method: "POST",
    cookie: user.cookie,
    body: {
      country: "Testland",
      fact: `A unique community-submitted fact ${randomUUID()}.`,
      category: "customs",
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.status, "pending");
});

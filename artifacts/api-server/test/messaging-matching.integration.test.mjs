import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const baseUrl = (process.env.TEST_BASE_URL ?? "http://127.0.0.1:8080").replace(
  /\/+$/,
  "",
);

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("x-forwarded-for", options.clientIp ?? "198.51.100.77");
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const rawBody = await response.text();
  let data = null;
  if (rawBody !== "") {
    try {
      data = JSON.parse(rawBody);
    } catch {
      data = rawBody;
    }
  }
  const setCookie = response.headers.get("set-cookie");
  return { status: response.status, data, cookie: setCookie?.split(";", 1)[0] ?? null };
}

async function registerUser(label) {
  const suffix = randomUUID();
  const email = `${label}-${suffix}@example.com`;
  const password = "MatchingPass123!";
  const name = `${label} ${suffix.slice(0, 6)}`;
  const res = await request("/api/auth/register", {
    method: "POST",
    body: { name, email, password, acceptedAgeRequirement: true },
  });
  assert.equal(res.status, 201, `register ${label}: ${JSON.stringify(res.data)}`);
  const cookie = res.cookie;
  const me = await request("/api/auth/me", { cookie });
  return { email, password, cookie, id: me.data?.user?.id ?? me.data?.id };
}

async function cleanup(user) {
  if (!user?.cookie) return;
  await request("/api/auth/delete-account", {
    method: "DELETE",
    cookie: user.cookie,
    body: { confirmPassword: user.password },
  });
}

test("swipe, mutual match, and direct conversation invariants", async () => {
  const alice = await registerUser("alice");
  const bob = await registerUser("bob");
  try {
    // No self swipe.
    const self = await request("/api/discover/swipe", {
      method: "POST",
      cookie: alice.cookie,
      body: { targetUserId: alice.id, action: "like" },
    });
    assert.equal(self.status, 400);

    // Alice likes Bob — no match yet.
    const a1 = await request("/api/discover/swipe", {
      method: "POST",
      cookie: alice.cookie,
      body: { targetUserId: bob.id, action: "like", idempotencyKey: `a-${alice.id}-${bob.id}` },
    });
    assert.equal(a1.status, 200);
    assert.equal(a1.data.isMatch, false);

    // Idempotent replay returns same action, still no match.
    const a1replay = await request("/api/discover/swipe", {
      method: "POST",
      cookie: alice.cookie,
      body: { targetUserId: bob.id, action: "like", idempotencyKey: `a-${alice.id}-${bob.id}` },
    });
    assert.equal(a1replay.status, 200);
    assert.equal(a1replay.data.action, "like");

    // No downgrade: a duplicate pair swipe with a different action keeps the original.
    const downgrade = await request("/api/discover/swipe", {
      method: "POST",
      cookie: alice.cookie,
      body: { targetUserId: bob.id, action: "pass" },
    });
    assert.equal(downgrade.status, 200);
    assert.equal(downgrade.data.action, "like");

    // Bob likes Alice — mutual match with exactly one conversation.
    const b1 = await request("/api/discover/swipe", {
      method: "POST",
      cookie: bob.cookie,
      body: { targetUserId: alice.id, action: "like" },
    });
    assert.equal(b1.status, 200);
    assert.equal(b1.data.isMatch, true);
    assert.ok(b1.data.conversationId, "match should yield a conversation");
    const convId = b1.data.conversationId;

    // Both users see the same single conversation.
    const aliceConvs = await request("/api/conversations", { cookie: alice.cookie });
    const bobConvs = await request("/api/conversations", { cookie: bob.cookie });
    const aliceDirect = aliceConvs.data.filter((c) => c.type === "direct" && c.participants.some((p) => p.userId === bob.id));
    const bobDirect = bobConvs.data.filter((c) => c.type === "direct" && c.participants.some((p) => p.userId === alice.id));
    assert.equal(aliceDirect.length, 1, "exactly one direct conversation for the pair");
    assert.equal(bobDirect.length, 1);
    assert.equal(aliceDirect[0].id, convId);
    assert.equal(bobDirect[0].id, convId);

    // Participant authorization: a third user cannot read messages.
    const carol = await registerUser("carol");
    try {
      const forbidden = await request(`/api/conversations/${convId}/messages`, { cookie: carol.cookie });
      assert.equal(forbidden.status, 403);
    } finally {
      await cleanup(carol);
    }

    // Send + read-state seen status.
    const sent = await request(`/api/conversations/${convId}/messages`, {
      method: "POST",
      cookie: alice.cookie,
      body: { content: "Hola!", contentType: "text", idempotencyKey: `msg-${randomUUID()}` },
    });
    assert.equal(sent.status, 201);
    assert.equal(sent.data.isRead, false, "just-sent message is not read yet");
    let bobMessageNotification = null;
    for (let attempt = 0; attempt < 30 && !bobMessageNotification; attempt += 1) {
      const notifications = await request("/api/notifications", { cookie: bob.cookie });
      bobMessageNotification = notifications.data.find(
        (notification) => notification.type === "message"
          && notification.relatedType === "conversation"
          && notification.relatedId === convId
          && notification.body === "Hola!",
      );
      if (!bobMessageNotification) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(bobMessageNotification, "message send enqueues a recipient notification after acknowledgment");

    // Idempotent message: sending same key returns same row.
    const dupKey = `dup-${randomUUID()}`;
    const m1 = await request(`/api/conversations/${convId}/messages`, {
      method: "POST", cookie: alice.cookie, body: { content: "dup", idempotencyKey: dupKey },
    });
    const m2 = await request(`/api/conversations/${convId}/messages`, {
      method: "POST", cookie: alice.cookie, body: { content: "dup", idempotencyKey: dupKey },
    });
    assert.equal(m1.data.id, m2.data.id, "idempotency key dedups messages");

    // Bob reads → Alice's message becomes seen.
    await request(`/api/conversations/${convId}/read`, { method: "POST", cookie: bob.cookie });
    const afterRead = await request(`/api/conversations/${convId}/messages`, { cookie: alice.cookie });
    const helloMsg = afterRead.data.find((m) => m.content === "Hola!");
    assert.ok(helloMsg);
    assert.equal(helloMsg.isRead, true, "message seen after other participant reads");

    // Attachment path validation: reject non-storage URLs.
    const badAttach = await request(`/api/conversations/${convId}/messages`, {
      method: "POST", cookie: alice.cookie, body: { attachmentUrl: "https://evil.example.com/x.png" },
    });
    assert.equal(badAttach.status, 400);

    // Unmatch tears down the conversation.
    const matches = await request("/api/matches", { cookie: alice.cookie });
    const match = matches.data.find((m) => m.conversationId === convId);
    assert.ok(match);
    const del = await request(`/api/matches/${match.id}`, { method: "DELETE", cookie: alice.cookie });
    assert.equal(del.status, 200);
    const gone = await request(`/api/conversations/${convId}`, { cookie: alice.cookie });
    assert.equal(gone.status, 404, "conversation removed after unmatch");
  } finally {
    await cleanup(alice);
    await cleanup(bob);
  }
});

test("swipe idempotency is user/target/action scoped and mutual races converge", async () => {
  const alice = await registerUser("scope-alice");
  const bob = await registerUser("scope-bob");
  const carol = await registerUser("scope-carol");
  const sharedKey = `shared-${randomUUID()}`;
  try {
    const aliceLike = await request("/api/discover/swipe", {
      method: "POST", cookie: alice.cookie,
      body: { targetUserId: bob.id, action: "like", idempotencyKey: sharedKey },
    });
    assert.equal(aliceLike.status, 200);

    const carolPass = await request("/api/discover/swipe", {
      method: "POST", cookie: carol.cookie,
      body: { targetUserId: bob.id, action: "pass", idempotencyKey: sharedKey },
    });
    assert.equal(carolPass.status, 200);
    assert.equal(carolPass.data.action, "pass", "another user's idempotency result is never disclosed");

    const unknown = await request("/api/discover/swipe", {
      method: "POST", cookie: alice.cookie,
      body: { targetUserId: 2147483647, action: "like" },
    });
    assert.equal(unknown.status, 404);

    const dave = await registerUser("race-dave");
    const erin = await registerUser("race-erin");
    try {
      const [left, right] = await Promise.all([
        request("/api/discover/swipe", {
          method: "POST", cookie: dave.cookie,
          body: { targetUserId: erin.id, action: "like" },
        }),
        request("/api/discover/swipe", {
          method: "POST", cookie: erin.cookie,
          body: { targetUserId: dave.id, action: "like" },
        }),
      ]);
      assert.equal(left.status, 200);
      assert.equal(right.status, 200);
      assert.ok(left.data.isMatch || right.data.isMatch, "concurrent mutual likes create a match");
      const conversations = await request("/api/conversations", { cookie: dave.cookie });
      const directs = conversations.data.filter(
        (conversation) => conversation.type === "direct"
          && conversation.participants.some((participant) => participant.userId === erin.id),
      );
      assert.equal(directs.length, 1, "race creates exactly one direct conversation");
    } finally {
      await cleanup(dave);
      await cleanup(erin);
    }
  } finally {
    await cleanup(alice);
    await cleanup(bob);
    await cleanup(carol);
  }
});

test("concurrent reactions preserve updates from different participants", async () => {
  const alice = await registerUser("react-alice");
  const bob = await registerUser("react-bob");
  try {
    const conversation = await request("/api/conversations/group", {
      method: "POST", cookie: alice.cookie,
      body: { title: "Reaction race", participantIds: [bob.id] },
    });
    assert.equal(conversation.status, 201);
    const sent = await request(`/api/conversations/${conversation.data.id}/messages`, {
      method: "POST", cookie: alice.cookie,
      body: { content: "React concurrently", idempotencyKey: `reaction-${randomUUID()}` },
    });
    assert.equal(sent.status, 201);

    const [first, second] = await Promise.all([
      request(`/api/conversations/${conversation.data.id}/messages/${sent.data.id}/react`, {
        method: "POST", cookie: alice.cookie, body: { emoji: "👍" },
      }),
      request(`/api/conversations/${conversation.data.id}/messages/${sent.data.id}/react`, {
        method: "POST", cookie: bob.cookie, body: { emoji: "❤️" },
      }),
    ]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const messages = await request(`/api/conversations/${conversation.data.id}/messages`, {
      cookie: alice.cookie,
    });
    const updated = messages.data.find((message) => message.id === sent.data.id);
    assert.deepEqual(
      new Set(updated.reactions.map((reaction) => reaction.userId)),
      new Set([alice.id, bob.id]),
    );
  } finally {
    await cleanup(alice);
    await cleanup(bob);
  }
});

test("read-state method, ISO pagination, and attachment registration", async () => {
  const alice = await registerUser("pag-alice");
  const bob = await registerUser("pag-bob");
  try {
    // Establish a matched direct conversation.
    await request("/api/discover/swipe", {
      method: "POST", cookie: alice.cookie,
      body: { targetUserId: bob.id, action: "like" },
    });
    const b1 = await request("/api/discover/swipe", {
      method: "POST", cookie: bob.cookie,
      body: { targetUserId: alice.id, action: "like" },
    });
    assert.equal(b1.data.isMatch, true);
    const convId = b1.data.conversationId;

    // ── Read-state endpoint is POST-only ─────────────────────────────────────
    const readPatch = await request(`/api/conversations/${convId}/read`, {
      method: "PATCH", cookie: bob.cookie,
    });
    assert.ok(readPatch.status === 404 || readPatch.status === 405,
      `PATCH /read must not be a valid method, got ${readPatch.status}`);
    const readPost = await request(`/api/conversations/${convId}/read`, {
      method: "POST", cookie: bob.cookie,
    });
    assert.equal(readPost.status, 200, "POST /read marks the conversation read");

    // ── Seed enough messages to paginate ─────────────────────────────────────
    const total = 8;
    for (let i = 0; i < total; i++) {
      const r = await request(`/api/conversations/${convId}/messages`, {
        method: "POST", cookie: alice.cookie,
        body: { content: `m-${i}`, contentType: "text", idempotencyKey: `pag-${randomUUID()}` },
      });
      assert.equal(r.status, 201);
    }

    // First page: newest `limit` messages, ascending in the response.
    const page1 = await request(`/api/conversations/${convId}/messages?limit=5`, { cookie: alice.cookie });
    assert.equal(page1.status, 200);
    assert.equal(page1.data.length, 5, "first page respects limit");
    // Response is ascending by createdAt.
    for (let i = 1; i < page1.data.length; i++) {
      assert.ok(new Date(page1.data[i].createdAt) >= new Date(page1.data[i - 1].createdAt),
        "messages returned oldest→newest");
    }

    // ── ISO cursor: older page must NOT overlap the first page ────────────────
    const oldestOnPage1 = page1.data[0];
    const cursorIso = new Date(oldestOnPage1.createdAt).toISOString();
    const compositeCursor = `${cursorIso}|${oldestOnPage1.id}`;
    const page2 = await request(
      `/api/conversations/${convId}/messages?limit=5&before=${encodeURIComponent(compositeCursor)}`,
      { cookie: alice.cookie },
    );
    assert.equal(page2.status, 200);
    assert.ok(page2.data.length > 0, "older page returns remaining messages");
    const page1Ids = new Set(page1.data.map((m) => m.id));
    for (const m of page2.data) {
      assert.ok(!page1Ids.has(m.id), "older page never overlaps the loaded window");
      assert.ok(new Date(m.createdAt) < new Date(cursorIso), "every older message is strictly before the cursor");
    }

    // Malformed (non-ISO) cursor is rejected rather than silently mis-paginating.
    const badCursor = await request(
      `/api/conversations/${convId}/messages?before=not-a-date`,
      { cookie: alice.cookie },
    );
    assert.equal(badCursor.status, 400, "non-ISO before cursor is rejected");

    // ── Attachment registration (presigned-upload → register), no transcription ─
    // Attachment presign now requires the conversationId it will be bound to.
    const presign = await request("/api/storage/uploads/request-url", {
      method: "POST", cookie: alice.cookie,
      body: { name: "pic.png", size: 128, contentType: "image/png", purpose: "attachment", conversationId: convId },
    });
    assert.equal(presign.status, 200, JSON.stringify(presign.data));
    assert.ok(presign.data.uploadURL, "presign returns an upload URL");
    assert.ok(presign.data.objectPath.startsWith("/objects/"), "presign returns a secure object path");
    assert.ok(presign.data.uploadToken, "presign returns a signed upload token");

    // Attachment presign without a conversationId is rejected.
    const presignNoConv = await request("/api/storage/uploads/request-url", {
      method: "POST", cookie: alice.cookie,
      body: { name: "pic.png", size: 128, contentType: "image/png", purpose: "attachment" },
    });
    assert.equal(presignNoConv.status, 400, "attachment presign requires conversationId");

    // Non-participant cannot presign an attachment for this conversation.
    const outsider = await registerUser("attach-outsider");
    try {
      const presignOutsider = await request("/api/storage/uploads/request-url", {
        method: "POST", cookie: outsider.cookie,
        body: { name: "pic.png", size: 128, contentType: "image/png", purpose: "attachment", conversationId: convId },
      });
      assert.equal(presignOutsider.status, 403, "non-participant cannot presign for this conversation");
    } finally {
      await cleanup(outsider);
    }

    const uploaded = await fetch(presign.data.uploadURL, {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    assert.equal(uploaded.status, 200, "attachment bytes upload successfully");

    // Registration requires the signed upload token.
    const regNoToken = await request(`/api/conversations/${convId}/messages/upload`, {
      method: "POST", cookie: alice.cookie,
      body: { objectPath: presign.data.objectPath, type: "image" },
    });
    assert.equal(regNoToken.status, 400, "registration requires an upload token");

    // Registering the object path echoes a secure serving URL accepted by send-message.
    const registered = await request(`/api/conversations/${convId}/messages/upload`, {
      method: "POST", cookie: alice.cookie,
      body: { objectPath: presign.data.objectPath, type: "image", uploadToken: presign.data.uploadToken },
    });
    assert.equal(registered.status, 200, JSON.stringify(registered.data));
    assert.match(registered.data.url, /^\/(api\/)?storage\/objects\//, "registered url is a secure storage path");

    // An already-bound object cannot be registered again (no ACL overwrite).
    const reRegister = await request(`/api/conversations/${convId}/messages/upload`, {
      method: "POST", cookie: alice.cookie,
      body: { objectPath: presign.data.objectPath, type: "image", uploadToken: presign.data.uploadToken },
    });
    assert.equal(reRegister.status, 409, "already-bound object cannot be registered again");

    // Registration rejects non-storage paths.
    const badReg = await request(`/api/conversations/${convId}/messages/upload`, {
      method: "POST", cookie: alice.cookie,
      body: { objectPath: "https://evil.example.com/x.png", type: "image", uploadToken: presign.data.uploadToken },
    });
    assert.equal(badReg.status, 400);

    // send-message accepts the registered secure attachment URL.
    const sentAttach = await request(`/api/conversations/${convId}/messages`, {
      method: "POST", cookie: alice.cookie,
      body: { contentType: "image", attachmentUrl: registered.data.url, idempotencyKey: `att-${randomUUID()}` },
    });
    assert.equal(sentAttach.status, 201, "secure attachment URL is accepted by send-message");
    assert.equal(sentAttach.data.attachmentUrl, registered.data.url);

    // Transcription input is validated without invoking a real external call.
    const badTranscribe = await request(`/api/conversations/${convId}/messages/transcribe`, {
      method: "POST", cookie: alice.cookie,
      body: { objectPath: "https://evil.example.com/a.webm" },
    });
    assert.equal(badTranscribe.status, 400, "transcribe rejects non-storage object paths");
  } finally {
    await cleanup(alice);
    await cleanup(bob);
  }
});

test("attachment upload-token binding: user/path/purpose/conversation invariants", async () => {
  const sender = await registerUser("bind-sender");
  const recipient = await registerUser("bind-recipient");
  const outsider = await registerUser("bind-outsider");
  try {
    // Conversation 1: sender + recipient.
    const conv1 = await request("/api/conversations/group", {
      method: "POST", cookie: sender.cookie,
      body: { title: "Conv One", participantIds: [recipient.id] },
    });
    assert.equal(conv1.status, 201, JSON.stringify(conv1.data));
    const conv1Id = conv1.data.id;

    // Conversation 2: sender + outsider (sender participates in both).
    const conv2 = await request("/api/conversations/group", {
      method: "POST", cookie: sender.cookie,
      body: { title: "Conv Two", participantIds: [outsider.id] },
    });
    assert.equal(conv2.status, 201, JSON.stringify(conv2.data));
    const conv2Id = conv2.data.id;

    // Sender presigns + uploads an attachment bound to conversation 1.
    const presign = await request("/api/storage/uploads/request-url", {
      method: "POST", cookie: sender.cookie,
      body: { name: "a.png", size: 8, contentType: "image/png", purpose: "attachment", conversationId: conv1Id },
    });
    assert.equal(presign.status, 200, JSON.stringify(presign.data));
    const { objectPath, uploadToken } = presign.data;
    const put = await fetch(presign.data.uploadURL, {
      method: "PUT", headers: { "content-type": "image/png" },
      body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    assert.equal(put.status, 200);

    // Recipient cannot re-register even with a leaked sender token (user mismatch).
    const leaked = await request(`/api/conversations/${conv1Id}/messages/upload`, {
      method: "POST", cookie: recipient.cookie,
      body: { objectPath, type: "image", uploadToken },
    });
    assert.equal(leaked.status, 403, "leaked sender token cannot be replayed by recipient");

    // Sender cannot register the same object into another conversation (conv mismatch).
    const wrongConv = await request(`/api/conversations/${conv2Id}/messages/upload`, {
      method: "POST", cookie: sender.cookie,
      body: { objectPath, type: "image", uploadToken },
    });
    assert.equal(wrongConv.status, 403, "token bound to conv1 cannot register into conv2");

    // Legitimate registration into conversation 1 succeeds.
    const registered = await request(`/api/conversations/${conv1Id}/messages/upload`, {
      method: "POST", cookie: sender.cookie,
      body: { objectPath, type: "image", uploadToken },
    });
    assert.equal(registered.status, 200, JSON.stringify(registered.data));
    const attachmentUrl = registered.data.url;

    // Already-bound object cannot be registered again.
    const rebind = await request(`/api/conversations/${conv1Id}/messages/upload`, {
      method: "POST", cookie: sender.cookie,
      body: { objectPath, type: "image", uploadToken },
    });
    assert.equal(rebind.status, 409, "already-bound object cannot be registered again");

    // Sender + recipient can read the object; outsider cannot.
    const senderRead = await request(attachmentUrl, { cookie: sender.cookie });
    assert.equal(senderRead.status, 200, "sender can read attachment");
    const recipientRead = await request(attachmentUrl, { cookie: recipient.cookie });
    assert.equal(recipientRead.status, 200, "recipient can read attachment");
    const outsiderRead = await request(attachmentUrl, { cookie: outsider.cookie });
    assert.equal(outsiderRead.status, 403, "outsider cannot read attachment");

    // A conversation-1 attachment cannot be SENT through conversation 2.
    const crossSend = await request(`/api/conversations/${conv2Id}/messages`, {
      method: "POST", cookie: sender.cookie,
      body: { contentType: "image", attachmentUrl, idempotencyKey: `x-${randomUUID()}` },
    });
    assert.equal(crossSend.status, 403, "conv1 attachment cannot be sent via conv2");

    // But it CAN be sent through conversation 1.
    const okSend = await request(`/api/conversations/${conv1Id}/messages`, {
      method: "POST", cookie: sender.cookie,
      body: { contentType: "image", attachmentUrl, idempotencyKey: `ok-${randomUUID()}` },
    });
    assert.equal(okSend.status, 201, "conv1 attachment sends via conv1");

    // A conversation-1 attachment cannot be TRANSCRIBED through conversation 2.
    const crossTranscribe = await request(`/api/conversations/${conv2Id}/messages/transcribe`, {
      method: "POST", cookie: sender.cookie,
      body: { objectPath },
    });
    assert.equal(crossTranscribe.status, 403, "conv1 attachment cannot be transcribed via conv2");
  } finally {
    await cleanup(sender);
    await cleanup(recipient);
    await cleanup(outsider);
  }
});

test("group creation, permissions, and leave", async () => {
  const owner = await registerUser("owner");
  const member = await registerUser("member");
  const stranger = await registerUser("stranger");
  try {
    const created = await request("/api/conversations/group", {
      method: "POST",
      cookie: owner.cookie,
      body: { title: "Test Squad", participantIds: [member.id] },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.type, "group");
    assert.equal(created.data.myRole, "owner");
    const groupId = created.data.id;

    // Stranger cannot add members (not a participant).
    const strangerAdd = await request(`/api/conversations/${groupId}/members`, {
      method: "POST", cookie: stranger.cookie, body: { userId: stranger.id },
    });
    assert.equal(strangerAdd.status, 403);

    // Plain member cannot add members (not admin).
    const memberAdd = await request(`/api/conversations/${groupId}/members`, {
      method: "POST", cookie: member.cookie, body: { userId: stranger.id },
    });
    assert.equal(memberAdd.status, 403);

    // Owner promotes member to admin, then admin can add.
    const promote = await request(`/api/conversations/${groupId}/members/${member.id}/role`, {
      method: "PATCH", cookie: owner.cookie, body: { role: "admin" },
    });
    assert.equal(promote.status, 200);
    const adminAdd = await request(`/api/conversations/${groupId}/members`, {
      method: "POST", cookie: member.cookie, body: { userId: stranger.id },
    });
    assert.equal(adminAdd.status, 200);

    // Member leaves.
    const left = await request(`/api/conversations/${groupId}/leave`, { method: "POST", cookie: stranger.cookie });
    assert.equal(left.status, 200);
    const strangerView = await request(`/api/conversations/${groupId}`, { cookie: stranger.cookie });
    assert.equal(strangerView.status, 404);
  } finally {
    await cleanup(owner);
    await cleanup(member);
    await cleanup(stranger);
  }
});

test("legacy messaging IDs reject digit-leading UUIDs and pin/mute require participation", async () => {
  const owner = await registerUser("legacy-id-owner");
  const member = await registerUser("legacy-id-member");
  const stranger = await registerUser("legacy-id-stranger");
  const digitLeadingUuid = "00000001-0000-4000-8000-000000000000";
  try {
    const created = await request("/api/conversations/group", {
      method: "POST",
      cookie: owner.cookie,
      body: { title: "Legacy ID isolation", participantIds: [member.id] },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const conversationId = created.data.id;

    const sent = await request(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      cookie: owner.cookie,
      body: { content: "Must not be addressable by a UUID prefix" },
    });
    assert.equal(sent.status, 201, JSON.stringify(sent.data));

    const malformedConversationRequests = [
      request(`/api/conversations/${digitLeadingUuid}`, { cookie: owner.cookie }),
      request(`/api/conversations/${digitLeadingUuid}/messages`, { cookie: owner.cookie }),
      request(`/api/conversations/${digitLeadingUuid}/messages`, {
        method: "POST", cookie: owner.cookie, body: { content: "not sent" },
      }),
      request(`/api/conversations/${digitLeadingUuid}/messages/preview`, {
        method: "POST", cookie: owner.cookie, body: { content: "not translated", targetLanguage: "en" },
      }),
      request(`/api/conversations/${digitLeadingUuid}/messages/upload`, {
        method: "POST", cookie: owner.cookie, body: {},
      }),
      request(`/api/conversations/${digitLeadingUuid}/messages/transcribe`, {
        method: "POST", cookie: owner.cookie, body: {},
      }),
      request(`/api/conversations/${digitLeadingUuid}/pin`, {
        method: "PATCH", cookie: owner.cookie, body: { pinned: true },
      }),
      request(`/api/conversations/${digitLeadingUuid}/mute`, {
        method: "PATCH", cookie: owner.cookie, body: { muted: true },
      }),
      request(`/api/conversations/${digitLeadingUuid}/read`, {
        method: "POST", cookie: owner.cookie,
      }),
      request(`/api/conversations/${digitLeadingUuid}/translation-preferences`, {
        method: "PATCH", cookie: owner.cookie, body: { enabled: false },
      }),
      request(`/api/conversations/${digitLeadingUuid}/leave`, {
        method: "POST", cookie: owner.cookie,
      }),
      request(`/api/conversations/${digitLeadingUuid}/members`, {
        method: "POST", cookie: owner.cookie, body: { userId: stranger.id },
      }),
    ];
    const malformedConversationResponses = await Promise.all(malformedConversationRequests);
    for (const response of malformedConversationResponses) {
      assert.equal(response.status, 400, JSON.stringify(response.data));
      assert.equal(response.data?.error, "Invalid conversation ID");
    }

    const malformedMessageRequests = [
      request(`/api/conversations/${conversationId}/messages/${digitLeadingUuid}`, {
        method: "DELETE", cookie: owner.cookie,
      }),
      request(`/api/conversations/${conversationId}/messages/${digitLeadingUuid}/react`, {
        method: "POST", cookie: owner.cookie, body: { emoji: "👍" },
      }),
      request(`/api/conversations/${conversationId}/messages/${digitLeadingUuid}/translate`, {
        method: "POST", cookie: owner.cookie, body: { targetLanguage: "en" },
      }),
    ];
    const malformedMessageResponses = await Promise.all(malformedMessageRequests);
    for (const response of malformedMessageResponses) {
      assert.equal(response.status, 400, JSON.stringify(response.data));
      assert.equal(response.data?.error, "Invalid message ID");
    }

    const malformedMember = await request(
      `/api/conversations/${conversationId}/members/${digitLeadingUuid}/role`,
      { method: "PATCH", cookie: owner.cookie, body: { role: "admin" } },
    );
    assert.equal(malformedMember.status, 400);
    assert.equal(malformedMember.data?.error, "Invalid member ID");

    const before = await request(`/api/conversations/${conversationId}`, { cookie: owner.cookie });
    assert.equal(before.status, 200);
    assert.equal(before.data.isPinned, false);
    assert.equal(before.data.isMuted, false);

    const strangerPin = await request(`/api/conversations/${conversationId}/pin`, {
      method: "PATCH", cookie: stranger.cookie, body: { pinned: true },
    });
    const strangerMute = await request(`/api/conversations/${conversationId}/mute`, {
      method: "PATCH", cookie: stranger.cookie, body: { muted: true },
    });
    for (const response of [strangerPin, strangerMute]) {
      assert.equal(response.status, 403);
      assert.deepEqual(response.data, { error: "Not a participant in this conversation" });
      assert.equal(response.data.id, undefined, "conversation data is not disclosed");
      assert.equal(response.data.participants, undefined, "participants are not disclosed");
    }

    const after = await request(`/api/conversations/${conversationId}`, { cookie: owner.cookie });
    assert.equal(after.status, 200);
    assert.equal(after.data.isPinned, false, "nonparticipant pin does not mutate participant state");
    assert.equal(after.data.isMuted, false, "nonparticipant mute does not mutate participant state");

    const messages = await request(`/api/conversations/${conversationId}/messages`, { cookie: owner.cookie });
    assert.equal(messages.status, 200);
    assert.equal(messages.data.some((message) => message.id === sent.data.id), true);
  } finally {
    await cleanup(owner);
    await cleanup(member);
    await cleanup(stranger);
  }
});

test("translation preferences are viewer-scoped and targets are canonical", async () => {
  const alice = await registerUser("translation-alice");
  const bob = await registerUser("translation-bob");
  try {
    await request("/api/discover/swipe", {
      method: "POST", cookie: alice.cookie,
      body: { targetUserId: bob.id, action: "like" },
    });
    const matched = await request("/api/discover/swipe", {
      method: "POST", cookie: bob.cookie,
      body: { targetUserId: alice.id, action: "like" },
    });
    assert.equal(matched.status, 200);
    const directId = matched.data.conversationId;

    const invalid = await request(`/api/conversations/${directId}/translation-preferences`, {
      method: "PATCH", cookie: alice.cookie,
      body: { enabled: true, targetLanguage: "English" },
    });
    assert.equal(invalid.status, 400, "language names are not accepted as API targets");

    const alicePreference = await request(`/api/conversations/${directId}/translation-preferences`, {
      method: "PATCH", cookie: alice.cookie,
      body: { enabled: true, targetLanguage: "en" },
    });
    assert.equal(alicePreference.status, 200);
    assert.equal(alicePreference.data.translationEnabled, true);
    assert.equal(alicePreference.data.translationLanguage, "en");

    const bobBefore = await request(`/api/conversations/${directId}`, { cookie: bob.cookie });
    assert.equal(bobBefore.data.translationEnabled, false, "another participant's preference is isolated");
    assert.equal(bobBefore.data.translationLanguage, null);
    assert.equal(bobBefore.data.recipientTranslationLanguage, "en");
    const aliceBeforeBob = await request(`/api/conversations/${directId}`, { cookie: alice.cookie });
    assert.equal(aliceBeforeBob.data.recipientTranslationLanguage, null,
      "a disabled recipient does not advertise an outgoing translation target");

    const bobPreference = await request(`/api/conversations/${directId}/translation-preferences`, {
      method: "PATCH", cookie: bob.cookie,
      body: { enabled: true, targetLanguage: "ja" },
    });
    assert.equal(bobPreference.status, 200);
    const aliceView = await request(`/api/conversations/${directId}`, { cookie: alice.cookie });
    assert.equal(aliceView.data.translationLanguage, "en");
    assert.equal(aliceView.data.recipientTranslationLanguage, "ja");

    const group = await request("/api/conversations/group", {
      method: "POST", cookie: alice.cookie,
      body: { title: "Personal translation", participantIds: [bob.id] },
    });
    assert.equal(group.status, 201);
    const groupPreference = await request(`/api/conversations/${group.data.id}/translation-preferences`, {
      method: "PATCH", cookie: alice.cookie,
      body: { enabled: true, targetLanguage: "ar" },
    });
    assert.equal(groupPreference.status, 200);
    const aliceGroup = await request(`/api/conversations/${group.data.id}`, { cookie: alice.cookie });
    const bobGroup = await request(`/api/conversations/${group.data.id}`, { cookie: bob.cookie });
    assert.equal(aliceGroup.data.translationLanguage, "ar");
    assert.equal(bobGroup.data.translationEnabled, false);
    assert.equal("recipientTranslationLanguage" in aliceGroup.data, false,
      "groups do not expose a global recipient target");

    const beforePreview = await request(`/api/conversations/${group.data.id}/messages`, {
      cookie: alice.cookie,
    });
    const rejectedPreview = await request(`/api/conversations/${group.data.id}/messages/preview`, {
      method: "POST", cookie: alice.cookie,
      body: { content: "draft remains local", targetLanguage: "Japanese" },
    });
    assert.equal(rejectedPreview.status, 400);
    const afterPreview = await request(`/api/conversations/${group.data.id}/messages`, {
      cookie: alice.cookie,
    });
    assert.equal(afterPreview.data.length, beforePreview.data.length,
      "translation preview validation never persists a message");
  } finally {
    await cleanup(alice);
    await cleanup(bob);
  }
});

test("group blocks isolate blocked members while preserving unrelated members and history", async (t) => {
  const alice = await registerUser("group-block-alice");
  const bob = await registerUser("group-block-bob");
  const carol = await registerUser("group-block-carol");
  try {
    const created = await request("/api/conversations/group", {
      method: "POST", cookie: carol.cookie,
      body: { title: "Blocked pair isolation", participantIds: [alice.id, bob.id] },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const convId = created.data.id;
    const beforeBlock = await request(`/api/conversations/${convId}/messages`, {
      method: "POST", cookie: bob.cookie, body: { content: "bob-before-block" },
    });
    assert.equal(beforeBlock.status, 201);

    const blocked = await request("/api/safety/block", {
      method: "POST", cookie: alice.cookie,
      body: { blockedUserId: bob.id, reason: "group privacy test" },
    });
    assert.equal(blocked.status, 200);

    const aliceConversation = await request(`/api/conversations/${convId}`, { cookie: alice.cookie });
    assert.equal(aliceConversation.status, 200);
    assert.ok(!aliceConversation.data.participants.some((p) => p.userId === bob.id));
    assert.ok(aliceConversation.data.participants.some((p) => p.userId === carol.id));
    const aliceList = await request("/api/conversations", { cookie: alice.cookie });
    const listed = aliceList.data.find((conversation) => conversation.id === convId);
    assert.ok(listed, "group remains in the unrelated conversation history");
    assert.ok(!listed.participants.some((p) => p.userId === bob.id));

    const aliceMessages = await request(`/api/conversations/${convId}/messages`, { cookie: alice.cookie });
    assert.ok(!aliceMessages.data.some((message) => message.id === beforeBlock.data.id));
    const carolMessages = await request(`/api/conversations/${convId}/messages`, { cookie: carol.cookie });
    assert.ok(carolMessages.data.some((message) => message.id === beforeBlock.data.id));

    const bobAfterBlock = await request(`/api/conversations/${convId}/messages`, {
      method: "POST", cookie: bob.cookie, body: { content: "bob-after-block" },
    });
    assert.equal(bobAfterBlock.status, 201, "blocked member may still address unrelated group members");
    const aliceAfter = await request(`/api/conversations/${convId}/messages`, { cookie: alice.cookie });
    assert.ok(!aliceAfter.data.some((message) => message.id === bobAfterBlock.data.id));
    const carolAfter = await request(`/api/conversations/${convId}/messages`, { cookie: carol.cookie });
    assert.ok(carolAfter.data.some((message) => message.id === bobAfterBlock.data.id));

    const streamAbort = new AbortController();
    const stream = await fetch(`${baseUrl}/api/conversations/${convId}/stream`, {
      headers: { cookie: alice.cookie, "x-forwarded-for": "198.51.100.77" },
      signal: streamAbort.signal,
    });
    assert.equal(stream.status, 200);
    const reader = stream.body.getReader();
    const streamedBob = await request(`/api/conversations/${convId}/messages`, {
      method: "POST", cookie: bob.cookie, body: { content: "bob-stream-secret" },
    });
    assert.equal(streamedBob.status, 201);
    const streamedCarol = await request(`/api/conversations/${convId}/messages`, {
      method: "POST", cookie: carol.cookie, body: { content: "carol-stream-visible" },
    });
    assert.equal(streamedCarol.status, 201);
    let streamText = "";
    const streamDeadline = Date.now() + 7_000;
    while (Date.now() < streamDeadline && !streamText.includes("carol-stream-visible")) {
      const remaining = streamDeadline - Date.now();
      const chunk = await Promise.race([
        reader.read(),
        new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), remaining)),
      ]);
      if (chunk.timeout || chunk.done) break;
      streamText += new TextDecoder().decode(chunk.value);
    }
    streamAbort.abort();
    assert.match(streamText, /carol-stream-visible/);
    assert.doesNotMatch(streamText, /bob-stream-secret/);

    const reaction = await request(
      `/api/conversations/${convId}/messages/${bobAfterBlock.data.id}/react`,
      { method: "POST", cookie: alice.cookie, body: { emoji: "👍" } },
    );
    assert.equal(reaction.status, 404);
    const translation = await request(
      `/api/conversations/${convId}/messages/${bobAfterBlock.data.id}/translate`,
      { method: "POST", cookie: alice.cookie, body: { targetLanguage: "es" } },
    );
    assert.equal(translation.status, 404, "blocked content is rejected before external translation");

    const notifications = await request("/api/notifications", { cookie: alice.cookie });
    assert.ok(!notifications.data.some(
      (notification) => notification.relatedId === convId
        && notification.body === "bob-after-block",
    ));

    const invalidGroup = await request("/api/conversations/group", {
      method: "POST", cookie: carol.cookie,
      body: { title: "Invalid blocked composition", participantIds: [alice.id, bob.id] },
    });
    assert.equal(invalidGroup.status, 400);
    const addTarget = await request("/api/conversations/group", {
      method: "POST", cookie: carol.cookie,
      body: { title: "Add blocked candidate", participantIds: [alice.id] },
    });
    assert.equal(addTarget.status, 201);
    const addBlocked = await request(`/api/conversations/${addTarget.data.id}/members`, {
      method: "POST", cookie: carol.cookie, body: { userId: bob.id },
    });
    assert.equal(addBlocked.status, 400);

    const presign = await request("/api/storage/uploads/request-url", {
      method: "POST", cookie: bob.cookie,
      body: {
        name: "blocked.png", size: 8, contentType: "image/png",
        purpose: "attachment", conversationId: convId,
      },
    });
    if (presign.status !== 200) {
      t.diagnostic(`attachment storage unavailable (${presign.status})`);
    } else {
      const uploaded = await fetch(presign.data.uploadURL, {
        method: "PUT", headers: { "content-type": "image/png" },
        body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      });
      assert.equal(uploaded.status, 200);
      const registered = await request(`/api/conversations/${convId}/messages/upload`, {
        method: "POST", cookie: bob.cookie,
        body: {
          objectPath: presign.data.objectPath,
          uploadToken: presign.data.uploadToken,
          type: "image",
        },
      });
      assert.equal(registered.status, 200);
      assert.equal((await request(registered.data.url, { cookie: alice.cookie })).status, 403);
      assert.equal((await request(registered.data.url, { cookie: carol.cookie })).status, 200);
      const transcribe = await request(`/api/conversations/${convId}/messages/transcribe`, {
        method: "POST", cookie: alice.cookie,
        body: { objectPath: presign.data.objectPath },
      });
      assert.equal(transcribe.status, 403);
    }
  } finally {
    await cleanup(alice);
    await cleanup(bob);
    await cleanup(carol);
  }
});

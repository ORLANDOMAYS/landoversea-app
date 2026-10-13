import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const baseUrl = (process.env.TEST_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("x-forwarded-for", options.clientIp ?? "203.0.113.44");
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

async function registerUser(label) {
  const suffix = randomUUID();
  const email = `${label}-${suffix}@example.com`;
  const password = "MigratePass123!";
  const name = `${label} ${suffix.slice(0, 6)}`;
  const res = await request("/api/auth/register", {
    method: "POST",
    body: { name, email, password, acceptedAgeRequirement: true },
  });
  assert.equal(res.status, 201, `register ${label}: ${JSON.stringify(res.data)}`);
  const me = await request("/api/auth/me", { cookie: res.cookie });
  return { email, password, cookie: res.cookie, id: me.data?.user?.id ?? me.data?.id };
}

async function makeAdmin() {
  const u = await registerUser("mig-admin");
  await db.update(usersTable).set({ role: "admin" }).where(eq(usersTable.id, u.id));
  return u;
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

// Build a canonical inline snapshot. Uses unique source ids/emails per run so
// tests are isolated and never touch the configured/external Base44 source.
function buildSnapshot(overrides = {}) {
  const tag = randomUUID().slice(0, 8);
  const uEmail = `legacy-${tag}@example.com`;
  const u2Email = `legacy2-${tag}@example.com`;
  const now = "2020-01-01T00:00:00.000Z";
  return {
    snapshotId: `snap-${tag}`,
    exportedAt: now,
    users: [
      { id: `su-${tag}`, email: uEmail, name: "Legacy One", role: "admin", updatedAt: now },
      { id: `su2-${tag}`, email: u2Email, name: "Legacy Two", updatedAt: now },
    ],
    profiles: [
      { id: `sp-${tag}`, userId: `su-${tag}`, name: "Legacy One", age: 30, bio: "Hi", updatedAt: now },
    ],
    matches: [{ id: `sm-${tag}`, userId1: `su-${tag}`, userId2: `su2-${tag}`, updatedAt: now }],
    conversations: [
      {
        id: `sc-${tag}`,
        type: "direct",
        participantUserIds: [`su-${tag}`, `su2-${tag}`],
        matchId: `sm-${tag}`,
        updatedAt: now,
      },
    ],
    messages: [
      {
        id: `smsg-${tag}`,
        conversationId: `sc-${tag}`,
        senderUserId: `su-${tag}`,
        content: "Hello from Base44",
        contentType: "text",
        updatedAt: now,
      },
    ],
    premium: [
      { id: `sub-${tag}`, userId: `su-${tag}`, planId: "monthly", status: "active", platform: "web", updatedAt: now },
    ],
    _tag: tag,
    _uEmail: uEmail,
    _u2Email: u2Email,
  };
}

function stripMeta(snap) {
  const { _tag, _uEmail, _u2Email, ...rest } = snap;
  return rest;
}

test("dry-run and commit are admin-only", async () => {
  const nonAdmin = await registerUser("mig-user");
  try {
    const snap = stripMeta(buildSnapshot());
    const anon = await request("/api/admin/migrations/dry-run", { method: "POST", body: { snapshot: snap } });
    assert.equal(anon.status, 401);
    const forbidden = await request("/api/admin/migrations/dry-run", {
      method: "POST",
      cookie: nonAdmin.cookie,
      body: { snapshot: snap },
    });
    assert.equal(forbidden.status, 403);
    const listForbidden = await request("/api/admin/migrations", { cookie: nonAdmin.cookie });
    assert.equal(listForbidden.status, 403);
  } finally {
    await cleanup(nonAdmin);
  }
});

test("migration run IDs reject non-canonical and unsafe values", async () => {
  const admin = await makeAdmin();
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
      const detail = await request(`/api/admin/migrations/${id}`, { cookie: admin.cookie });
      assert.equal(detail.status, 400, `runId ${id}: ${JSON.stringify(detail.data)}`);
      const commit = await request("/api/admin/migrations/commit", {
        method: "POST",
        cookie: admin.cookie,
        body: { dryRunId: id },
      });
      assert.equal(commit.status, 400, `dryRunId ${id}: ${JSON.stringify(commit.data)}`);
    }
  } finally {
    await cleanup(admin);
  }
});

test("commit requires a valid dryRunId and matching snapshot hash", async () => {
  const admin = await makeAdmin();
  try {
    const raw = buildSnapshot();
    const snap = stripMeta(raw);

    // Missing dryRunId/hash rejected.
    const noArgs = await request("/api/admin/migrations/commit", {
      method: "POST",
      cookie: admin.cookie,
      body: { snapshot: snap },
    });
    assert.equal(noArgs.status, 400);

    const dry = await request("/api/admin/migrations/dry-run", {
      method: "POST",
      cookie: admin.cookie,
      body: { snapshot: snap },
    });
    assert.equal(dry.status, 200);
    assert.equal(dry.data.mode, "dry_run");
    assert.ok(dry.data.snapshotHash);

    // Wrong hash rejected.
    const badHash = await request("/api/admin/migrations/commit", {
      method: "POST",
      cookie: admin.cookie,
      body: { dryRunId: dry.data.runId, snapshotHash: "deadbeef", snapshot: snap },
    });
    assert.equal(badHash.status, 409);
    assert.equal(badHash.data.code, "snapshot_hash_mismatch");

    // Bad dryRunId rejected.
    const badRun = await request("/api/admin/migrations/commit", {
      method: "POST",
      cookie: admin.cookie,
      body: { dryRunId: 99999999, snapshotHash: dry.data.snapshotHash, snapshot: snap },
    });
    assert.equal(badRun.status, 409);
    assert.equal(badRun.data.code, "dry_run_not_found");

    // The commit decision plan must be exactly the one reviewed in dry-run.
    const changedPlan = await request("/api/admin/migrations/commit", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        dryRunId: dry.data.runId,
        snapshotHash: dry.data.snapshotHash,
        snapshot: snap,
        decisions: [{ entityType: "user", sourceId: snap.users[0].id, decision: "skip" }],
      },
    });
    assert.equal(changedPlan.status, 409);
    assert.equal(changedPlan.data.code, "decision_plan_mismatch");
  } finally {
    await cleanup(admin);
  }
});

test("commit imports domain rows, is idempotent, and records traceability", async () => {
  const admin = await makeAdmin();
  const created = { emails: [] };
  try {
    const raw = buildSnapshot();
    const snap = stripMeta(raw);
    created.emails.push(raw._uEmail, raw._u2Email);

    const dry = await request("/api/admin/migrations/dry-run", {
      method: "POST",
      cookie: admin.cookie,
      body: { snapshot: snap },
    });
    assert.equal(dry.status, 200);
    // Before counts captured; after > before for inserts.
    assert.ok(dry.data.beforeCounts.users >= 0);
    assert.ok(dry.data.afterCounts.users >= dry.data.beforeCounts.users + 2);

    const commit = await request("/api/admin/migrations/commit", {
      method: "POST",
      cookie: admin.cookie,
      body: { dryRunId: dry.data.runId, snapshotHash: dry.data.snapshotHash, snapshot: snap },
    });
    assert.equal(commit.status, 200, JSON.stringify(commit.data));
    assert.equal(commit.data.status, "committed");
    assert.equal(commit.data.idempotentReplay, false);
    assert.equal(commit.data.afterCounts.users, commit.data.beforeCounts.users + 2);
    assert.equal(commit.data.afterCounts.messages, commit.data.beforeCounts.messages + 1);
    assert.equal(commit.data.afterCounts.premium, commit.data.beforeCounts.premium + 1);
    const firstRunId = commit.data.runId;

    // Imported legacy admin must NOT be admin, and must have unusable login.
    const [legacyUser] = await db.select().from(usersTable).where(eq(usersTable.email, raw._uEmail)).limit(1);
    assert.ok(legacyUser, "legacy user imported");
    assert.equal(legacyUser.role, "user", "legacy admin never auto-elevated");
    const login = await request("/api/auth/login", {
      method: "POST",
      body: { email: raw._uEmail, password: "MigratePass123!" },
    });
    assert.notEqual(login.status, 200, "imported user cannot log in with a guessed password");

    // Traceability: report exposes mappings + ledger, no password hashes.
    const report = await request(`/api/admin/migrations/${firstRunId}/report`, { cookie: admin.cookie });
    assert.equal(report.status, 200);
    assert.ok(report.data.ledger.length >= 6, "ledger records each domain op");
    assert.ok(report.data.mappings.some((m) => m.entityType === "user"));
    const serialized = JSON.stringify(report.data);
    assert.ok(!serialized.includes("passwordHash"), "reports never expose password hashes");
    assert.ok(!serialized.includes("!base44-migrated-no-login!"), "no hash sentinel leaked");

    // Idempotent repeat commit: returns prior run, no duplicate rows.
    const commit2 = await request("/api/admin/migrations/commit", {
      method: "POST",
      cookie: admin.cookie,
      body: { dryRunId: dry.data.runId, snapshotHash: dry.data.snapshotHash, snapshot: snap },
    });
    assert.equal(commit2.status, 200);
    assert.equal(commit2.data.idempotentReplay, true);
    assert.equal(commit2.data.runId, firstRunId, "returns previous committed run");

    const users = await db.select().from(usersTable).where(eq(usersTable.email, raw._uEmail));
    assert.equal(users.length, 1, "no duplicate user rows on repeat commit");
  } finally {
    for (const email of created.emails) {
      await db.delete(usersTable).where(eq(usersTable.email, email));
    }
    await cleanup(admin);
  }
});

test("reconciliation maps existing users by normalized email without duplication", async () => {
  const admin = await makeAdmin();
  // Register a user whose email matches the source when normalized (case/space).
  const existing = await registerUser("existing");
  try {
    const raw = buildSnapshot();
    // Point source user email at the existing account, but mixed-case + spaces.
    const messyEmail = `  ${existing.email.toUpperCase()} `;
    raw.users[0].email = messyEmail;
    raw.users = [raw.users[0]];
    raw.profiles = [];
    raw.matches = [];
    raw.conversations = [];
    raw.messages = [];
    raw.premium = [];
    const snap = stripMeta(raw);
    const decisions = [
      { entityType: "user", sourceId: raw.users[0].id, decision: "keep_replit" },
    ];

    const dry = await request("/api/admin/migrations/dry-run", {
      method: "POST",
      cookie: admin.cookie,
      body: { snapshot: snap, decisions },
    });
    assert.equal(dry.status, 200);

    const commit = await request("/api/admin/migrations/commit", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        dryRunId: dry.data.runId,
        snapshotHash: dry.data.snapshotHash,
        snapshot: snap,
        decisions,
      },
    });
    assert.equal(commit.status, 200, JSON.stringify(commit.data));

    // Only ONE new user (the second legacy user); existing reused.
    const matches = await db.select().from(usersTable).where(eq(usersTable.email, existing.email));
    assert.equal(matches.length, 1, "existing user not duplicated by normalized email");
    await db.delete(usersTable).where(eq(usersTable.email, raw._u2Email));
  } finally {
    await cleanup(existing);
    await cleanup(admin);
  }
});

test("no duplicate matches, conversations, messages, or subscriptions across two commits", async () => {
  const admin = await makeAdmin();
  const raw = buildSnapshot();
  const snap = stripMeta(raw);
  try {
    const dry1 = await request("/api/admin/migrations/dry-run", {
      method: "POST",
      cookie: admin.cookie,
      body: { snapshot: snap },
    });
    const c1 = await request("/api/admin/migrations/commit", {
      method: "POST",
      cookie: admin.cookie,
      body: { dryRunId: dry1.data.runId, snapshotHash: dry1.data.snapshotHash, snapshot: snap },
    });
    assert.equal(c1.status, 200);

    // A second dry-run of the SAME snapshot with a fresh dryRunId (different run,
    // same hash) — commit must not create duplicate domain rows.
    const dry2 = await request("/api/admin/migrations/dry-run", {
      method: "POST",
      cookie: admin.cookie,
      body: { snapshot: snap },
    });
    const c2 = await request("/api/admin/migrations/commit", {
      method: "POST",
      cookie: admin.cookie,
      body: { dryRunId: dry2.data.runId, snapshotHash: dry2.data.snapshotHash, snapshot: snap },
    });
    assert.equal(c2.status, 200);
    // Second commit inserts nothing new (all deduped by natural identity/mapping).
    assert.equal(c2.data.afterCounts.messages, c2.data.beforeCounts.messages);
    assert.equal(c2.data.afterCounts.conversations, c2.data.beforeCounts.conversations);
    assert.equal(c2.data.afterCounts.matches, c2.data.beforeCounts.matches);
    assert.equal(c2.data.afterCounts.premium, c2.data.beforeCounts.premium);
    assert.equal(c2.data.afterCounts.users, c2.data.beforeCounts.users);

    const report2 = await request(`/api/admin/migrations/${c2.data.runId}/report`, { cookie: admin.cookie });
    const actions = report2.data.summary.actions;
    assert.equal(actions.message.inserted, 0, "no new messages second commit");
    assert.equal(actions.conversation.inserted, 0);
    assert.equal(actions.premium.inserted, 0);
  } finally {
    await db.delete(usersTable).where(eq(usersTable.email, raw._uEmail));
    await db.delete(usersTable).where(eq(usersTable.email, raw._u2Email));
    await cleanup(admin);
  }
});

test("newer Replit data is reported as a conflict and respects explicit decisions", async () => {
  const admin = await makeAdmin();
  const raw = buildSnapshot();
  const snap = stripMeta(raw);
  try {
    // First commit imports everything.
    const dry1 = await request("/api/admin/migrations/dry-run", {
      method: "POST",
      cookie: admin.cookie,
      body: { snapshot: snap },
    });
    const c1 = await request("/api/admin/migrations/commit", {
      method: "POST",
      cookie: admin.cookie,
      body: { dryRunId: dry1.data.runId, snapshotHash: dry1.data.snapshotHash, snapshot: snap },
    });
    assert.equal(c1.status, 200);

    // Now the Replit user profile is edited more recently than the source.
    const [legacyUser] = await db.select().from(usersTable).where(eq(usersTable.email, raw._uEmail)).limit(1);
    await db.update(usersTable).set({ name: "Edited In Replit" }).where(eq(usersTable.id, legacyUser.id));

    // A new source snapshot changes the user name but with an OLDER updatedAt.
    const raw2 = buildSnapshot();
    raw2.users[0].id = raw.users[0].id;
    raw2.users[0].email = raw._uEmail; // same identity
    raw2.users[0].name = "Base44 New Name";
    raw2.users[0].updatedAt = "2019-06-01T00:00:00.000Z"; // older than Replit edit
    // Trim to just the user to keep the test focused.
    const snap2 = stripMeta({ ...raw2, profiles: [], matches: [], conversations: [], messages: [], premium: [] });

    const dry2 = await request("/api/admin/migrations/dry-run", {
      method: "POST",
      cookie: admin.cookie,
      body: { snapshot: snap2 },
    });
    assert.equal(dry2.status, 200);
    assert.equal(dry2.data.status, "conflicted");
    const conflict = dry2.data.conflicts.find((c) => c.entityType === "user" && c.conflictType === "newer_replit");
    assert.ok(conflict, "newer Replit change surfaced as conflict");

    // keep_replit decision: no overwrite.
    const dryKeep = await request("/api/admin/migrations/dry-run", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        snapshot: snap2,
        decisions: [{ entityType: "user", sourceId: raw2.users[0].id, decision: "keep_replit" }],
      },
    });
    assert.equal(dryKeep.data.status, "previewed");
    const cKeep = await request("/api/admin/migrations/commit", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        dryRunId: dryKeep.data.runId,
        snapshotHash: dryKeep.data.snapshotHash,
        snapshot: snap2,
        decisions: [{ entityType: "user", sourceId: raw2.users[0].id, decision: "keep_replit" }],
      },
    });
    assert.equal(cKeep.status, 200);
    const [afterKeep] = await db.select().from(usersTable).where(eq(usersTable.id, legacyUser.id)).limit(1);
    assert.equal(afterKeep.name, "Edited In Replit", "keep_replit preserves newer Replit data");

    // use_base44 decision: explicit overwrite allowed.
    const dryUse = await request("/api/admin/migrations/dry-run", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        snapshot: snap2,
        decisions: [{ entityType: "user", sourceId: raw2.users[0].id, decision: "use_base44" }],
      },
    });
    const cUse = await request("/api/admin/migrations/commit", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        dryRunId: dryUse.data.runId,
        snapshotHash: dryUse.data.snapshotHash,
        snapshot: snap2,
        decisions: [{ entityType: "user", sourceId: raw2.users[0].id, decision: "use_base44" }],
      },
    });
    assert.equal(cUse.status, 200);
    const [afterUse] = await db.select().from(usersTable).where(eq(usersTable.id, legacyUser.id)).limit(1);
    assert.equal(afterUse.name, "Base44 New Name", "use_base44 applies the source value");
    assert.equal(afterUse.role, "user", "still never elevated to admin");
  } finally {
    await db.delete(usersTable).where(eq(usersTable.email, raw._uEmail));
    await db.delete(usersTable).where(eq(usersTable.email, raw._u2Email));
    await cleanup(admin);
  }
});

test("missing dependencies and duplicate source identities become conflicts", async () => {
  const admin = await makeAdmin();
  try {
    const tag = randomUUID().slice(0, 8);
    const now = "2020-01-01T00:00:00.000Z";
    const snap = {
      snapshotId: `dup-${tag}`,
      exportedAt: now,
      users: [
        { id: `du-${tag}`, email: `dup-${tag}@example.com`, name: "Dup", updatedAt: now },
        { id: `du-${tag}`, email: `dup-other-${tag}@example.com`, name: "Dup Again", updatedAt: now },
        { id: `du2-${tag}`, email: `dup-pair-${tag}@example.com`, name: "Pair", updatedAt: now },
      ],
      profiles: [{ id: `dp-${tag}`, userId: `missing-${tag}`, name: "Orphan", updatedAt: now }],
      matches: [],
      conversations: [
        {
          id: `dc1-${tag}`,
          type: "direct",
          participantUserIds: [`du-${tag}`, `du2-${tag}`],
          updatedAt: now,
        },
        {
          id: `dc2-${tag}`,
          type: "direct",
          participantUserIds: [`du2-${tag}`, `du-${tag}`],
          updatedAt: now,
        },
      ],
      messages: [],
      premium: [],
    };
    const dry = await request("/api/admin/migrations/dry-run", {
      method: "POST",
      cookie: admin.cookie,
      body: { snapshot: snap },
    });
    assert.equal(dry.status, 200);
    assert.equal(dry.data.status, "conflicted");
    assert.ok(dry.data.conflicts.some((c) => c.conflictType === "duplicate_source_identity"));
    assert.ok(dry.data.conflicts.some((c) => c.conflictType === "missing_dependency"));
    assert.ok(dry.data.conflicts.some((c) => c.conflictType === "duplicate_natural_identity"));
    await db.delete(usersTable).where(eq(usersTable.email, `dup-${tag}@example.com`));
    await db.delete(usersTable).where(eq(usersTable.email, `dup-pair-${tag}@example.com`));
  } finally {
    await cleanup(admin);
  }
});

test("rollback reverses a committed run and guards against drifted rows", async () => {
  const admin = await makeAdmin();
  const raw = buildSnapshot();
  const snap = stripMeta(raw);
  try {
    const dry = await request("/api/admin/migrations/dry-run", {
      method: "POST",
      cookie: admin.cookie,
      body: { snapshot: snap },
    });
    const commit = await request("/api/admin/migrations/commit", {
      method: "POST",
      cookie: admin.cookie,
      body: { dryRunId: dry.data.runId, snapshotHash: dry.data.snapshotHash, snapshot: snap },
    });
    assert.equal(commit.status, 200);
    const runId = commit.data.runId;

    const beforeUsers = await db.select().from(usersTable).where(eq(usersTable.email, raw._uEmail));
    assert.equal(beforeUsers.length, 1);

    const rollback = await request(`/api/admin/migrations/${runId}/rollback`, {
      method: "POST",
      cookie: admin.cookie,
    });
    assert.equal(rollback.status, 200, JSON.stringify(rollback.data));
    assert.equal(rollback.data.status, "rolled_back");
    assert.ok(rollback.data.reversed >= 6);
    assert.equal(rollback.data.conflicts.length, 0);

    // Imported rows removed.
    const afterUsers = await db.select().from(usersTable).where(eq(usersTable.email, raw._uEmail));
    assert.equal(afterUsers.length, 0, "inserted users removed on rollback");

    // Double rollback rejected.
    const again = await request(`/api/admin/migrations/${runId}/rollback`, {
      method: "POST",
      cookie: admin.cookie,
    });
    assert.equal(again.status, 409);
    assert.equal(again.data.code, "already_rolled_back");
  } finally {
    await db.delete(usersTable).where(eq(usersTable.email, raw._uEmail));
    await db.delete(usersTable).where(eq(usersTable.email, raw._u2Email));
    await cleanup(admin);
  }
});

test("rollback reports a conflict instead of overwriting drifted data", async () => {
  const admin = await makeAdmin();
  const raw = buildSnapshot();
  // Focus on a single premium-only snapshot to make drift deterministic.
  const existing = await registerUser("drift");
  try {
    const now = "2020-01-01T00:00:00.000Z";
    const tag = randomUUID().slice(0, 8);
    // Pre-existing subscription (none) that the migration UPDATES via use_base44,
    // then someone edits it after commit -> rollback must NOT clobber the edit.
    const snap = {
      snapshotId: `drift-${tag}`,
      exportedAt: now,
      users: [{ id: `dfu-${tag}`, email: existing.email.toUpperCase(), name: "Drift", updatedAt: now }],
      profiles: [],
      matches: [],
      conversations: [],
      messages: [],
      premium: [
        {
          id: `dfsub-${tag}`,
          userId: `dfu-${tag}`,
          planId: "monthly",
          status: "active",
          platform: "web",
          updatedAt: now,
        },
      ],
    };
    const decisions = [
      { entityType: "user", sourceId: `dfu-${tag}`, decision: "keep_replit" },
    ];
    const dry = await request("/api/admin/migrations/dry-run", {
      method: "POST",
      cookie: admin.cookie,
      body: { snapshot: snap, decisions },
    });
    const commit = await request("/api/admin/migrations/commit", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        dryRunId: dry.data.runId,
        snapshotHash: dry.data.snapshotHash,
        snapshot: snap,
        decisions,
      },
    });
    assert.equal(commit.status, 200, JSON.stringify(commit.data));

    // Import created a subscription row for the existing user.
    const { premiumSubscriptionsTable } = await import("@workspace/db");
    const [sub] = await db
      .select()
      .from(premiumSubscriptionsTable)
      .where(eq(premiumSubscriptionsTable.userId, existing.id))
      .limit(1);
    assert.ok(sub, "subscription inserted");

    // Drift: change the subscription after commit.
    await db
      .update(premiumSubscriptionsTable)
      .set({ status: "cancelled" })
      .where(eq(premiumSubscriptionsTable.id, sub.id));

    const rollback = await request(`/api/admin/migrations/${commit.data.runId}/rollback`, {
      method: "POST",
      cookie: admin.cookie,
    });
    assert.equal(rollback.status, 200, JSON.stringify(rollback.data));
    assert.equal(rollback.data.status, "conflicted", "drifted row blocks clean rollback");
    assert.ok(rollback.data.conflicts.some((c) => c.reason === "drifted_since_commit"));

    // Drifted row untouched (not deleted / not restored).
    const [after] = await db
      .select()
      .from(premiumSubscriptionsTable)
      .where(eq(premiumSubscriptionsTable.id, sub.id))
      .limit(1);
    assert.ok(after, "drifted subscription preserved");
    assert.equal(after.status, "cancelled", "rollback did not overwrite newer change");
  } finally {
    const { premiumSubscriptionsTable } = await import("@workspace/db");
    await db.delete(premiumSubscriptionsTable).where(eq(premiumSubscriptionsTable.userId, existing.id));
    await cleanup(existing);
    await cleanup(admin);
  }
});

test("rollback restores a pre-existing match after conversation backfill", async () => {
  const admin = await makeAdmin();
  const first = await registerUser("pre-match-a");
  const second = await registerUser("pre-match-b");
  const { matchesTable } = await import("@workspace/db");
  const [a, b] = first.id < second.id ? [first.id, second.id] : [second.id, first.id];
  const [existingMatch] = await db
    .insert(matchesTable)
    .values({ userId1: a, userId2: b })
    .returning();
  try {
    const tag = randomUUID().slice(0, 8);
    const now = "2020-01-01T00:00:00.000Z";
    const firstSourceId = `pmu1-${tag}`;
    const secondSourceId = `pmu2-${tag}`;
    const matchSourceId = `pmm-${tag}`;
    const snapshot = {
      snapshotId: `pre-match-${tag}`,
      exportedAt: now,
      users: [
        { id: firstSourceId, email: first.email, name: "Existing First", updatedAt: now },
        { id: secondSourceId, email: second.email, name: "Existing Second", updatedAt: now },
      ],
      profiles: [],
      matches: [
        { id: matchSourceId, userId1: firstSourceId, userId2: secondSourceId, updatedAt: now },
      ],
      conversations: [
        {
          id: `pmc-${tag}`,
          type: "direct",
          participantUserIds: [firstSourceId, secondSourceId],
          matchId: matchSourceId,
          updatedAt: now,
        },
      ],
      messages: [],
      premium: [],
    };
    const decisions = [
      { entityType: "user", sourceId: firstSourceId, decision: "keep_replit" },
      { entityType: "user", sourceId: secondSourceId, decision: "keep_replit" },
    ];
    const dry = await request("/api/admin/migrations/dry-run", {
      method: "POST",
      cookie: admin.cookie,
      body: { snapshot, decisions },
    });
    assert.equal(dry.status, 200, JSON.stringify(dry.data));
    const commit = await request("/api/admin/migrations/commit", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        dryRunId: dry.data.runId,
        snapshotHash: dry.data.snapshotHash,
        snapshot,
        decisions,
      },
    });
    assert.equal(commit.status, 200, JSON.stringify(commit.data));

    const [backfilled] = await db.select().from(matchesTable).where(eq(matchesTable.id, existingMatch.id));
    assert.ok(backfilled.conversationId, "migration linked the new conversation");

    const rollback = await request(`/api/admin/migrations/${commit.data.runId}/rollback`, {
      method: "POST",
      cookie: admin.cookie,
    });
    assert.equal(rollback.status, 200, JSON.stringify(rollback.data));
    assert.equal(rollback.data.status, "rolled_back");
    const [restored] = await db.select().from(matchesTable).where(eq(matchesTable.id, existingMatch.id));
    assert.ok(restored, "pre-existing match remains");
    assert.equal(restored.conversationId, null, "pre-existing match link is restored");
  } finally {
    await db.delete(matchesTable).where(eq(matchesTable.id, existingMatch.id));
    await cleanup(first);
    await cleanup(second);
    await cleanup(admin);
  }
});

test("rollback removes participants added to a pre-existing conversation", async () => {
  const admin = await makeAdmin();
  const first = await registerUser("pre-conv-a");
  const second = await registerUser("pre-conv-b");
  const { conversationsTable, conversationParticipantsTable } = await import("@workspace/db");
  const [a, b] = first.id < second.id ? [first.id, second.id] : [second.id, first.id];
  const [existingConversation] = await db
    .insert(conversationsTable)
    .values({ type: "direct", directKey: `${a}:${b}` })
    .returning();
  await db
    .insert(conversationParticipantsTable)
    .values({ conversationId: existingConversation.id, userId: a, role: "member" });
  try {
    const tag = randomUUID().slice(0, 8);
    const now = "2020-01-01T00:00:00.000Z";
    const firstSourceId = `pcu1-${tag}`;
    const secondSourceId = `pcu2-${tag}`;
    const snapshot = {
      snapshotId: `pre-conv-${tag}`,
      exportedAt: now,
      users: [
        { id: firstSourceId, email: first.email, name: "Existing First", updatedAt: now },
        { id: secondSourceId, email: second.email, name: "Existing Second", updatedAt: now },
      ],
      profiles: [],
      matches: [],
      conversations: [
        {
          id: `pcc-${tag}`,
          type: "direct",
          participantUserIds: [firstSourceId, secondSourceId],
          updatedAt: now,
        },
      ],
      messages: [],
      premium: [],
    };
    const decisions = [
      { entityType: "user", sourceId: firstSourceId, decision: "keep_replit" },
      { entityType: "user", sourceId: secondSourceId, decision: "keep_replit" },
    ];
    const dry = await request("/api/admin/migrations/dry-run", {
      method: "POST",
      cookie: admin.cookie,
      body: { snapshot, decisions },
    });
    assert.equal(dry.status, 200, JSON.stringify(dry.data));
    const commit = await request("/api/admin/migrations/commit", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        dryRunId: dry.data.runId,
        snapshotHash: dry.data.snapshotHash,
        snapshot,
        decisions,
      },
    });
    assert.equal(commit.status, 200, JSON.stringify(commit.data));

    const afterCommit = await db
      .select()
      .from(conversationParticipantsTable)
      .where(eq(conversationParticipantsTable.conversationId, existingConversation.id));
    assert.deepEqual(
      afterCommit.map((row) => row.userId).sort((left, right) => left - right),
      [a, b],
    );

    const rollback = await request(`/api/admin/migrations/${commit.data.runId}/rollback`, {
      method: "POST",
      cookie: admin.cookie,
    });
    assert.equal(rollback.status, 200, JSON.stringify(rollback.data));
    assert.equal(rollback.data.status, "rolled_back");
    const afterRollback = await db
      .select()
      .from(conversationParticipantsTable)
      .where(eq(conversationParticipantsTable.conversationId, existingConversation.id));
    assert.deepEqual(afterRollback.map((row) => row.userId), [a]);
  } finally {
    await db.delete(conversationsTable).where(eq(conversationsTable.id, existingConversation.id));
    await cleanup(first);
    await cleanup(second);
    await cleanup(admin);
  }
});

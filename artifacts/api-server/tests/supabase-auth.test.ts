import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import bcrypt from "bcryptjs";
import { db, externalIdentitiesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  authenticateBearerToken,
  requireAuth,
  selectRequestAuthToken,
  type AccessTokenDependencies,
} from "../src/lib/auth";
import {
  mapSupabaseIdentity,
  SupabaseAuthError,
  verifySupabaseAccessToken,
  type LocalAuthUser,
  type SupabaseIdentity,
  type SupabaseUserRepository,
} from "../src/lib/supabase-auth";

type TestUser = LocalAuthUser & {
  role: string;
  emailVerifiedAt?: Date | null;
  verificationRequired?: boolean;
};

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

class Repository implements SupabaseUserRepository<TestUser> {
  users: TestUser[];
  links = new Map<string, number>();
  created = 0;
  subjectLookups = 0;
  resolutions = 0;

  constructor(users: TestUser[] = []) {
    this.users = users;
  }

  async findById(id: number): Promise<TestUser | undefined> {
    return this.users.find((user) => user.id === id);
  }

  async findByExternalIdentity(
    provider: "supabase",
    subject: string,
  ): Promise<TestUser | undefined> {
    this.subjectLookups += 1;
    const id = this.links.get(`${provider}:${subject}`);
    return this.users.find((user) => user.id === id);
  }

  async resolveSupabaseIdentity({
    identity,
    passwordHash,
  }: {
    identity: SupabaseIdentity;
    passwordHash: string;
  }): Promise<TestUser> {
    this.resolutions += 1;
    const key = `supabase:${identity.id}`;
    const linkedId = this.links.get(key);
    if (linkedId !== undefined) {
      return this.users.find((user) => user.id === linkedId)!;
    }

    let user = this.users.find(
      (candidate) =>
        candidate.email.trim().toLowerCase() === identity.email.toLowerCase(),
    );
    if (user) {
      if (!identity.emailVerified) throw conflict();
      if (
        [...this.links.entries()].some(
          ([link, userId]) => link.startsWith("supabase:") && userId === user!.id,
        )
      ) {
        throw conflict();
      }
      user.isEmailVerified = true;
      user.emailVerifiedAt ??= new Date();
      user.verificationRequired = false;
    } else {
      this.created += 1;
      user = {
        id: 40 + this.created,
        email: identity.email,
        passwordHash,
        role: "user",
        isEmailVerified: identity.emailVerified,
        isRestricted: false,
        restrictionReason: null,
      };
      this.users.push(user);
    }
    this.links.set(key, user.id);
    return user;
  }
}

function conflict(): SupabaseAuthError {
  return new SupabaseAuthError(
    "This Supabase identity conflicts with an existing account",
    409,
    "identity_conflict",
  );
}

function identity(
  overrides: Partial<SupabaseIdentity> = {},
): SupabaseIdentity {
  return {
    id: "supabase-user-id",
    email: "person@example.com",
    name: "Verified Person",
    emailVerified: true,
    ...overrides,
  };
}

function localUser(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: 7,
    email: "person@example.com",
    passwordHash: "$2b$12$existingcredentialhash",
    role: "user",
    isEmailVerified: true,
    isRestricted: false,
    restrictionReason: null,
    ...overrides,
  };
}

test("valid Supabase token is remotely verified and idempotently mapped by subject", async () => {
  const requests: Array<{ url: string; headers: Headers }> = [];
  const verify = (token: string): Promise<SupabaseIdentity> =>
    verifySupabaseAccessToken(token, {
      url: "https://project.supabase.co",
      publishableKey: "publishable-key",
      fetchImpl: async (input, init) => {
        requests.push({
          url: String(input),
          headers: new Headers(init?.headers),
        });
        return response(200, {
          id: "supabase-user-id",
          email: "Person@Example.com",
          email_confirmed_at: "2026-01-01T00:00:00Z",
          user_metadata: { full_name: "Verified Person" },
        });
      },
    });
  const repo = new Repository();
  const dependencies: AccessTokenDependencies<TestUser> = {
    repository: repo,
    verifyCustomToken: () => null,
    verifySupabaseToken: verify,
  };

  const first = await authenticateBearerToken("supabase-token", dependencies);
  const second = await authenticateBearerToken("supabase-token", dependencies);

  assert.equal(second.id, first.id);
  assert.equal(repo.created, 1);
  assert.equal(repo.resolutions, 1);
  assert.equal(requests[0]?.url, "https://project.supabase.co/auth/v1/user");
  assert.equal(requests[0]?.headers.get("apikey"), "publishable-key");
  assert.equal(
    requests[0]?.headers.get("authorization"),
    "Bearer supabase-token",
  );
  assert.match(first.passwordHash, /^\$2[aby]\$\d\d\$/);
  assert.equal(await bcrypt.compare("any-known-password", first.passwordHash), false);
});

test("Supabase identity provisioning creates only the user/link boundary", async () => {
  const repo = new Repository();
  const mapped = await mapSupabaseIdentity(identity(), repo);

  assert.equal(mapped.id, 41);
  assert.equal(repo.created, 1);
  assert.equal(repo.links.get("supabase:supabase-user-id"), mapped.id);
  assert.equal(
    "profiles" in repo,
    false,
    "identity provisioning must not depend on local registration profile creation",
  );
});

test("concrete Supabase provisioning does not create a registration profile", async () => {
  const source = await readFile(
    new URL("../src/lib/auth.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /externalIdentitiesTable,\s*usersTable/);
  assert.doesNotMatch(source, /\bprofilesTable\b/);
  assert.doesNotMatch(source, /insert\(profiles/);
});

test("confirmed Supabase identity atomically claims and verifies one legacy local account", async () => {
  const subject = randomUUID();
  const email = `legacy-${randomUUID()}@example.com`;
  const [legacy] = await db.insert(usersTable).values({
    email,
    passwordHash: "legacy-password-hash",
    name: "Legacy User",
    isEmailVerified: false,
    emailVerifiedAt: null,
    verificationRequired: true,
    isTest: true,
  }).returning();
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const previousFetch = globalThis.fetch;
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  globalThis.fetch = async () => response(200, {
    id: subject,
    email,
    email_confirmed_at: "2026-01-01T00:00:00Z",
  });
  try {
    let nextCalled = false;
    const req = {
      cookies: {},
      headers: { authorization: "Bearer provider-token" },
      log: { error() {}, warn() {} },
    } as any;
    const res = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json() {
        return this;
      },
    } as any;
    await requireAuth(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(req.user.id, legacy.id);

    const [updated] = await db.select().from(usersTable)
      .where(eq(usersTable.id, legacy.id));
    assert.equal(updated.isEmailVerified, true);
    assert.ok(updated.emailVerifiedAt);
    assert.equal(updated.verificationRequired, false);
    const links = await db.select().from(externalIdentitiesTable)
      .where(eq(externalIdentitiesTable.userId, legacy.id));
    assert.equal(links.length, 1);
    assert.equal(links[0]?.subject, subject);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = previousKey;
    await db.delete(usersTable).where(eq(usersTable.id, legacy.id));
  }
});

test("subject-first mapping survives provider email and local password changes", async () => {
  const repo = new Repository();
  const first = await mapSupabaseIdentity(identity(), repo);
  first.email = "old-local@example.com";
  first.passwordHash = await bcrypt.hash("new-local-password", 4);

  const mapped = await mapSupabaseIdentity(
    identity({ email: "new-provider@example.com" }),
    repo,
  );

  assert.equal(mapped, first);
  assert.equal(repo.resolutions, 1);
  assert.equal(mapped.passwordHash, first.passwordHash);
});

test("email linking requires provider confirmation and upgrades one unverified legacy user", async () => {
  for (const localVerified of [true, false]) {
    const repo = new Repository([
      localUser({ isEmailVerified: localVerified }),
    ]);
    await assert.rejects(
      mapSupabaseIdentity(identity({ emailVerified: false }), repo),
      (error: unknown) =>
        error instanceof SupabaseAuthError &&
        error.code === "identity_conflict" &&
        error.status === 409,
    );
    assert.equal(repo.links.size, 0);
  }

  const verified = localUser();
  const repo = new Repository([verified]);
  assert.equal(await mapSupabaseIdentity(identity(), repo), verified);
  assert.equal(repo.created, 0);

  const legacy = localUser({
    isEmailVerified: false,
    emailVerifiedAt: null,
    verificationRequired: true,
  });
  const legacyRepo = new Repository([legacy]);
  assert.equal(await mapSupabaseIdentity(identity(), legacyRepo), legacy);
  assert.equal(legacy.isEmailVerified, true);
  assert.ok(legacy.emailVerifiedAt);
  assert.equal(legacy.verificationRequired, false);
  assert.equal(legacyRepo.links.get("supabase:supabase-user-id"), legacy.id);
});

test("concurrent mapping creates one user/link and conflicting subjects cannot share it", async () => {
  const repo = new Repository();
  const [first, second] = await Promise.all([
    mapSupabaseIdentity(identity(), repo),
    mapSupabaseIdentity(identity(), repo),
  ]);
  assert.equal(first.id, second.id);
  assert.equal(repo.created, 1);
  assert.equal(repo.links.size, 1);

  await assert.rejects(
    mapSupabaseIdentity(identity({ id: "other-subject" }), repo),
    (error: unknown) =>
      error instanceof SupabaseAuthError && error.code === "identity_conflict",
  );
  assert.equal(repo.links.size, 1);
});

test("invalid tokens and provider failures fail closed", async () => {
  const repo = new Repository();
  await assert.rejects(
    authenticateBearerToken("invalid", {
      repository: repo,
      verifyCustomToken: () => null,
      verifySupabaseToken: (token) =>
        verifySupabaseAccessToken(token, {
          url: "https://project.supabase.co",
          publishableKey: "publishable-key",
          fetchImpl: async () => response(401, { message: "invalid JWT" }),
        }),
    }),
    (error: unknown) =>
      error instanceof SupabaseAuthError && error.code === "invalid_token",
  );
  assert.equal(repo.created, 0);

  for (const fetchImpl of [
    async () => response(500, { message: "provider failure" }),
    async () => {
      throw new Error("network unavailable");
    },
  ]) {
    await assert.rejects(
      verifySupabaseAccessToken("token", {
        url: "https://project.supabase.co",
        publishableKey: "publishable-key",
        fetchImpl,
      }),
      (error: unknown) =>
        error instanceof SupabaseAuthError &&
        error.code === "provider_unavailable",
    );
  }
});

test("custom JWT remains supported and Bearer is authoritative over a stale cookie", async () => {
  const user = localUser();
  const repo = new Repository([user]);
  let providerCalled = false;
  const mapped = await authenticateBearerToken("existing-custom-jwt", {
    repository: repo,
    verifyCustomToken: () => ({ userId: user.id, role: user.role }),
    verifySupabaseToken: async () => {
      providerCalled = true;
      throw new Error("must not run");
    },
  });
  assert.equal(mapped, user);
  assert.equal(providerCalled, false);

  assert.deepEqual(
    selectRequestAuthToken("stale-cookie", "Bearer fresh-bearer"),
    { token: "fresh-bearer", source: "bearer" },
  );
  assert.deepEqual(
    selectRequestAuthToken("stale-cookie", "bEaReR fresh-bearer"),
    { token: "fresh-bearer", source: "bearer" },
  );
  assert.deepEqual(selectRequestAuthToken("stale-cookie", "Bearer "), {
    token: undefined,
    source: "bearer",
  });
  for (const malformed of ["Basic credentials", "Bearer", " Bearer token", ""]) {
    assert.deepEqual(selectRequestAuthToken("valid-cookie", malformed), {
      token: undefined,
      source: "bearer",
    });
  }
  assert.deepEqual(selectRequestAuthToken("custom-cookie", undefined), {
    token: "custom-cookie",
    source: "cookie",
  });
});
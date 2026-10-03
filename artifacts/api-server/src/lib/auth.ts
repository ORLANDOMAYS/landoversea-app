import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { externalIdentitiesTable, usersTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import {
  mapSupabaseIdentity,
  SupabaseAuthError,
  verifySupabaseAccessToken,
  type LocalAuthUser,
  type SupabaseUserRepository,
} from "./supabase-auth";

const SECRET = process.env.SESSION_SECRET;
if (!SECRET) throw new Error("SESSION_SECRET must be set");

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(userId: number, role: string): string {
  return jwt.sign({ userId, role }, SECRET!, { expiresIn: "30d" });
}

export function verifyToken(token: string): { userId: number; role: string } | null {
  try {
    return jwt.verify(token, SECRET!) as { userId: number; role: string };
  } catch {
    return null;
  }
}

type User = typeof usersTable.$inferSelect;

const userRepository: SupabaseUserRepository<User> & {
  findById(id: number): Promise<User | undefined>;
} = {
  async findById(id) {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    return user;
  },
  async findByExternalIdentity(provider, subject) {
    const [user] = await db
      .select()
      .from(externalIdentitiesTable)
      .innerJoin(
        usersTable,
        eq(externalIdentitiesTable.userId, usersTable.id),
      )
      .where(
        and(
          eq(externalIdentitiesTable.provider, provider),
          eq(externalIdentitiesTable.subject, subject),
        ),
      )
      .limit(1);
    return user?.users;
  },
  async resolveSupabaseIdentity({ identity, passwordHash }) {
    const provider = "supabase" as const;
    const normalizedEmail = identity.email.trim().toLowerCase();
    try {
      return await db.transaction(async (tx) => {
        // Serialize both the immutable subject and normalized-email decision.
        // The database uniqueness constraints remain the final backstop.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${"external:" + provider + ":" + identity.id})), pg_advisory_xact_lock(hashtext(${"external-email:" + normalizedEmail}))`,
        );

        const [linked] = await tx
          .select()
          .from(externalIdentitiesTable)
          .innerJoin(
            usersTable,
            eq(externalIdentitiesTable.userId, usersTable.id),
          )
          .where(
            and(
              eq(externalIdentitiesTable.provider, provider),
              eq(externalIdentitiesTable.subject, identity.id),
            ),
          )
          .limit(1);
        if (linked) return linked.users;

        const matchingUsers = await tx
          .select()
          .from(usersTable)
          .where(sql`lower(trim(${usersTable.email})) = ${normalizedEmail}`)
          .limit(2);
        if (matchingUsers.length > 1) {
          throw identityConflict();
        }

        const localUser = matchingUsers[0];
        if (localUser) {
          // A provider-confirmed address is sufficient proof to upgrade the
          // one matching legacy account. Unconfirmed provider identities must
          // never claim an existing local address.
          if (!identity.emailVerified) {
            throw identityConflict();
          }
          const [otherLink] = await tx
            .select({ id: externalIdentitiesTable.id })
            .from(externalIdentitiesTable)
            .where(
              and(
                eq(externalIdentitiesTable.provider, provider),
                eq(externalIdentitiesTable.userId, localUser.id),
              ),
            )
            .limit(1);
          if (otherLink) throw identityConflict();

          await tx.insert(externalIdentitiesTable).values({
            provider,
            subject: identity.id,
            userId: localUser.id,
          });
          const [verifiedUser] = await tx
            .update(usersTable)
            .set({
              isEmailVerified: true,
              emailVerifiedAt: localUser.emailVerifiedAt ?? new Date(),
              verificationRequired: false,
            })
            .where(eq(usersTable.id, localUser.id))
            .returning();
          if (!verifiedUser) {
            throw new Error("Supabase identity link update returned no user");
          }
          return verifiedUser;
        }

        const [created] = await tx
          .insert(usersTable)
          .values({
            email: normalizedEmail,
            passwordHash,
            name: identity.name,
            role: "user",
            isEmailVerified: identity.emailVerified,
            emailVerifiedAt: identity.emailVerified ? new Date() : null,
            verificationRequired: false,
          })
          .returning();
        if (!created) {
          throw new Error("Supabase user insert returned no record");
        }
        await tx.insert(externalIdentitiesTable).values({
          provider,
          subject: identity.id,
          userId: created.id,
        });
        return created;
      });
    } catch (error: unknown) {
      if (
        error instanceof SupabaseAuthError ||
        databaseErrorCode(error) !== "23505"
      ) {
        throw error;
      }
      throw identityConflict();
    }
  },
};

function identityConflict(): SupabaseAuthError {
  return new SupabaseAuthError(
    "This Supabase identity conflicts with an existing account",
    409,
    "identity_conflict",
  );
}

function databaseErrorCode(error: unknown): string | undefined {
  let current = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const value = current as {
      code?: unknown;
      cause?: unknown;
      original?: unknown;
      driverError?: unknown;
    };
    if (typeof value.code === "string") return value.code;
    current = value.cause ?? value.original ?? value.driverError;
  }
  return undefined;
}

export interface AccessTokenDependencies<TUser extends LocalAuthUser> {
  repository: SupabaseUserRepository<TUser> & {
    findById(id: number): Promise<TUser | undefined>;
  };
  verifyCustomToken(token: string): { userId: number; role: string } | null;
  verifySupabaseToken(token: string): ReturnType<typeof verifySupabaseAccessToken>;
}

export interface SupabaseRequestAuth {
  provider: "supabase";
  subject: string;
  accessToken: string;
}

/**
 * Returns the verified provider context used by downstream user-scoped calls.
 * The property is deliberately non-enumerable so request/log serializers do
 * not accidentally include the raw access token.
 */
export function getSupabaseRequestAuth(req: Request): SupabaseRequestAuth | undefined {
  return (req as Request & { supabaseAuth?: SupabaseRequestAuth }).supabaseAuth;
}

function attachSupabaseRequestAuth(req: Request, auth: SupabaseRequestAuth): void {
  Object.defineProperty(req, "supabaseAuth", {
    value: auth,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

export async function authenticateBearerToken<TUser extends LocalAuthUser>(
  token: string,
  dependencies: AccessTokenDependencies<TUser>,
): Promise<TUser> {
  const customPayload = dependencies.verifyCustomToken(token);
  if (customPayload) {
    const user = await dependencies.repository.findById(customPayload.userId);
    if (!user) {
      throw new SupabaseAuthError("User not found", 401, "invalid_token");
    }
    return user;
  }
  const identity = await dependencies.verifySupabaseToken(token);
  return mapSupabaseIdentity(identity, dependencies.repository);
}

export function selectRequestAuthToken(
  cookie: string | undefined,
  authorization: string | undefined,
): { token: string | undefined; source: "bearer" | "cookie" | undefined } {
  if (authorization !== undefined) {
    const match = authorization.match(/^Bearer(?:[ \t]+)(.*)$/i);
    const bearer = match?.[1]?.trim();
    return { token: bearer || undefined, source: "bearer" };
  }
  if (cookie) return { token: cookie, source: "cookie" };
  return { token: undefined, source: undefined };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const cookie = req.cookies?.["los_token"];
  const selected = selectRequestAuthToken(cookie, req.headers.authorization);
  const token = selected.token;

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  let user: User;
  let supabaseAuth: SupabaseRequestAuth | undefined;
  try {
    if (selected.source === "cookie") {
      const payload = verifyToken(token);
      if (!payload) {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
      }
      const localUser = await userRepository.findById(payload.userId);
      if (!localUser) {
        res.status(401).json({ error: "User not found" });
        return;
      }
      user = localUser;
    } else {
      // A Bearer credential is authoritative even when a valid cookie is also
      // present. Custom JWT Bearer credentials retain legacy behavior and must
      // never be forwarded to Supabase as an RLS credential.
      const customPayload = verifyToken(token);
      if (customPayload) {
        const localUser = await userRepository.findById(customPayload.userId);
        if (!localUser) {
          res.status(401).json({ error: "User not found" });
          return;
        }
        user = localUser;
      } else {
        const identity = await verifySupabaseAccessToken(token);
        user = await mapSupabaseIdentity(identity, userRepository);
        supabaseAuth = {
          provider: "supabase",
          subject: identity.id,
          accessToken: token,
        };
      }
    }
  } catch (error: unknown) {
    if (error instanceof SupabaseAuthError) {
      if (error.status >= 500) {
        req.log.error(
          { authErrorCode: error.code },
          "Supabase bearer authentication failed",
        );
      } else if (error.code === "identity_conflict") {
        req.log.warn(
          { authErrorCode: error.code },
          "Rejected conflicting Supabase identity",
        );
      }
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log.error(
      {
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
      },
      "Bearer authentication failed",
    );
    res.status(503).json({ error: "Authentication is temporarily unavailable" });
    return;
  }

  if (user.isRestricted) {
    res.status(403).json({ error: "Account restricted", reason: user.restrictionReason });
    return;
  }

  (req as any).user = user;
  if (supabaseAuth) attachSupabaseRequestAuth(req, supabaseAuth);
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, async () => {
    const user = (req as any).user;
    if (user.role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  });
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie("los_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: "/",
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie("los_token", { path: "/" });
}

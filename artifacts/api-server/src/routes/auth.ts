import { Router, type IRouter } from "express";
import {
  db,
  usersTable,
  profilesTable,
  profilePhotosTable,
  verificationRequestsTable,
  passwordResetTokensTable,
  emailVerificationTokensTable,
  accountDeletionRequestsTable,
  coachesTable,
  coachCredentialsTable,
} from "@workspace/db";
import { and, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import {
  hashPassword,
  verifyPassword,
  signToken,
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
  verifyToken,
} from "../lib/auth";
import { isEmailConfigured, sendEmail } from "../lib/email";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();

export async function deleteOwnedObjectWithRetry(
  storage: Pick<ObjectStorageService, "deleteObjectEntityFile">,
  objectPath: string,
  attempts = 3,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await storage.deleteObjectEntityFile(objectPath);
      return;
    } catch (error: unknown) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function collectOwnedObjectPaths(executor: any, userId: number): Promise<Set<string>> {
  const ownedObjectPaths = new Set<string>();
  const photos = await executor
    .select({ url: profilePhotosTable.url })
    .from(profilePhotosTable)
    .where(eq(profilePhotosTable.userId, userId));
  for (const photo of photos) {
    if (photo.url) ownedObjectPaths.add(photo.url);
  }

  const [profile] = await executor
    .select({ voiceIntroUrl: profilesTable.voiceIntroUrl })
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId))
    .limit(1);
  if (profile?.voiceIntroUrl) ownedObjectPaths.add(profile.voiceIntroUrl);

  const verificationRows = await executor
    .select({ selfieUrl: verificationRequestsTable.selfieUrl })
    .from(verificationRequestsTable)
    .where(eq(verificationRequestsTable.userId, userId));
  for (const row of verificationRows) {
    if (row.selfieUrl) ownedObjectPaths.add(row.selfieUrl);
  }

  const credentials = await executor
    .select({ objectPath: coachCredentialsTable.objectPath })
    .from(coachCredentialsTable)
    .innerJoin(coachesTable, eq(coachCredentialsTable.coachId, coachesTable.id))
    .where(eq(coachesTable.userId, userId));
  for (const credential of credentials) {
    if (credential.objectPath) ownedObjectPaths.add(credential.objectPath);
  }
  return ownedObjectPaths;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUMMY_PASSWORD_HASH =
  "$2b$12$/.vZ4sYa7VskU6usPpG2zecPBCoaHbsr5jlJ46H7j303LdeF16K/2";

// Password reset token model: short-lived, one-time, hash-at-rest.
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const RESET_TOKEN_BYTES = 32;
// A password-reset email cannot be re-requested more often than this window.
// Enforced silently so the public response stays generic (non-enumerating).
const RESET_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const GENERIC_RESET_MESSAGE =
  "If an account exists for that email, password reset instructions have been sent.";

/**
 * Tokens are only ever returned to a caller in an explicit test mode. In every
 * other environment the raw token exists only long enough to be handed to the
 * email provider and is never persisted or returned.
 */
export function isRecoveryTestMode(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    (process.env.NODE_ENV !== "production" &&
      process.env.AUTH_RECOVERY_TEST_MODE === "1")
  );
}

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Email verification token model: short-lived, one-time, hash-at-rest. Uses the
// same recovery-test-mode gate so tests can obtain the raw token deterministically.
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
// A resend cannot be requested more often than this window (anti-abuse / cooldown).
const VERIFY_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const VERIFY_MAX_FAILED_ATTEMPTS = 5;
function hashVerificationToken(token: string): string {
  const pepper = process.env.SESSION_SECRET;
  if (!pepper) throw new Error("SESSION_SECRET must be set");
  // A six-digit code has a deliberately small input space. A keyed HMAC, not
  // a plain digest, keeps a database-only compromise from enabling offline
  // enumeration of all one million possible codes.
  return createHmac("sha256", pepper).update(token).digest("hex");
}

/**
 * A token is inserted as pending, then activated only after either an HTTPS
 * provider accepts the message or an explicit non-production fallback exposes
 * the code. Failed delivery deletes only the pending token, preserving the
 * previous valid code and its original cooldown.
 */
type VerificationDelivery = "email" | "development" | "unavailable";
const VERIFICATION_ISSUANCE_LOCK_NAMESPACE = 19_062_026;

async function issueVerificationEmail(
  userId: number,
  email: string,
  log: { error: (obj: unknown, msg?: string) => void },
  options: { enforceCooldown?: boolean } = {},
): Promise<{
  exposedToken?: string;
  sent: boolean;
  delivery: VerificationDelivery;
  retryAfter?: number;
  failureReason?: "unavailable" | "error";
  rateLimited?: true;
}> {
  return db.transaction(async (tx) => {
    // Serialize issuance across all API instances. The cooldown recheck and the
    // provider call stay under the same per-user lock, so two accepted sends can
    // never race each other into an unusable newest-token state.
    await tx.execute(
      sql`select pg_advisory_xact_lock(${VERIFICATION_ISSUANCE_LOCK_NAMESPACE}, ${userId})`,
    );

    if (options.enforceCooldown) {
      const [latest] = await tx
        .select({
          deliveryAcceptedAt:
            emailVerificationTokensTable.deliveryAcceptedAt,
          lockedAt: emailVerificationTokensTable.lockedAt,
        })
        .from(emailVerificationTokensTable)
        .where(
          and(
            eq(emailVerificationTokensTable.userId, userId),
            isNotNull(emailVerificationTokensTable.deliveryAcceptedAt),
          ),
        )
        .orderBy(desc(emailVerificationTokensTable.deliveryAcceptedAt))
        .limit(1);
      if (
        latest?.deliveryAcceptedAt &&
        latest.lockedAt === null &&
        Date.now() - latest.deliveryAcceptedAt.getTime() <
          VERIFY_RESEND_COOLDOWN_MS
      ) {
        return {
          sent: false,
          delivery: "unavailable" as const,
          retryAfter: Math.ceil(
            (VERIFY_RESEND_COOLDOWN_MS -
              (Date.now() - latest.deliveryAcceptedAt.getTime())) /
              1000,
          ),
          rateLimited: true as const,
        };
      }
    }

    const rawToken = generateVerificationCode();
    const tokenHash = hashVerificationToken(rawToken);
    const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);
    const [pendingToken] = await tx
      .insert(emailVerificationTokensTable)
      .values({
        userId,
        tokenHash,
        expiresAt,
      })
      .returning({ id: emailVerificationTokensTable.id });
    if (!pendingToken) {
      throw new Error("Verification token insert returned no record");
    }

    let delivery: VerificationDelivery = "unavailable";
    let failureReason: "unavailable" | "error" | undefined;
    const useReservedTestAddress =
      isRecoveryTestMode() && email.endsWith("@example.com");

    if (useReservedTestAddress) {
      delivery = "development";
    } else {
      const result = await sendEmail({
        to: email,
        subject: "Verify your LandOverSEA email",
        text: `Welcome to LandOverSEA! Use this code within 24 hours to verify your email address:\n\n${rawToken}\n\nIf you did not create this account, you can safely ignore this email.`,
      });
      if (result.ok) {
        delivery = "email";
      } else {
        failureReason = result.reason;
        log.error(
          { provider: result.provider },
          "Verification email failed to send",
        );
        if (isRecoveryTestMode()) {
          delivery = "development";
        }
      }
    }

    if (delivery === "unavailable") {
      await tx
        .delete(emailVerificationTokensTable)
        .where(eq(emailVerificationTokensTable.id, pendingToken.id));
      return {
        sent: false,
        delivery,
        failureReason: failureReason ?? "unavailable",
      };
    }

    const acceptedAt = new Date();
    await tx
      .update(emailVerificationTokensTable)
      .set({ usedAt: acceptedAt })
      .where(
        and(
          eq(emailVerificationTokensTable.userId, userId),
          ne(emailVerificationTokensTable.id, pendingToken.id),
          isNull(emailVerificationTokensTable.usedAt),
        ),
      );
    const activated = await tx
      .update(emailVerificationTokensTable)
      .set({
        deliveryAcceptedAt: acceptedAt,
        usedAt: null,
        lockedAt: null,
        failedAttempts: 0,
      })
      .where(eq(emailVerificationTokensTable.id, pendingToken.id))
      .returning({ id: emailVerificationTokensTable.id });
    if (activated.length === 0) {
      throw new Error("Verification token activation returned no record");
    }

    return {
      exposedToken: delivery === "development" ? rawToken : undefined,
      sent: delivery === "email",
      delivery,
      retryAfter: Math.ceil(VERIFY_RESEND_COOLDOWN_MS / 1000),
    };
  });
}

export function generateVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

type RegistrationInput = {
  email: string;
  password: string;
  name: string;
  acceptedAgeRequirement: true;
};

type LoginInput = {
  email: string;
  password: string;
};

const SOCIAL_PROVIDERS = {
  apple: {
    clientId: () => process.env.APPLE_CLIENT_ID,
    secret: () => process.env.APPLE_CLIENT_SECRET,
  },
  google: {
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    secret: () => process.env.GOOGLE_CLIENT_SECRET,
  },
  facebook: {
    clientId: () => process.env.FACEBOOK_CLIENT_ID,
    secret: () => process.env.FACEBOOK_CLIENT_SECRET,
  },
} as const;

export function socialProviderAvailable(provider: keyof typeof SOCIAL_PROVIDERS): boolean {
  void provider;
  // Credentials alone are not a usable authentication implementation.
  // Callback/code exchange, state validation, account linking, and session
  // issuance must all exist before any provider can be advertised.
  return false;
}

export function socialProviderUnavailableReason(
  provider: keyof typeof SOCIAL_PROVIDERS,
): "credentials_unavailable" | "callback_unavailable" {
  const config = SOCIAL_PROVIDERS[provider];
  return config.clientId() && config.secret()
    ? "callback_unavailable"
    : "credentials_unavailable";
}

router.get("/auth/providers", (_req, res): void => {
  res.json({
    apple: { available: false, reason: socialProviderUnavailableReason("apple") },
    google: { available: false, reason: socialProviderUnavailableReason("google") },
    facebook: { available: false, reason: socialProviderUnavailableReason("facebook") },
    email: { available: true, reason: null },
  });
});

router.post("/auth/social/:provider/start", (req, res): void => {
  const provider = String(req.params.provider) as keyof typeof SOCIAL_PROVIDERS;
  if (!(provider in SOCIAL_PROVIDERS)) {
    res.status(400).json({ error: "Unsupported authentication provider" });
    return;
  }
  res.status(503).json({
    provider,
    available: false,
    reason: socialProviderUnavailableReason(provider),
    error: "This sign-in provider is not ready.",
  });
});

function getNestedErrorCode(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth < 8 && current && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current !== "object") return undefined;

    const candidate = current as {
      code?: unknown;
      cause?: unknown;
      original?: unknown;
      driverError?: unknown;
    };

    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause ?? candidate.original ?? candidate.driverError;
  }

  return undefined;
}

function parseRegistrationInput(body: unknown):
  | { ok: true; value: RegistrationInput }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "A valid registration request is required" };
  }

  const input = body as Record<string, unknown>;
  if (typeof input.email !== "string" || input.email.trim() === "") {
    return { ok: false, error: "Email is required" };
  }
  if (typeof input.password !== "string" || input.password === "") {
    return { ok: false, error: "Password is required" };
  }
  if (typeof input.name !== "string" || input.name.trim() === "") {
    return { ok: false, error: "Name is required" };
  }
  if (input.acceptedAgeRequirement !== true) {
    return {
      ok: false,
      error: "acceptedAgeRequirement must be true to confirm you are 18 or older",
    };
  }

  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const password = input.password;

  if (email.length > 320 || !EMAIL_REGEX.test(email)) {
    return { ok: false, error: "Invalid email address" };
  }
  if (name.length < 2) {
    return { ok: false, error: "Name must be at least 2 characters" };
  }
  if (name.length > 100) {
    return { ok: false, error: "Name must be 100 characters or fewer" };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters" };
  }
  if (Buffer.byteLength(password, "utf8") > 72) {
    return { ok: false, error: "Password must be 72 bytes or fewer" };
  }

  return {
    ok: true,
    value: { email, password, name, acceptedAgeRequirement: true },
  };
}

function parseLoginInput(body: unknown):
  | { ok: true; value: LoginInput }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "A valid login request is required" };
  }

  const input = body as Record<string, unknown>;
  if (typeof input.email !== "string" || input.email.trim() === "") {
    return { ok: false, error: "Email is required" };
  }
  if (typeof input.password !== "string" || input.password === "") {
    return { ok: false, error: "Password is required" };
  }

  const email = input.email.trim().toLowerCase();
  if (email.length > 320 || !EMAIL_REGEX.test(email)) {
    return { ok: false, error: "Invalid email address" };
  }

  return { ok: true, value: { email, password: input.password } };
}

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = parseRegistrationInput(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const { email, password, name } = parsed.value;

  let user: typeof usersTable.$inferSelect;
  try {
    const passwordHash = await hashPassword(password);
    user = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(usersTable)
        .values({
          email,
          passwordHash,
          name,
          verificationRequired: true,
          ageRequirementAcceptedAt: new Date(),
        })
        .returning();

      if (!inserted) {
        throw new Error("User insert returned no record");
      }

      await tx.insert(profilesTable).values({
        userId: inserted.id,
        name,
      });

      return inserted;
    });
  } catch (error: unknown) {
    const databaseCode = getNestedErrorCode(error);
    if (databaseCode === "23505") {
      res.status(409).json({ error: "Email already in use" });
    } else {
      req.log.error(
        {
          databaseCode,
          errorType:
            error instanceof Error ? error.constructor.name : typeof error,
        },
        "Registration transaction failed",
      );
      res.status(503).json({
        error: "Unable to create your account right now. Please try again.",
      });
    }
    return;
  }

  // Issue and dispatch a verification email when a provider is configured.
  // Verification is not a hard gate, so a delivery failure must not block the
  // account from being created or the caller from being signed in.
  let verificationToken: string | undefined;
  let verificationEmailSent = false;
  let verificationDelivery: VerificationDelivery = "unavailable";
  let verificationRetryAfter: number | undefined;
  let verificationMessage =
    "Your account was created, but a verification email could not be sent. You can retry now.";
  try {
    const issued = await issueVerificationEmail(user.id, user.email, req.log);
    verificationToken = issued.exposedToken;
    verificationEmailSent = issued.sent;
    verificationDelivery = issued.delivery;
    verificationRetryAfter = issued.retryAfter;
    verificationMessage =
      issued.delivery === "email"
        ? "A verification code was sent to your email."
        : issued.delivery === "development"
          ? "Email delivery was unavailable, so a development-only verification code was generated."
          : "Your account was created, but a verification email could not be sent. You can retry now.";
  } catch (error: unknown) {
    req.log.error(
      {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      },
      "Failed to issue verification email during registration",
    );
  }

  const token = signToken(user.id, user.role);
  setAuthCookie(res, token);

  const payload: Record<string, unknown> = {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isProfileComplete: user.isProfileComplete,
      isEmailVerified: user.isEmailVerified,
      verificationRequired: user.verificationRequired,
      isPremium: user.isPremium,
      createdAt: user.createdAt,
    },
    verificationEmailSent,
    verificationDelivery,
    verificationMessage,
  };
  if (verificationRetryAfter !== undefined) {
    payload.retryAfter = verificationRetryAfter;
  }
  if (verificationToken) {
    payload.verificationCode = verificationToken;
    payload.verificationToken = verificationToken;
  }
  res.status(201).json(payload);
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = parseLoginInput(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const { email, password } = parsed.value;

  let user: typeof usersTable.$inferSelect | undefined;
  try {
    const [found] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    user = found;
  } catch (error: unknown) {
    req.log.error(
      {
        databaseCode: getNestedErrorCode(error),
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
      },
      "Login lookup failed",
    );
    res.status(503).json({ error: "Unable to sign in right now. Please try again." });
    return;
  }

  let valid: boolean;
  try {
    valid = await verifyPassword(
      password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
  } catch (error: unknown) {
    req.log.error(
      {
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
      },
      "Password verification failed",
    );
    res.status(503).json({ error: "Unable to sign in right now. Please try again." });
    return;
  }

  if (!user || !valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  if (user.isRestricted) {
    res.status(403).json({ error: "Account restricted", reason: user.restrictionReason });
    return;
  }

  const token = signToken(user.id, user.role);
  setAuthCookie(res, token);

  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isProfileComplete: user.isProfileComplete,
      isEmailVerified: user.isEmailVerified,
      verificationRequired: user.verificationRequired,
      isPremium: user.isPremium,
      createdAt: user.createdAt,
    },
  });
});

/**
 * Native clients cannot rely on browser-only HttpOnly cookie persistence.
 * This endpoint performs the same credential checks as web login and returns a
 * short response containing the signed bearer token for secure device storage.
 */
router.post("/auth/mobile/session", async (req, res): Promise<void> => {
  const parsed = parseLoginInput(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const { email, password } = parsed.value;

  let user: typeof usersTable.$inferSelect | undefined;
  try {
    const [found] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    user = found;
  } catch (error: unknown) {
    req.log.error(
      {
        databaseCode: getNestedErrorCode(error),
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
      },
      "Mobile session lookup failed",
    );
    res.status(503).json({
      error: "Unable to sign in right now. Please try again.",
    });
    return;
  }

  let valid: boolean;
  try {
    valid = await verifyPassword(
      password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
  } catch (error: unknown) {
    req.log.error(
      {
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
      },
      "Mobile session password verification failed",
    );
    res.status(503).json({
      error: "Unable to sign in right now. Please try again.",
    });
    return;
  }

  if (!user || !valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  if (user.isRestricted) {
    res
      .status(403)
      .json({ error: "Account restricted", reason: user.restrictionReason });
    return;
  }

  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isProfileComplete: user.isProfileComplete,
      isEmailVerified: user.isEmailVerified,
      verificationRequired: user.verificationRequired,
      isPremium: user.isPremium,
      createdAt: user.createdAt,
    },
    token: signToken(user.id, user.role),
  });
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  clearAuthCookie(res);
  res.json({ message: "Logged out" });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isProfileComplete: user.isProfileComplete,
    isEmailVerified: user.isEmailVerified,
    verificationRequired: user.verificationRequired,
    isPremium: user.isPremium,
    createdAt: user.createdAt,
  });
});

const GENERIC_DELETION_REQUEST_MESSAGE =
  "If an account exists for that email, the deletion request has been recorded.";

router.post("/auth/account-deletion-requests", async (req, res): Promise<void> => {
  const email =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  // Invalid input receives the same accepted response to avoid turning this
  // public assistance endpoint into an account discovery oracle.
  if (!email || email.length > 320 || !EMAIL_REGEX.test(email)) {
    res.status(202).json({ message: GENERIC_DELETION_REQUEST_MESSAGE });
    return;
  }

  const pepper = process.env.SESSION_SECRET;
  if (!pepper) {
    req.log.error("SESSION_SECRET unavailable while hashing deletion request");
    res.status(503).json({ error: "Unable to process request. Please try again." });
    return;
  }
  const emailHash = hashDeletionRequestEmail(email, pepper);
  try {
    const [knownUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    await db.insert(accountDeletionRequestsTable).values({
      userId: knownUser?.id ?? null,
      emailHash,
    });
  } catch (error: unknown) {
    req.log.error(
      { errorType: error instanceof Error ? error.constructor.name : typeof error },
      "Failed to persist account deletion request",
    );
    res.status(503).json({ error: "Unable to process request. Please try again." });
    return;
  }
  res.status(202).json({ message: GENERIC_DELETION_REQUEST_MESSAGE });
});

export function hashDeletionRequestEmail(email: string, pepper: string): string {
  return createHmac("sha256", pepper).update(email.trim().toLowerCase()).digest("hex");
}

router.delete("/auth/delete-account", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const confirmPassword =
    typeof body.confirmPassword === "string" ? body.confirmPassword : "";

  if (confirmPassword === "") {
    res
      .status(400)
      .json({ error: "confirmPassword is required to delete your account" });
    return;
  }

  let dbUser: typeof usersTable.$inferSelect | undefined;
  try {
    const [found] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .limit(1);
    dbUser = found;
  } catch (error: unknown) {
    req.log.error(
      {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      },
      "Delete-account lookup failed",
    );
    res.status(503).json({ error: "Unable to process request. Please try again." });
    return;
  }

  if (!dbUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  let valid: boolean;
  try {
    valid = await verifyPassword(confirmPassword, dbUser.passwordHash);
  } catch (error: unknown) {
    req.log.error(
      {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      },
      "Delete-account password verification failed",
    );
    res.status(503).json({ error: "Unable to process request. Please try again." });
    return;
  }

  if (!valid) {
    // Wrong password: the account and all its data must be fully preserved.
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  // Gather the user's own private object-storage files BEFORE deleting the DB
  // rows (deletion cascades remove the rows and lose the paths otherwise).
  // Only files exclusively owned by this user are collected: profile photos,
  // the voice intro, and the verification selfie. Shared conversation
  // attachments are intentionally NOT touched — they belong to a conversation
  // that may still be accessible to other participants, and other users may
  // own attachments in those same conversations.
  let ownedObjectPaths: Set<string>;
  try {
    ownedObjectPaths = await collectOwnedObjectPaths(db, dbUser.id);
  } catch (error: unknown) {
    req.log.error(
      {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      },
      "Failed to enumerate owned object-storage files during account deletion",
    );
    res.status(503).json({ error: "Unable to process request. Please try again." });
    return;
  }

  // Current FK cascades remove authored messages, coach profiles and
  // credentials, and bookings. Payment/refund/transfer metadata attached to
  // those bookings also cascades. SET NULL references (conversation ownership,
  // credential reviewers, moderation reviewers) remain without their user
  // reference. This is current deletion behavior, not a retention policy.
  try {
    await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(usersTable)
        .where(eq(usersTable.id, dbUser!.id))
        .returning({ id: usersTable.id });
      if (deleted.length === 0) {
        throw new Error("ACCOUNT_ALREADY_DELETED");
      }
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "ACCOUNT_ALREADY_DELETED") {
      // Nothing left to delete; treat as success and clear the session.
      clearAuthCookie(res);
      res.json({ message: "Account deleted" });
      return;
    }
    req.log.error(
      {
        databaseCode: getNestedErrorCode(error),
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      },
      "Account deletion transaction failed",
    );
    res.status(503).json({ error: "Unable to delete your account right now. Please try again." });
    return;
  }

  // Best-effort object-storage cleanup AFTER the authoritative DB deletion has
  // committed. A storage failure here must not resurrect the account, so it is
  // logged and swallowed rather than surfaced as an error.
  if (ownedObjectPaths.size > 0) {
    const storage = new ObjectStorageService();
    await Promise.all(
      Array.from(ownedObjectPaths).map(async (rawPath) => {
        try {
          const normalized = storage.normalizeObjectEntityPath(rawPath);
          if (!normalized.startsWith("/objects/")) return;
          await deleteOwnedObjectWithRetry(storage, normalized);
        } catch (error: unknown) {
          req.log.error(
            {
              errorType:
                error instanceof Error ? error.constructor.name : typeof error,
            },
            "Failed to delete owned object-storage file during account deletion",
          );
        }
      }),
    );
  }

  clearAuthCookie(res);
  res.json({ message: "Account deleted" });
});

router.post("/auth/change-password", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "currentPassword and newPassword are required" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }
  if (newPassword.length > 72) {
    res.status(400).json({ error: "New password must be 72 characters or fewer" });
    return;
  }
  if (newPassword === currentPassword) {
    res.status(400).json({ error: "New password must differ from current password" });
    return;
  }

  let dbUser: typeof usersTable.$inferSelect;
  try {
    const [found] = await db.select().from(usersTable).where(eq(usersTable.id, user.id)).limit(1);
    if (!found) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    dbUser = found;
  } catch {
    res.status(500).json({ error: "Unexpected error, please try again" });
    return;
  }

  const valid = await verifyPassword(currentPassword, dbUser.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  try {
    const newHash = await hashPassword(newPassword);
    await db.update(usersTable).set({ passwordHash: newHash }).where(eq(usersTable.id, user.id));
  } catch {
    res.status(500).json({ error: "Failed to update password, please try again" });
    return;
  }

  res.clearCookie('los_token', { path: '/' });
  res.json({ message: 'Password changed. Please log in again.' });
});

router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  // Validate shape but keep the public response generic to resist enumeration.
  if (rawEmail === "" || rawEmail.length > 320 || !EMAIL_REGEX.test(rawEmail)) {
    res.status(200).json({ message: GENERIC_RESET_MESSAGE });
    return;
  }

  const deliveryConfigured = await isEmailConfigured();
  const testMode = isRecoveryTestMode();

  // When no trusted delivery channel exists, do not mint or persist a token.
  // Surface an explicit unavailable-delivery state instead of a fake success.
  if (!deliveryConfigured && !testMode) {
    res.status(503).json({
      error:
        "Password reset is temporarily unavailable because no email delivery channel is configured.",
      deliveryAvailable: false,
    });
    return;
  }

  let user: typeof usersTable.$inferSelect | undefined;
  try {
    const [found] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, rawEmail))
      .limit(1);
    user = found;
  } catch (error: unknown) {
    req.log.error(
      {
        databaseCode: getNestedErrorCode(error),
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      },
      "Forgot-password lookup failed",
    );
    res.status(503).json({ error: "Unable to process request. Please try again." });
    return;
  }

  let exposedToken: string | undefined;

  // Only mint a token when the account exists; response stays generic either way.
  if (user && !user.isRestricted) {
    // Silent per-user cooldown: if a reset token was minted very recently, do
    // not mint another. The response remains a generic 200 so this cannot be
    // used to enumerate accounts or their request timing.
    try {
      const [recent] = await db
        .select({ createdAt: passwordResetTokensTable.createdAt })
        .from(passwordResetTokensTable)
        .where(eq(passwordResetTokensTable.userId, user.id))
        .orderBy(desc(passwordResetTokensTable.createdAt))
        .limit(1);
      if (
        recent &&
        Date.now() - recent.createdAt.getTime() < RESET_RESEND_COOLDOWN_MS
      ) {
        res.status(200).json({ message: GENERIC_RESET_MESSAGE });
        return;
      }
    } catch (error: unknown) {
      req.log.error(
        {
          errorType:
            error instanceof Error ? error.constructor.name : typeof error,
        },
        "Forgot-password cooldown check failed",
      );
      res.status(503).json({ error: "Unable to process request. Please try again." });
      return;
    }

    const rawToken = randomBytes(RESET_TOKEN_BYTES).toString("hex");
    const tokenHash = hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    try {
      // Invalidate previously issued, unused tokens for this user, then insert.
      await db.transaction(async (tx) => {
        await tx
          .update(passwordResetTokensTable)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(passwordResetTokensTable.userId, user!.id),
              isNull(passwordResetTokensTable.usedAt),
            ),
          );
        await tx.insert(passwordResetTokensTable).values({
          userId: user!.id,
          tokenHash,
          expiresAt,
        });
      });
    } catch (error: unknown) {
      req.log.error(
        {
          errorType:
            error instanceof Error ? error.constructor.name : typeof error,
        },
        "Failed to persist password reset token",
      );
      res.status(503).json({ error: "Unable to process request. Please try again." });
      return;
    }

    if (deliveryConfigured) {
      const result = await sendEmail({
        to: user.email,
        subject: "Reset your LandOverSEA password",
        text: `We received a request to reset your LandOverSEA password. Use this code within 30 minutes to continue:\n\n${rawToken}\n\nIf you did not request this, you can safely ignore this email.`,
      });
      if (!result.ok && result.reason === "error") {
        req.log.error({ provider: result.provider }, "Password reset email failed to send");
      }
    }

    if (testMode) {
      exposedToken = rawToken;
    }
  }

  const payload: Record<string, unknown> = { message: GENERIC_RESET_MESSAGE };
  if (exposedToken) {
    payload.code = exposedToken;
    payload.token = exposedToken;
  }
  res.status(200).json(payload);
});

router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (token === "") {
    res.status(400).json({ error: "A reset token is required" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
  if (Buffer.byteLength(newPassword, "utf8") > 72) {
    res.status(400).json({ error: "Password must be 72 bytes or fewer" });
    return;
  }

  const tokenHash = hashResetToken(token);

  let record: typeof passwordResetTokensTable.$inferSelect | undefined;
  try {
    const [found] = await db
      .select()
      .from(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.tokenHash, tokenHash))
      .limit(1);
    record = found;
  } catch (error: unknown) {
    req.log.error(
      {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      },
      "Reset-password lookup failed",
    );
    res.status(503).json({ error: "Unable to process request. Please try again." });
    return;
  }

  // Generic invalid-token response covers unknown, used, and expired tokens.
  if (
    !record ||
    record.usedAt !== null ||
    record.expiresAt.getTime() <= Date.now()
  ) {
    res.status(400).json({ error: "This reset link is invalid or has expired." });
    return;
  }

  try {
    const newHash = await hashPassword(newPassword);
    // Atomically consume the token (one-time) and update the password. The
    // conditional WHERE on usedAt guards against a concurrent double-redeem.
    await db.transaction(async (tx) => {
      const consumed = await tx
        .update(passwordResetTokensTable)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(passwordResetTokensTable.id, record!.id),
            isNull(passwordResetTokensTable.usedAt),
          ),
        )
        .returning();
      if (consumed.length === 0) {
        throw new Error("TOKEN_ALREADY_USED");
      }
      await tx
        .update(usersTable)
        .set({ passwordHash: newHash })
        .where(eq(usersTable.id, record!.userId));
      // Invalidate any other outstanding tokens for this user.
      await tx
        .update(passwordResetTokensTable)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(passwordResetTokensTable.userId, record!.userId),
            isNull(passwordResetTokensTable.usedAt),
          ),
        );
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "TOKEN_ALREADY_USED") {
      res.status(400).json({ error: "This reset link is invalid or has expired." });
      return;
    }
    req.log.error(
      {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      },
      "Failed to reset password",
    );
    res.status(503).json({ error: "Unable to reset your password right now. Please try again." });
    return;
  }

  // Force re-authentication with the new credentials.
  clearAuthCookie(res);
  res.json({ message: "Password has been reset. Please log in with your new password." });
});

router.post("/auth/verify-email", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const token =
    typeof body.code === "string"
      ? body.code.trim()
      : (typeof body.token === "string" ? body.token.trim() : "");

  // Keep accepting the `token` field for valid public links issued by older
  // clients. New interactive `code` values are always six digits.
  if (
    token === "" ||
    token.length > 256 ||
    (typeof body.code === "string" && !/^\d{6}$/.test(token))
  ) {
    res.status(400).json({ error: "A 6-digit verification code is required" });
    return;
  }

  const tokenHash = hashVerificationToken(token);
  const rawSessionToken =
    req.cookies?.["los_token"] ||
    req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const session = rawSessionToken ? verifyToken(rawSessionToken) : null;

  let record: typeof emailVerificationTokensTable.$inferSelect | undefined;
  let rejectionReason: "invalid" | "locked" | undefined;
  try {
    if (session) {
      const [latest] = await db
        .select()
        .from(emailVerificationTokensTable)
        .where(
          and(
            eq(emailVerificationTokensTable.userId, session.userId),
            isNotNull(emailVerificationTokensTable.deliveryAcceptedAt),
          ),
        )
        .orderBy(desc(emailVerificationTokensTable.createdAt))
        .limit(1);

      if (latest && latest.tokenHash !== tokenHash) {
        if (latest.lockedAt !== null) {
          rejectionReason = "locked";
        } else if (
          latest.usedAt === null &&
          latest.expiresAt.getTime() > Date.now()
        ) {
          const nextFailedAttempts = latest.failedAttempts + 1;
          rejectionReason =
            nextFailedAttempts >= VERIFY_MAX_FAILED_ATTEMPTS
              ? "locked"
              : "invalid";
          await db
            .update(emailVerificationTokensTable)
            .set({
              failedAttempts: sql`${emailVerificationTokensTable.failedAttempts} + 1`,
              lockedAt: sql`case
                when ${emailVerificationTokensTable.failedAttempts} + 1 >= ${VERIFY_MAX_FAILED_ATTEMPTS}
                then now()
                else ${emailVerificationTokensTable.lockedAt}
              end`,
              usedAt: sql`case
                when ${emailVerificationTokensTable.failedAttempts} + 1 >= ${VERIFY_MAX_FAILED_ATTEMPTS}
                then now()
                else ${emailVerificationTokensTable.usedAt}
              end`,
            })
            .where(
              and(
                eq(emailVerificationTokensTable.id, latest.id),
                isNull(emailVerificationTokensTable.usedAt),
                isNull(emailVerificationTokensTable.lockedAt),
              ),
            );
        } else {
          rejectionReason = "invalid";
        }
      }
      if (latest?.tokenHash === tokenHash) record = latest;
    } else {
      const [found] = await db
        .select()
        .from(emailVerificationTokensTable)
        .where(
          and(
            eq(emailVerificationTokensTable.tokenHash, tokenHash),
            isNotNull(emailVerificationTokensTable.deliveryAcceptedAt),
          ),
        )
        .limit(1);
      if (found) {
        // A public legacy link is still valid, but only when it is the newest
        // token for its owner.
        const [latest] = await db
          .select({ id: emailVerificationTokensTable.id })
          .from(emailVerificationTokensTable)
          .where(
            and(
              eq(emailVerificationTokensTable.userId, found.userId),
              isNotNull(emailVerificationTokensTable.deliveryAcceptedAt),
            ),
          )
          .orderBy(desc(emailVerificationTokensTable.createdAt))
          .limit(1);
        if (latest?.id === found.id) record = found;
      }
    }
  } catch (error: unknown) {
    req.log.error(
      {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      },
      "Verify-email lookup failed",
    );
    res.status(503).json({ error: "Unable to process request. Please try again." });
    return;
  }

  // Already-verified is a friendly success even if the token is stale: if the
  // token belongs to a user who is already verified, report success.
  let tokenOwner:
    | {
        isEmailVerified: boolean;
        role: typeof usersTable.$inferSelect.role;
      }
    | undefined;
  if (record) {
    const [owner] = await db
      .select({
        isEmailVerified: usersTable.isEmailVerified,
        role: usersTable.role,
      })
      .from(usersTable)
      .where(eq(usersTable.id, record.userId))
      .limit(1);
    tokenOwner = owner;
    if (owner?.isEmailVerified) {
      setAuthCookie(res, signToken(record.userId, owner.role));
      res.status(200).json({
        message: "Email already verified.",
        alreadyVerified: true,
        sessionEstablished: true,
      });
      return;
    }
  }

  if (!record) {
    if (rejectionReason === "locked") {
      res.status(423).json({
        error: "Too many incorrect attempts. Request a new verification code.",
        code: "verification_code_locked",
      });
      return;
    }
    res.status(400).json({
      error: "This verification code is invalid or no longer active.",
      code: "verification_code_invalid",
    });
    return;
  }
  if (record.lockedAt !== null) {
    res.status(423).json({
      error: "Too many incorrect attempts. Request a new verification code.",
      code: "verification_code_locked",
    });
    return;
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    res.status(410).json({
      error: "This verification code has expired. Request a new code.",
      code: "verification_code_expired",
    });
    return;
  }
  if (record.usedAt !== null || !tokenOwner) {
    res.status(400).json({
      error: "This verification code is invalid or no longer active.",
      code: "verification_code_invalid",
    });
    return;
  }

  try {
    // Atomically consume the token (one-time) and mark the user verified. The
    // conditional WHERE on usedAt guards against a concurrent double-redeem.
    await db.transaction(async (tx) => {
      const consumed = await tx
        .update(emailVerificationTokensTable)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(emailVerificationTokensTable.id, record!.id),
            isNull(emailVerificationTokensTable.usedAt),
          ),
        )
        .returning();
      if (consumed.length === 0) {
        throw new Error("TOKEN_ALREADY_USED");
      }
      await tx
        .update(usersTable)
        .set({ isEmailVerified: true, verificationRequired: false, emailVerifiedAt: new Date() })
        .where(eq(usersTable.id, record!.userId));
      // Invalidate any other outstanding tokens for this user.
      await tx
        .update(emailVerificationTokensTable)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(emailVerificationTokensTable.userId, record!.userId),
            isNull(emailVerificationTokensTable.usedAt),
          ),
        );
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "TOKEN_ALREADY_USED") {
      res.status(400).json({
        error: "This verification code is invalid or no longer active.",
        code: "verification_code_invalid",
      });
      return;
    }
    req.log.error(
      {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      },
      "Failed to verify email",
    );
    res.status(503).json({ error: "Unable to verify your email right now. Please try again." });
    return;
  }

  setAuthCookie(res, signToken(record.userId, tokenOwner.role));
  res.status(200).json({
    message: "Your email has been verified.",
    verified: true,
    sessionEstablished: true,
  });
});

router.post("/auth/resend-verification", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;

  let dbUser: typeof usersTable.$inferSelect | undefined;
  try {
    const [found] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .limit(1);
    dbUser = found;
  } catch (error: unknown) {
    req.log.error(
      {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      },
      "Resend-verification lookup failed",
    );
    res.status(503).json({ error: "Unable to process request. Please try again." });
    return;
  }

  if (!dbUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Already-verified accounts short-circuit with a clear, non-error response.
  if (dbUser.isEmailVerified) {
    res.status(200).json({ message: "Email already verified.", alreadyVerified: true });
    return;
  }

  let issued: Awaited<ReturnType<typeof issueVerificationEmail>>;
  try {
    issued = await issueVerificationEmail(dbUser.id, dbUser.email, req.log, {
      enforceCooldown: true,
    });
  } catch (error: unknown) {
    req.log.error(
      {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      },
      "Failed to reissue verification email",
    );
    res.status(503).json({ error: "Unable to process request. Please try again." });
    return;
  }

  if (issued.rateLimited) {
    res.status(429).json({
      error: "Please wait before requesting another verification email.",
      retryAfter: issued.retryAfter,
    });
    return;
  }

  if (issued.delivery === "unavailable") {
    res.status(503).json({
      error:
        issued.failureReason === "error"
          ? "The email provider did not accept the verification message. Please retry."
          : "Email verification is temporarily unavailable because no delivery channel is configured.",
      deliveryAvailable: false,
      verificationDelivery: "unavailable",
      retryAfter: 0,
    });
    return;
  }

  const payload: Record<string, unknown> = {
    message:
      issued.delivery === "email"
        ? "A new verification code was sent to your email."
        : "A development-only verification code was generated.",
    verificationEmailSent: issued.sent,
    verificationDelivery: issued.delivery,
    retryAfter: issued.retryAfter,
  };
  if (issued.exposedToken) {
    payload.code = issued.exposedToken;
    payload.token = issued.exposedToken;
  }
  res.status(200).json(payload);
});

export default router;

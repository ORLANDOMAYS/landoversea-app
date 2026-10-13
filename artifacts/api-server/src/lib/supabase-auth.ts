import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

export interface SupabaseIdentity {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

export interface LocalAuthUser {
  id: number;
  email: string;
  passwordHash: string;
  isEmailVerified: boolean;
  isRestricted: boolean;
  restrictionReason: string | null;
  [key: string]: unknown;
}

export interface SupabaseUserRepository<TUser extends LocalAuthUser> {
  findByExternalIdentity(
    provider: "supabase",
    subject: string,
  ): Promise<TUser | undefined>;
  resolveSupabaseIdentity(input: {
    identity: SupabaseIdentity;
    passwordHash: string;
  }): Promise<TUser>;
}

export type SupabaseFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class SupabaseAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code:
      | "missing_config"
      | "invalid_token"
      | "provider_unavailable"
      | "invalid_identity"
      | "identity_conflict",
  ) {
    super(message);
    this.name = "SupabaseAuthError";
  }
}

async function createUnknownPasswordHash(): Promise<string> {
  // No caller ever receives or persists this random credential. Keeping a
  // normal bcrypt value preserves users.passwordHash as a credential field and
  // makes legacy password verification fail normally for Supabase-only users.
  return bcrypt.hash(randomBytes(32).toString("base64url"), 12);
}

export async function verifySupabaseAccessToken(
  token: string,
  options: {
    url?: string;
    publishableKey?: string;
    fetchImpl?: SupabaseFetch;
  } = {},
): Promise<SupabaseIdentity> {
  const url = options.url ?? process.env.SUPABASE_URL;
  const publishableKey =
    options.publishableKey ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new SupabaseAuthError(
      "Supabase authentication is not configured",
      503,
      "missing_config",
    );
  }

  let endpoint: URL;
  try {
    endpoint = new URL("/auth/v1/user", url);
  } catch {
    throw new SupabaseAuthError(
      "Supabase authentication is not configured",
      503,
      "missing_config",
    );
  }

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "GET",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    throw new SupabaseAuthError(
      "Supabase authentication provider is unavailable",
      503,
      "provider_unavailable",
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new SupabaseAuthError(
      "Invalid or expired token",
      401,
      "invalid_token",
    );
  }
  if (!response.ok) {
    throw new SupabaseAuthError(
      "Supabase authentication provider is unavailable",
      503,
      "provider_unavailable",
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SupabaseAuthError(
      "Supabase authentication provider returned an invalid response",
      503,
      "provider_unavailable",
    );
  }
  if (!body || typeof body !== "object") {
    throw new SupabaseAuthError(
      "Supabase user identity is incomplete",
      422,
      "invalid_identity",
    );
  }

  const record = body as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const email =
    typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
  if (!id || !email) {
    throw new SupabaseAuthError(
      "Supabase user identity is incomplete",
      422,
      "invalid_identity",
    );
  }
  const metadata =
    record.user_metadata && typeof record.user_metadata === "object"
      ? (record.user_metadata as Record<string, unknown>)
      : {};
  const metadataName =
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.name === "string"
        ? metadata.name
        : "";

  return {
    id,
    email,
    name: metadataName.trim() || email.split("@")[0] || "LandOverSEA user",
    emailVerified:
      typeof record.email_confirmed_at === "string" &&
      record.email_confirmed_at.length > 0,
  };
}

export async function mapSupabaseIdentity<TUser extends LocalAuthUser>(
  identity: SupabaseIdentity,
  repository: SupabaseUserRepository<TUser>,
): Promise<TUser> {
  // Subject is immutable and authoritative. In particular, do not consult
  // email before this lookup: provider-side email changes must retain the link.
  const existing = await repository.findByExternalIdentity(
    "supabase",
    identity.id,
  );
  if (existing) return existing;

  return repository.resolveSupabaseIdentity({
    identity,
    passwordHash: await createUnknownPasswordHash(),
  });
}
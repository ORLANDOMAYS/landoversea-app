import { SupabaseAuthError, type SupabaseFetch } from "./supabase-auth";
import { parsePositiveSafeInteger } from "./positiveSafeInteger";

export type CoachIdentifier =
  | { kind: "local"; id: number }
  | { kind: "supabase"; id: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCoachIdentifier(value: string): CoachIdentifier | null {
  const localId = parsePositiveSafeInteger(value);
  if (localId !== null) return { kind: "local", id: localId };
  return UUID_PATTERN.test(value) ? { kind: "supabase", id: value } : null;
}

export interface VisibleSupabaseCoach {
  id: string;
  ownerId: string | null;
}

export async function fetchVisibleSupabaseCoach(
  id: string,
  accessToken: string,
  options: {
    url?: string;
    publishableKey?: string;
    fetchImpl?: SupabaseFetch;
  } = {},
): Promise<VisibleSupabaseCoach | null> {
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
    endpoint = new URL("/rest/v1/coaches", url);
  } catch {
    throw new SupabaseAuthError(
      "Supabase authentication is not configured",
      503,
      "missing_config",
    );
  }
  endpoint.search = new URLSearchParams({
    select: "id,owner_id,approved,active,verified",
    id: `eq.${id}`,
    approved: "eq.true",
    active: "eq.true",
    verified: "eq.true",
    limit: "1",
  }).toString();

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "GET",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
  } catch {
    throw new SupabaseAuthError(
      "Supabase coach lookup is temporarily unavailable",
      503,
      "provider_unavailable",
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new SupabaseAuthError("Invalid or expired token", 401, "invalid_token");
  }
  if (!response.ok) {
    throw new SupabaseAuthError(
      "Supabase coach lookup is temporarily unavailable",
      503,
      "provider_unavailable",
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SupabaseAuthError(
      "Supabase coach lookup returned an invalid response",
      503,
      "provider_unavailable",
    );
  }
  if (!Array.isArray(body) || body.length > 1) {
    throw new SupabaseAuthError(
      "Supabase coach lookup returned an invalid response",
      503,
      "provider_unavailable",
    );
  }
  if (body.length === 0) return null;

  const row = body[0];
  if (!row || typeof row !== "object") {
    throw new SupabaseAuthError(
      "Supabase coach lookup returned an invalid response",
      503,
      "provider_unavailable",
    );
  }
  const record = row as Record<string, unknown>;
  if (
    record.id !== id ||
    record.approved !== true ||
    record.active !== true ||
    record.verified !== true ||
    (record.owner_id !== null && typeof record.owner_id !== "string")
  ) {
    throw new SupabaseAuthError(
      "Supabase coach lookup returned an invalid response",
      503,
      "provider_unavailable",
    );
  }
  return { id, ownerId: record.owner_id as string | null };
}
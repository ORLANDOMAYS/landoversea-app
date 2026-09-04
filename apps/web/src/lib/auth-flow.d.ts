export type CallbackDecision =
  | { kind: "pkce"; code: string }
  | { kind: "error" | "invalid"; message: string };

export function parseWebAuthCallback(
  search: string | URLSearchParams
): CallbackDecision;
export function isProfileComplete(profile: unknown): boolean;
export function decideAuthDestination(input: {
  hasSession: boolean;
  profile?: unknown;
  authError?: unknown;
}): "/auth" | "/app" | "/app/profile?onboarding=1";
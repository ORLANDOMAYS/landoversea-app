const RECOVERY_SESSION_KEY = 'los_password_recovery_started_at';
const RECOVERY_SESSION_MAX_AGE_MS = 30 * 60 * 1000;

type AuthErrorLike = {
  status?: unknown;
  code?: unknown;
  message?: unknown;
  retryAfter?: unknown;
  retry_after?: unknown;
  data?: unknown;
};

export function isEmailRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as AuthErrorLike;
  return (
    value.status === 429 ||
    value.code === 'over_email_send_rate_limit' ||
    (typeof value.message === 'string' &&
      /(?:email|request).*(?:rate limit|too many)|rate limit.*email|too many (?:email )?requests|security purposes.*(?:request|seconds?)/i.test(value.message))
  );
}

const DEFAULT_EMAIL_RETRY_AFTER_SECONDS = 60;
const MAX_EMAIL_RETRY_AFTER_SECONDS = 60 * 60;

function findRetryAfter(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const error = value as AuthErrorLike;
  for (const candidate of [error.retryAfter, error.retry_after]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return findRetryAfter(error.data);
}

export function getEmailRetryAfter(error: unknown): number {
  if (!isEmailRateLimitError(error)) return 0;
  const retryAfter = findRetryAfter(error) ?? DEFAULT_EMAIL_RETRY_AFTER_SECONDS;
  return Math.min(MAX_EMAIL_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil(retryAfter)));
}

export function markPasswordRecoverySession(): void {
  try {
    window.sessionStorage.setItem(RECOVERY_SESSION_KEY, String(Date.now()));
  } catch {
    // A valid Supabase recovery session remains authoritative when storage is unavailable.
  }
}

export function hasPasswordRecoverySession(): boolean {
  try {
    const startedAt = Number(window.sessionStorage.getItem(RECOVERY_SESSION_KEY));
    if (!Number.isFinite(startedAt) || Date.now() - startedAt > RECOVERY_SESSION_MAX_AGE_MS) {
      clearPasswordRecoverySession();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function clearPasswordRecoverySession(): void {
  try {
    window.sessionStorage.removeItem(RECOVERY_SESSION_KEY);
  } catch {
    // Nothing else to clear.
  }
}
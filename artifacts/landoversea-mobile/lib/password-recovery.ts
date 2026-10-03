import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

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

export function addRecoveryType(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}type=recovery`;
}

async function setRecoveryValue(value: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    if (value === null) window.sessionStorage.removeItem(RECOVERY_SESSION_KEY);
    else window.sessionStorage.setItem(RECOVERY_SESSION_KEY, value);
    return;
  }
  if (value === null) await SecureStore.deleteItemAsync(RECOVERY_SESSION_KEY);
  else await SecureStore.setItemAsync(RECOVERY_SESSION_KEY, value);
}

async function getRecoveryValue(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return typeof window === 'undefined'
      ? null
      : window.sessionStorage.getItem(RECOVERY_SESSION_KEY);
  }
  return SecureStore.getItemAsync(RECOVERY_SESSION_KEY);
}

export async function markPasswordRecoverySession(): Promise<void> {
  await setRecoveryValue(String(Date.now()));
}

export async function hasPasswordRecoverySession(): Promise<boolean> {
  try {
    const startedAt = Number(await getRecoveryValue());
    if (!Number.isFinite(startedAt) || Date.now() - startedAt > RECOVERY_SESSION_MAX_AGE_MS) {
      await clearPasswordRecoverySession();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function clearPasswordRecoverySession(): Promise<void> {
  try {
    await setRecoveryValue(null);
  } catch {
    // A cleared Supabase session still prevents password changes.
  }
}
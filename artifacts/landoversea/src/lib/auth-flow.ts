export type AuthCallbackDecision =
  | { kind: 'pkce'; code: string; next: string | null; isRecovery: boolean }
  | { kind: 'recovery-token'; tokenHash: string; next: string | null; isRecovery: true }
  | {
      kind: 'legacy';
      accessToken: string;
      refreshToken: string;
      next: string | null;
      isRecovery: boolean;
    }
  | {
      kind: 'error';
      message: string;
      next: string | null;
      isRecovery: boolean;
    }
  | {
      kind: 'invalid';
      message: string;
      next: string | null;
      isRecovery: boolean;
    };

export const CANONICAL_APP_ORIGIN = 'https://landover-sea.com';
const REPLIT_PREVIEW_HOST_SUFFIX = '.replit.dev';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function bareOrigin(value: string): URL | null {
  try {
    const candidate = new URL(value);
    if (
      candidate.origin !== value
      || candidate.username
      || candidate.password
      || candidate.pathname !== '/'
      || candidate.search
      || candidate.hash
    ) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

export function resolveDevelopmentAuthCallbackOrigin(currentOrigin: string): string {
  const candidate = bareOrigin(currentOrigin);
  if (!candidate) return CANONICAL_APP_ORIGIN;
  if (candidate.origin === CANONICAL_APP_ORIGIN) return candidate.origin;
  if (
    LOOPBACK_HOSTS.has(candidate.hostname)
    && (candidate.protocol === 'http:' || candidate.protocol === 'https:')
  ) {
    return candidate.origin;
  }
  if (
    candidate.protocol === 'https:'
    && candidate.hostname.endsWith(REPLIT_PREVIEW_HOST_SUFFIX)
    && candidate.hostname.length > REPLIT_PREVIEW_HOST_SUFFIX.length
  ) {
    return candidate.origin;
  }
  return CANONICAL_APP_ORIGIN;
}

export function validateSameAppDestination(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  try {
    const origin = 'https://landoversea.local';
    const destination = new URL(value, origin);
    if (destination.origin !== origin) return null;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return null;
  }
}

export function buildAuthCallbackUrl(
  origin: string,
  baseUrl: string,
  next?: string | null,
  authType?: 'recovery',
): string {
  const basePath = baseUrl.replace(/\/+$/, '');
  const callback = new URL(`${basePath}/auth/callback`, origin);
  const destination = validateSameAppDestination(next);
  if (destination) callback.searchParams.set('next', destination);
  if (authType) callback.searchParams.set('type', authType);
  return callback.toString();
}

export function resolveAuthCallbackOrigin(
  isProduction: boolean,
  publicAppUrl: string | null | undefined,
  currentOrigin: string,
): string {
  if (!isProduction) return resolveDevelopmentAuthCallbackOrigin(currentOrigin);
  const configuredOrigin = publicAppUrl?.trim() || CANONICAL_APP_ORIGIN;
  const candidate = bareOrigin(configuredOrigin);
  if (
    candidate?.protocol === 'https:'
    && candidate.origin === CANONICAL_APP_ORIGIN
  ) {
    return candidate.origin;
  }
  return CANONICAL_APP_ORIGIN;
}

export function getAuthCallbackOrigin(): string {
  return resolveAuthCallbackOrigin(
    import.meta.env.PROD,
    import.meta.env.VITE_PUBLIC_APP_URL,
    window.location.origin,
  );
}

function toAuthParams(value: string | URLSearchParams | undefined): URLSearchParams {
  if (value instanceof URLSearchParams) return value;
  return new URLSearchParams(value?.replace(/^[?#]/, '') ?? '');
}

export function parseAuthCallback(
  search: string | URLSearchParams,
  hash?: string | URLSearchParams,
): AuthCallbackDecision {
  const params = toAuthParams(search);
  const hashParams = toAuthParams(hash);
  const next = validateSameAppDestination(params.get('next') ?? hashParams.get('next'));
  const callbackType = params.get('type') ?? hashParams.get('type');
  const isRecovery = callbackType === 'recovery' || next === '/reset-password';
  const error =
    params.get('error_description') ||
    hashParams.get('error_description') ||
    params.get('error') ||
    hashParams.get('error');
  if (error) return { kind: 'error', message: error, next, isRecovery };

  const tokenHash = params.get('token_hash') ?? hashParams.get('token_hash');
  if (tokenHash && isRecovery) {
    return { kind: 'recovery-token', tokenHash, next, isRecovery: true };
  }

  const code = params.get('code');
  if (code) return { kind: 'pkce', code, next, isRecovery };

  const accessToken = hashParams.get('access_token') ?? params.get('access_token');
  const refreshToken = hashParams.get('refresh_token') ?? params.get('refresh_token');
  if (accessToken && refreshToken) {
    return { kind: 'legacy', accessToken, refreshToken, next, isRecovery };
  }

  return {
    kind: 'invalid',
    message: 'This sign-in link is invalid or has expired.',
    next,
    isRecovery,
  };
}

export function isProfileComplete(
  profile: {
    display_name?: unknown;
    age?: unknown;
    gender?: unknown;
    onboarding_completed_at?: unknown;
  } | null,
): boolean {
  if (!profile) return false;
  const isAdult = Number.isInteger(profile.age) && Number(profile.age) >= 18;
  if (!isAdult) return false;
  if (
    typeof profile.onboarding_completed_at === 'string' &&
    profile.onboarding_completed_at.trim().length > 0
  ) {
    return true;
  }
  return (
    typeof profile.display_name === 'string' &&
    profile.display_name.trim().length > 0 &&
    typeof profile.gender === 'string' &&
    profile.gender.trim().length > 0
  );
}

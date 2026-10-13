export type ParsedAuthCallback =
  | { kind: 'pkce'; code: string; isRecovery: boolean }
  | { kind: 'recovery-token'; tokenHash: string; isRecovery: true }
  | { kind: 'legacy'; accessToken: string; refreshToken: string; isRecovery: boolean }
  | { kind: 'error'; message: string; isRecovery: boolean }
  | { kind: 'invalid'; message: string };

export function parseAuthCallbackUrl(input: string | null): ParsedAuthCallback {
  if (!input?.trim()) return { kind: 'invalid', message: 'The sign-in link is missing.' };
  try {
    const url = new URL(input);
    const query = url.searchParams;
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const isRecovery = query.get('type') === 'recovery' || hash.get('type') === 'recovery';
    const error = query.get('error_description') || hash.get('error_description')
      || query.get('error') || hash.get('error');
    if (error) return { kind: 'error', message: error, isRecovery };
    const tokenHash = query.get('token_hash') || hash.get('token_hash');
    if (tokenHash && isRecovery) {
      return { kind: 'recovery-token', tokenHash, isRecovery: true };
    }
    const code = query.get('code');
    if (code) return { kind: 'pkce', code, isRecovery };
    const accessToken = hash.get('access_token') || query.get('access_token');
    const refreshToken = hash.get('refresh_token') || query.get('refresh_token');
    if (accessToken && refreshToken) {
      return { kind: 'legacy', accessToken, refreshToken, isRecovery };
    }
    return { kind: 'invalid', message: 'This sign-in link is invalid or has expired.' };
  } catch {
    return { kind: 'invalid', message: 'The sign-in link is invalid.' };
  }
}

export function isProfileComplete(profile: Record<string, unknown> | null): boolean {
  if (!profile) return false;
  return typeof profile.display_name === 'string' && profile.display_name.trim().length > 0
    && Number.isInteger(profile.age) && Number(profile.age) >= 18
    && typeof profile.gender === 'string' && profile.gender.trim().length > 0;
}
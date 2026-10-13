import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useLocation } from 'wouter';
import { getSupabase } from '@/lib/supabase';
import { PROFILE_PUBLIC_SELECT, upsertOwnProfile } from '@/lib/supabase-api';
import { isProfileComplete, parseAuthCallback } from '@/lib/auth-flow';
import { markPasswordRecoverySession } from '@/lib/password-recovery';

type CallbackState = { status: 'loading' | 'error'; message: string; recovery: boolean };

type CodeExchangeResult = Awaited<
  ReturnType<ReturnType<typeof getSupabase>['auth']['exchangeCodeForSession']>
>;
type RecoveryTokenResult = Awaited<
  ReturnType<ReturnType<typeof getSupabase>['auth']['verifyOtp']>
>;
type LegacySessionResult = Awaited<
  ReturnType<ReturnType<typeof getSupabase>['auth']['setSession']>
>;
const pendingCodeExchanges = new Map<string, Promise<CodeExchangeResult>>();
const pendingRecoveryTokens = new Map<string, Promise<RecoveryTokenResult>>();
const pendingLegacySessions = new Map<string, Promise<LegacySessionResult>>();

function keepSuccessfulAttempt<T extends { error: unknown }>(
  pending: Map<string, Promise<T>>,
  key: string,
  attempt: Promise<T>,
): Promise<T> {
  pending.set(key, attempt);
  void attempt.then(
    (result) => {
      if (result.error) pending.delete(key);
    },
    () => pending.delete(key),
  );
  return attempt;
}

function exchangeCodeOnce(code: string): Promise<CodeExchangeResult> {
  const pending = pendingCodeExchanges.get(code);
  if (pending) return pending;
  const exchange = getSupabase().auth.exchangeCodeForSession(code);
  return keepSuccessfulAttempt(pendingCodeExchanges, code, exchange);
}

function verifyRecoveryTokenOnce(tokenHash: string): Promise<RecoveryTokenResult> {
  const pending = pendingRecoveryTokens.get(tokenHash);
  if (pending) return pending;
  const verification = getSupabase().auth.verifyOtp({
    token_hash: tokenHash,
    type: 'recovery',
  });
  return keepSuccessfulAttempt(pendingRecoveryTokens, tokenHash, verification);
}

function setLegacySessionOnce(
  accessToken: string,
  refreshToken: string,
): Promise<LegacySessionResult> {
  const pending = pendingLegacySessions.get(accessToken);
  if (pending) return pending;
  const session = getSupabase().auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  return keepSuccessfulAttempt(
    pendingLegacySessions,
    accessToken,
    session,
  );
}

export default function AuthCallback() {
  const [, setLocation] = useLocation();
  const [state, setState] = useState<CallbackState>({
    status: 'loading',
    message: 'Signing you in…',
    recovery: false,
  });

  useEffect(() => {
    let active = true;
    async function complete() {
      let recovery = false;
      try {
        const decision = parseAuthCallback(window.location.search, window.location.hash);
        recovery = decision.isRecovery;
        if (decision.kind === 'error' || decision.kind === 'invalid') {
          throw new Error(decision.message);
        }
        const client = getSupabase();
        const { data, error } =
          decision.kind === 'pkce'
            ? await exchangeCodeOnce(decision.code)
            : decision.kind === 'recovery-token'
              ? await verifyRecoveryTokenOnce(decision.tokenHash)
              : await setLegacySessionOnce(decision.accessToken, decision.refreshToken);
        if (error) throw error;
        const user = data.session?.user;
        if (!user) throw new Error('The sign-in link did not create a session.');
        if (recovery) {
          markPasswordRecoverySession();
          if (active) setLocation('/reset-password', { replace: true });
          return;
        }

        let { data: profile, error: profileError } = await client
          .from('profiles')
          .select(PROFILE_PUBLIC_SELECT)
          .eq('id', user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!profile) {
          profile = await upsertOwnProfile({
            display_name:
              user.user_metadata?.display_name ??
              user.email?.split('@')[0] ??
              null,
          });
        }
        if (!active) return;
        const destination = isProfileComplete(profile)
          ? decision.next ?? '/discover'
          : '/onboarding';
        setLocation(destination, { replace: true });
      } catch (caught) {
        if (!active) return;
        setState({
          status: 'error',
          message: recovery
            ? 'This password reset link is invalid, expired, or has already been used.'
            : caught instanceof Error
              ? caught.message
              : 'This sign-in link is invalid or has expired.',
          recovery,
        });
      }
    }
    void complete();
    return () => {
      active = false;
    };
  }, [setLocation]);

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-6">
      <div className="glass rounded-2xl p-8 w-full max-w-sm text-center">
        {state.status === 'loading' && <Loader2 className="w-9 h-9 animate-spin text-primary mx-auto mb-4" />}
        <h1 className="font-serif text-2xl text-foreground">
          {state.status === 'error'
            ? state.recovery
              ? 'Password reset link failed'
              : 'Sign-in link failed'
            : 'Signing in'}
        </h1>
        <p className={state.status === 'error' ? 'text-red-400 mt-3' : 'text-muted-foreground mt-3'}>
          {state.message}
        </p>
        {state.status === 'error' && (
          <button
            type="button"
            className="btn-glow mt-6 px-6 py-2.5"
            onClick={() => setLocation(state.recovery ? '/forgot-password' : '/login', { replace: true })}
          >
            {state.recovery ? 'Request a new reset link' : 'Request a new link'}
          </button>
        )}
      </div>
    </div>
  );
}
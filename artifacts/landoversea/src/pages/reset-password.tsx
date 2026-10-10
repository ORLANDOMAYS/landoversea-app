import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, CheckCircle2, Loader2, Lock } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import {
  clearPasswordRecoverySession,
  hasPasswordRecoverySession,
} from '@/lib/password-recovery';
import { useI18n } from '@/i18n';

function Wordmark() {
  return (
    <div className="text-center mb-2">
      <div className="flex items-baseline justify-center">
        <span style={{ fontFamily: 'var(--font-script)', fontSize: '48px' }} className="bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">Land</span>
        <span style={{ fontFamily: 'var(--font-script)', fontSize: '48px' }} className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">Over</span>
        <span style={{ fontFamily: 'var(--font-script)', fontSize: '48px' }} className="text-foreground/90">SEA</span>
      </div>
    </div>
  );
}

export default function ResetPassword() {
  const { t } = useI18n();
  const [checking, setChecking] = useState(true);
  const [validSession, setValidSession] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let active = true;
    void getSupabase().auth.getSession().then(({ data, error }) => {
      if (!active) return;
      setValidSession(!error && Boolean(data.session) && hasPasswordRecoverySession());
      setChecking(false);
    }).catch(() => {
      if (active) {
        setValidSession(false);
        setChecking(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const finishSignOut = async (): Promise<boolean> => {
    try {
      const { error } = await getSupabase().auth.signOut({ scope: 'local' });
      if (error) throw error;
      clearPasswordRecoverySession();
      setComplete(true);
      return true;
    } catch {
      setErrorMessage('Your password was updated, but this recovery session could not be closed. Please retry signing out.');
      return false;
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    if (newPassword.length < 8) {
      setErrorMessage(t('auth.validPasswordMin'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage(t('auth.passwordsMismatch'));
      return;
    }

    setSubmitting(true);
    try {
      const client = getSupabase();
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordUpdated(true);
      await finishSignOut();
    } catch {
      setErrorMessage(t('auth.resetUnavailable'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center p-6 relative overflow-x-hidden overflow-y-auto">
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 rounded-full opacity-20 blur-3xl animate-pulse pointer-events-none" style={{ background: 'rgba(255,45,122,0.6)' }} />
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 rounded-full opacity-20 blur-3xl animate-pulse pointer-events-none" style={{ background: 'rgba(139,92,246,0.6)', animationDelay: '1s' }} />

      <div className="w-full max-w-sm z-10 flex flex-col items-center my-auto">
        <Wordmark />
        <div className="glass rounded-2xl p-6 w-full mt-8">
          {checking ? (
            <div className="py-8 text-center" aria-busy="true">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              <p className="mt-4 text-sm text-muted-foreground">Checking your reset link…</p>
            </div>
          ) : complete ? (
            <div className="py-4 text-center" data-testid="status-reset-success">
              <CheckCircle2 className="mx-auto h-12 w-12 text-cyan-400" />
              <h2 className="mt-4 font-serif text-2xl text-foreground">{t('auth.resetSuccess')}</h2>
              <Link href="/login" className="btn-glow mt-6 flex h-11 w-full items-center justify-center text-sm">
                {t('auth.backToLogin')}
              </Link>
            </div>
          ) : !validSession ? (
            <div className="py-4 text-center" role="alert" data-testid="status-reset-invalid">
              <h2 className="font-serif text-2xl text-foreground">{t('auth.resetInvalid')}</h2>
              <p className="mt-3 text-sm text-muted-foreground">
                Request a new link. Recovery links can only be used once.
              </p>
              <Link href="/forgot-password" className="btn-glow mt-6 flex h-11 w-full items-center justify-center text-sm">
                {t('auth.forgotSubmit')}
              </Link>
            </div>
          ) : passwordUpdated ? (
            <div className="py-4 text-center" role="status">
              <CheckCircle2 className="mx-auto h-12 w-12 text-cyan-400" />
              <h2 className="mt-4 font-serif text-2xl text-foreground">Password updated</h2>
              <p className="mt-3 text-sm text-muted-foreground">
                Finish signing out of the recovery session before you continue.
              </p>
              {errorMessage && (
                <p role="alert" className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-300">
                  {errorMessage}
                </p>
              )}
              <button
                type="button"
                disabled={submitting}
                className="btn-glow mt-6 flex h-11 w-full items-center justify-center text-sm"
                onClick={() => {
                  setSubmitting(true);
                  void finishSignOut().finally(() => setSubmitting(false));
                }}
              >
                {submitting ? 'Signing out…' : 'Retry sign out'}
              </button>
            </div>
          ) : (
            <>
              <h2 className="font-serif text-2xl text-foreground">{t('auth.resetTitle')}</h2>
              <p className="mt-2 mb-5 text-sm text-muted-foreground">{t('auth.resetSubtitle')}</p>
              <form className="space-y-4" onSubmit={submit}>
                <label className="block text-sm font-semibold text-foreground" htmlFor="reset-new-password">
                  {t('auth.newPassword')}
                </label>
                <div className="relative">
                  <Lock aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="reset-new-password"
                    data-testid="input-reset-password"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    className="glass-input w-full rounded-xl p-3 pl-10 text-sm text-foreground outline-none focus:border-primary/70 focus:ring-2 focus:ring-primary/25"
                  />
                </div>
                <label className="block text-sm font-semibold text-foreground" htmlFor="reset-confirm-password">
                  {t('auth.confirmPassword')}
                </label>
                <div className="relative">
                  <Lock aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="reset-confirm-password"
                    data-testid="input-reset-confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="glass-input w-full rounded-xl p-3 pl-10 text-sm text-foreground outline-none focus:border-primary/70 focus:ring-2 focus:ring-primary/25"
                  />
                </div>
                {errorMessage && (
                  <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-300">
                    {errorMessage}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={submitting || newPassword.length < 8 || !confirmPassword}
                  data-testid="button-reset-submit"
                  className="btn-glow flex h-12 w-full items-center justify-center disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
                >
                  {submitting && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                  {t('auth.resetSubmit')}
                </button>
              </form>
            </>
          )}
        </div>
        <Link
          href="/login"
          className="mt-6 flex items-center gap-1 rounded-sm text-sm font-semibold text-primary hover:text-primary/80"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('auth.backToLogin')}
        </Link>
      </div>
    </div>
  );
}
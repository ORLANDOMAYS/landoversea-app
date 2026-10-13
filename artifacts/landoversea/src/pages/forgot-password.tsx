import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Loader2, Mail, ArrowLeft, MailCheck } from 'lucide-react';
import { useI18n } from '@/i18n';
import { getSupabase, supabaseConfigurationError } from '@/lib/supabase';
import { buildAuthCallbackUrl, getAuthCallbackOrigin } from '@/lib/auth-flow';
import { getEmailRetryAfter } from '@/lib/password-recovery';

const forgotSchema = z.object({
  email: z.string().trim().email('Please enter a valid email').max(320, 'Email is too long'),
});

type ForgotValues = z.infer<typeof forgotSchema>;

// Wordmark reused from the login screen so the visual identity is identical.
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

export default function ForgotPassword() {
  const { t } = useI18n();
  const [status, setStatus] = useState<'idle' | 'sent' | 'unavailable'>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [retryAfter, setRetryAfter] = useState(0);
  const recoveryInFlight = useRef(false);

  const form = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
  });

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = window.setInterval(() => {
      setRetryAfter((value) => Math.max(0, value - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [retryAfter]);

  const onSubmit = async (data: ForgotValues) => {
    if (recoveryInFlight.current || retryAfter > 0) return;
    recoveryInFlight.current = true;
    setSubmitting(true);
    setErrorMessage('');
    try {
      const { error } = await getSupabase().auth.resetPasswordForEmail(data.email, {
        redirectTo: buildAuthCallbackUrl(
          getAuthCallbackOrigin(),
          import.meta.env.BASE_URL,
          '/reset-password',
          'recovery',
        ),
      });
      if (error) throw error;
      setStatus('sent');
      setRetryAfter(60);
    } catch (error) {
      const emailRetryAfter = getEmailRetryAfter(error);
      if (emailRetryAfter > 0) {
        setRetryAfter(emailRetryAfter);
        setErrorMessage(t('auth.verifyCooldown'));
      } else {
        setErrorMessage(
          error instanceof Error && error.message === supabaseConfigurationError
            ? error.message
            : t('auth.forgotUnavailable'),
        );
      }
      setStatus('unavailable');
    } finally {
      recoveryInFlight.current = false;
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
          <h2 className="font-serif text-2xl text-foreground mb-2">{t('auth.forgotTitle')}</h2>

          {status === 'sent' ? (
            <div className="flex flex-col items-center text-center py-4" data-testid="status-forgot-sent">
              <div className="w-12 h-12 rounded-full glass flex items-center justify-center mb-3 glow-cyan">
                <MailCheck className="w-6 h-6 text-cyan-400" />
              </div>
              <p className="text-foreground text-sm leading-relaxed">
                {t('auth.forgotSent')}
              </p>
              <button
                type="button"
                data-testid="button-forgot-resend"
                disabled={submitting || retryAfter > 0}
                onClick={form.handleSubmit(onSubmit)}
                className="glass mt-4 flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold text-foreground hover:bg-muted/70 disabled:text-muted-foreground"
              >
                {submitting ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                {retryAfter > 0 ? `Resend in ${retryAfter}s` : 'Resend reset email'}
              </button>
            </div>
          ) : status === 'unavailable' ? (
            <div className="flex flex-col items-center text-center py-4" data-testid="status-forgot-unavailable">
              <p className="text-foreground text-sm leading-relaxed">
                 We could not send a password reset email. {errorMessage || 'Please try again from the sign-in page.'}
              </p>
              <button
                type="button"
                 disabled={submitting || retryAfter > 0}
                onClick={() => {
                  setErrorMessage('');
                  setStatus('idle');
                }}
                className="mt-4 text-sm font-semibold text-primary hover:text-primary/80"
              >
                {retryAfter > 0 ? `Try again in ${retryAfter}s` : t('common.retry')}
              </button>
            </div>
          ) : (
            <>
              <p className="text-muted-foreground font-medium text-sm mb-5">
                {t('auth.forgotSubtitle')}
              </p>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <label htmlFor="forgot-email" className="block text-sm font-semibold text-foreground mb-1.5">
                          {t('auth.email')}
                        </label>
                        <FormControl>
                          <div className="relative group">
                            <Mail aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
                            <input
                              id="forgot-email"
                              type="email"
                              autoComplete="email"
                              placeholder="hello@world.com"
                              data-testid="input-forgot-email"
                              {...field}
                              className="glass-input w-full rounded-xl p-3 pl-10 text-sm text-foreground caret-primary outline-none placeholder:text-muted-foreground focus:border-primary/70 focus:ring-2 focus:ring-primary/25 transition-[border-color,box-shadow]"
                            />
                          </div>
                        </FormControl>
                        <FormMessage className="text-destructive text-xs font-medium" />
                      </FormItem>
                    )}
                  />
                  <button
                    type="submit"
                    disabled={submitting || retryAfter > 0}
                    data-testid="button-forgot-submit"
                    className="btn-glow w-full h-12 text-base mt-2 flex items-center justify-center disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
                  >
                    {submitting ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
                    {retryAfter > 0 ? `Try again in ${retryAfter}s` : t('auth.forgotSubmit')}
                  </button>
                </form>
              </Form>
            </>
          )}
        </div>

        <Link
          href="/login"
          data-testid="link-back-to-login"
          className="mt-6 rounded-sm text-sm font-semibold text-primary hover:text-primary/80 transition-colors flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('auth.backToLogin')}
        </Link>
      </div>
    </div>
  );
}

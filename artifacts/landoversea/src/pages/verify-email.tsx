import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Loader2, MailCheck, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useVerifyEmail, useResendVerificationEmail, getGetCurrentUserQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { normalizeApiError } from '@/lib/api-error';

type VerifyValues = { token: string };

function readVerificationContext(): {
  token: string | null;
  delivery: 'email' | 'development' | 'unavailable' | null;
  retryAfter: number;
} {
  if (typeof window === 'undefined') {
    return { token: null, delivery: null, retryAfter: 0 };
  }
  const params = new URLSearchParams(window.location.search);
  const delivery = params.get('delivery');
  const retryAfter = Number(params.get('retryAfter'));
  return {
    token: params.get('token'),
    delivery:
      delivery === 'email' ||
      delivery === 'development' ||
      delivery === 'unavailable'
        ? delivery
        : null,
    retryAfter:
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.ceil(retryAfter)
        : 0,
  };
}

function getRetryAfter(error: unknown): number {
  if (!error || typeof error !== 'object') return 0;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return 0;
  const value = (data as { retryAfter?: unknown }).retryAfter;
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : 0;
}

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

type Status = 'idle' | 'success' | 'already' | 'invalid' | 'unavailable';

export default function VerifyEmail() {
  const { t } = useI18n();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [initialContext] = useState(readVerificationContext);
  const [status, setStatus] = useState<Status>(
    initialContext.delivery === 'unavailable' ? 'unavailable' : 'idle',
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(
    initialContext.delivery === 'unavailable'
      ? 'Your account was created, but the email provider did not accept a verification message. You can retry now.'
      : null,
  );
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'cooldown' | 'error'>('idle');
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(initialContext.retryAfter);
  const autoVerified = useRef(false);

  const verifyMutation = useVerifyEmail();
  const resendMutation = useResendVerificationEmail();
  const verifySchema = z.object({
    token: z.string().trim().min(6, t('auth.verifyCodeRequired')),
  });

  const form = useForm<VerifyValues>({
    resolver: zodResolver(verifySchema),
    defaultValues: { token: '' },
  });

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => {
      setResendCooldown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  const handleSuccess = (alreadyVerified: boolean = false) => {
    setStatus(alreadyVerified ? 'already' : 'success');
    setStatusMessage(null);
    void queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });

    // Automatically transition to onboarding after a short delay for smoothness
    setTimeout(() => {
      setLocation('/onboarding');
    }, 1500);
  };

  const verifyToken = (code: string) => {
    verifyMutation.mutate({ data: { code } }, {
      onSuccess: (data) => {
        handleSuccess(data.alreadyVerified);
      },
      onError: (err: any) => {
        const verificationError = normalizeApiError(err, t('auth.verifyUnavailable'));
        setStatusMessage(verificationError.message);
        const errorStatus = verificationError.status;
        if (
          errorStatus === 400 ||
          errorStatus === 401 ||
          errorStatus === 410 ||
          errorStatus === 422 ||
          errorStatus === 423
        ) {
          setStatus('invalid');
        } else {
          setStatus('unavailable');
        }
      }
    });
  };

  useEffect(() => {
    if (initialContext.token && !autoVerified.current) {
      autoVerified.current = true;
      verifyToken(initialContext.token);
    }
  }, [initialContext.token]);

  const onSubmit = (data: VerifyValues) => {
    verifyToken(data.token.trim());
  };

  const handleResend = () => {
    if (resendCooldown > 0 || resendMutation.isPending) return;
    setResendStatus('sending');
    setResendMessage(null);
    resendMutation.mutate(undefined, {
      onSuccess: (data) => {
        if (
          data.verificationDelivery !== 'email' &&
          data.verificationDelivery !== 'development'
        ) {
          setResendStatus('error');
          setResendMessage(t('auth.verifyUnavailable'));
          return;
        }
        if (data.code) {
          form.setValue('token', data.code, { shouldValidate: true });
          setStatus('idle');
          setStatusMessage(null);
        }
        setResendCooldown(
          typeof data.retryAfter === 'number' && data.retryAfter > 0
            ? Math.ceil(data.retryAfter)
            : 0,
        );
        setResendMessage(data.message);
        setResendStatus('sent');
      },
      onError: (err: unknown) => {
        const resendError = normalizeApiError(err, t('auth.verifyUnavailable'));
        const retryAfter = getRetryAfter(err);
        setResendMessage(resendError.message);
        if (resendError.status === 429) {
          setResendCooldown(retryAfter);
          setResendStatus('cooldown');
        } else {
          setResendStatus('error');
        }
      }
    });
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center p-6 relative overflow-x-hidden overflow-y-auto">
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 rounded-full opacity-20 blur-3xl animate-pulse pointer-events-none" style={{ background: 'rgba(255,45,122,0.6)' }} />
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 rounded-full opacity-20 blur-3xl animate-pulse pointer-events-none" style={{ background: 'rgba(139,92,246,0.6)', animationDelay: '1s' }} />

      <div className="w-full max-w-sm z-10 flex flex-col items-center my-auto">
        <Wordmark />

        <div className="glass rounded-2xl p-6 w-full mt-8">
          <h2 className="font-serif text-2xl text-foreground mb-2">{t('auth.verifyTitle')}</h2>

          {status === 'success' || status === 'already' ? (
            <div className="flex flex-col items-center text-center py-4" data-testid="status-verify-success">
              <div className="w-12 h-12 rounded-full glass flex items-center justify-center mb-3 glow-cyan">
                <CheckCircle2 className="w-6 h-6 text-cyan-400" />
              </div>
              <p className="text-foreground text-sm leading-relaxed mb-4">
                {status === 'already' ? t('auth.verifyAlready') : t('auth.verifySuccess')}
              </p>
              <button
                type="button"
                data-testid="button-go-to-login"
                onClick={() => setLocation('/onboarding')}
                className="btn-glow w-full h-11 text-sm flex items-center justify-center"
              >
                {t('common.continue')}
              </button>
            </div>
          ) : status === 'invalid' || status === 'unavailable' ? (
            <div className="flex flex-col items-center text-center py-4" data-testid="status-verify-error">
              <p className="text-foreground text-sm leading-relaxed mb-4">
                {statusMessage ?? (status === 'invalid' ? t('auth.verifyInvalid') : t('auth.verifyUnavailable'))}
              </p>
              <button
                type="button"
                data-testid="button-resend-verification"
                onClick={handleResend}
                disabled={resendStatus === 'sending' || resendCooldown > 0}
                className="glass rounded-xl w-full h-11 text-sm font-semibold flex items-center justify-center gap-2 text-foreground hover:bg-muted/70 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
              >
                {resendStatus === 'sending' ? <Loader2 className="w-4 h-4 animate-spin" /> : <MailCheck className="w-4 h-4" />}
                {resendCooldown > 0
                  ? `${resendStatus === 'sent' ? t('auth.verifyResent') : t('auth.verifyCooldown')} (${resendCooldown}s)`
                  : t('auth.verifyResend')}
              </button>
              {resendMessage && (
                <p
                  className={`text-xs pt-2 ${resendStatus === 'error' ? 'text-red-400' : 'text-muted-foreground'}`}
                  data-testid="text-resend-status"
                  role={resendStatus === 'error' ? 'alert' : 'status'}
                >
                  {resendMessage}
                </p>
              )}

              <button
                type="button"
                onClick={() => setStatus('idle')}
                className="mt-4 rounded-sm text-xs font-semibold text-primary hover:text-primary/80 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                 {t('auth.verifyTryAgain')}
              </button>
            </div>
          ) : (
            <>
              <p className="text-muted-foreground font-medium text-sm mb-5">{t('auth.verifySubtitle')}</p>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="token"
                    render={({ field }) => (
                      <FormItem className="flex flex-col items-center">
                        <FormControl>
                          <InputOTP
                            maxLength={6}
                            value={field.value}
                            onChange={field.onChange}
                            containerClassName="gap-2"
                            data-testid="input-verify-token"
                          >
                            <InputOTPGroup className="gap-2">
                              {[0, 1, 2, 3, 4, 5].map((index) => (
                                <InputOTPSlot
                                  key={index}
                                  index={index}
                                  className="w-10 h-12 text-lg glass-input text-foreground rounded-lg border-input focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                                />
                              ))}
                            </InputOTPGroup>
                          </InputOTP>
                        </FormControl>
                        <FormMessage className="text-destructive text-xs font-medium mt-2" />
                      </FormItem>
                    )}
                  />
                  <button
                    type="submit"
                    disabled={verifyMutation.isPending || form.watch('token').length !== 6}
                    data-testid="button-verify-submit"
                    className="btn-glow w-full h-12 text-base mt-4 flex items-center justify-center disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
                  >
                    {verifyMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
                    {verifyMutation.isPending ? t('auth.verifying') : t('auth.verifySubmit')}
                  </button>
                </form>
              </Form>

              <div className="mt-6 text-center">
                <button
                  type="button"
                  data-testid="button-resend-verification"
                  onClick={handleResend}
                  disabled={resendStatus === 'sending' || resendCooldown > 0}
                  className="rounded-sm text-sm font-semibold text-primary hover:text-primary/80 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
                >
                  {resendStatus === 'sending'
                    ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                    : null}
                  {resendCooldown > 0
                    ? `${resendStatus === 'sent' ? t('auth.verifyResent') : t('auth.verifyCooldown')} (${resendCooldown}s)`
                    : t('auth.verifyResend')}
                </button>
                {resendMessage && (
                  <p
                    className={`pt-2 text-xs ${resendStatus === 'error' ? 'text-red-400' : 'text-muted-foreground'}`}
                    data-testid="text-resend-status"
                    role={resendStatus === 'error' ? 'alert' : 'status'}
                  >
                    {resendMessage}
                  </p>
                )}
              </div>
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

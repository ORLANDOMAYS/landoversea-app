import { useLocation, Link } from 'wouter';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Loader2, User, Mail, Lock, ChevronRight, Globe, ShieldCheck } from 'lucide-react';
import { useI18n } from '@/i18n';
import { LOCALE_META, type Locale } from '@/i18n/types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { buildAuthCallbackUrl, getAuthCallbackOrigin } from '@/lib/auth-flow';
import { getEmailRetryAfter } from '@/lib/password-recovery';
import BrandLogo from '@/components/brand/BrandLogo';

type RegisterStep = 'language' | 'age' | 'email';

export default function Register() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t, setLocale, locale } = useI18n();
  const [sending, setSending] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const signupInFlight = useRef(false);
  const resendInFlight = useRef(false);

  const [step, setStep] = useState<RegisterStep>('language');
  const [selectedLocale, setSelectedLocale] = useState<Locale>(locale);
  const [acceptedAgeRequirement, setAcceptedAgeRequirement] = useState(false);

  const registerSchema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(2, t('auth.validNameMin')).max(100, t('auth.validNameMax')),
        email: z.string().trim().email(t('auth.validEmail')).max(320, t('auth.validEmailLong')),
        password: z.string().min(8, t('auth.validPasswordMin')).max(128, 'Password is too long'),
        confirmPassword: z.string().min(1, t('auth.confirmPassword')),
      }).refine((values) => values.password === values.confirmPassword, {
        path: ['confirmPassword'],
        message: t('auth.passwordsMismatch'),
      }),
    [t],
  );

  const form = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '', confirmPassword: '' },
  });

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(
      () => setResendCooldown((current) => Math.max(0, current - 1)),
      1_000,
    );
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  const onSubmit = async (data: z.infer<typeof registerSchema>) => {
    if (!acceptedAgeRequirement) {
      setStep('age');
      return;
    }
    if (signupInFlight.current || resendInFlight.current || resendCooldown > 0) return;
    signupInFlight.current = true;
    setSending(true);
    setLinkSent(false);
    try {
      const { data: signUp, error } = await getSupabase().auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          emailRedirectTo: buildAuthCallbackUrl(
            getAuthCallbackOrigin(),
            import.meta.env.BASE_URL,
            '/onboarding',
          ),
          data: { display_name: data.name, locale: selectedLocale, accepted_age_requirement: true },
        },
      });
      if (error) throw error;
      if (signUp.session) {
        setLocation('/onboarding', { replace: true });
        return;
      }
      setLinkSent(true);
      setResendCooldown(60);
      toast({ title: t('auth.applicationSubmitted'), description: 'Check your email to verify your account.' });
    } catch (error) {
      const emailRetryAfter = getEmailRetryAfter(error);
      if (emailRetryAfter > 0) setResendCooldown(emailRetryAfter);
      const message = emailRetryAfter > 0
        ? t('auth.verifyCooldown')
        : error instanceof Error
          ? error.message
          : t('auth.registrationError');
      form.setError('email', { type: 'server', message });
      toast({ title: t('auth.registrationFailed'), description: message, variant: 'destructive' });
    } finally {
      signupInFlight.current = false;
      setSending(false);
    }
  };

  const resendVerification = async () => {
    if (signupInFlight.current || resendInFlight.current || resendCooldown > 0) return;
    resendInFlight.current = true;
    setResending(true);
    try {
      const email = form.getValues('email').trim();
      const { error } = await getSupabase().auth.resend({
        type: 'signup',
        email,
        options: {
          emailRedirectTo: buildAuthCallbackUrl(
            getAuthCallbackOrigin(),
            import.meta.env.BASE_URL,
            '/onboarding',
          ),
        },
      });
      if (error) throw error;
      setResendCooldown(60);
      toast({ title: t('auth.verifyResent'), description: 'Check your email for a new verification link.' });
    } catch (error) {
      const emailRetryAfter = getEmailRetryAfter(error);
      if (emailRetryAfter > 0) setResendCooldown(emailRetryAfter);
      const message = emailRetryAfter > 0
        ? t('auth.verifyCooldown')
        : error instanceof Error
          ? error.message
          : t('auth.verifyUnavailable');
      toast({ title: t('auth.registrationFailed'), description: message, variant: 'destructive' });
    } finally {
      resendInFlight.current = false;
      setResending(false);
    }
  };

  return (
    <div
      className="relative flex min-h-[100dvh] w-full min-w-0 max-w-full flex-col items-center overflow-x-hidden overflow-y-auto overscroll-y-contain"
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingRight: 'max(1rem, env(safe-area-inset-right))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(1rem, env(safe-area-inset-left))',
      }}
    >
      {/* Nebula blobs */}
      <div className="fixed top-[-10%] right-[-10%] w-96 h-96 rounded-full opacity-20 blur-3xl animate-pulse pointer-events-none" style={{ background: 'rgba(139,92,246,0.6)' }} />
      <div className="fixed bottom-[-10%] left-[-10%] w-96 h-96 rounded-full opacity-20 blur-3xl animate-pulse pointer-events-none" style={{ background: 'rgba(255,45,122,0.6)', animationDelay: '1s' }} />

      <div className="relative z-10 my-auto flex w-full min-w-0 max-w-sm flex-col items-center py-2 sm:py-4">
        {/* Brand */}
        <div className="mb-0 w-full text-center sm:mb-2">
          <BrandLogo className="mx-auto h-20 w-full max-w-[320px] sm:h-24" />
          <p className="mt-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {t('common.tagline')}
          </p>
        </div>

        {/* Glass card */}
        <div
          className="glass mt-4 w-full min-w-0 max-w-full rounded-2xl p-4 sm:mt-6 sm:p-6"
          data-testid="card-register"
        >

          {step === 'language' && (
            <div className="min-w-0 max-w-full animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="flex items-center gap-2 mb-3 sm:mb-4">
                <Globe className="w-5 h-5 text-primary" />
                <h2 className="font-serif text-xl text-foreground">{t('auth.chooseLanguage')}</h2>
              </div>
              <p className="mb-5 text-sm font-medium text-muted-foreground">{t('auth.changeLanguageLater')}</p>

              <div className="max-h-60 overflow-y-auto pe-2 space-y-2 mb-5 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                {Object.values(LOCALE_META).map((meta) => (
                  <button
                    key={meta.code}
                    type="button"
                    data-testid={`button-register-locale-${meta.code}`}
                    onClick={() => setSelectedLocale(meta.code)}
                    className={`flex min-h-12 w-full min-w-0 items-center justify-between gap-3 rounded-xl border p-3 text-start transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                      selectedLocale === meta.code
                        ? 'bg-primary/15 border-primary/60 text-foreground ring-1 ring-inset ring-primary/25'
                        : 'glass-input border-input text-foreground hover:bg-muted/70'
                    }`}
                  >
                    <span className="min-w-0 font-medium">{meta.label}</span>
                    <span className="min-w-0 text-end text-xs text-muted-foreground">{meta.englishName}</span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                data-testid="button-register-continue-language"
                onClick={() => {
                  setLocale(selectedLocale);
                  setStep('age');
                }}
                className="btn-glow flex min-h-12 w-full items-center justify-center gap-2 px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {t('common.continue')} <ChevronRight className="w-4 h-4 rtl:rotate-180" />
              </button>
            </div>
          )}

          {step === 'age' && (
            <div className="min-w-0 max-w-full animate-in fade-in slide-in-from-right-4 duration-300">
              <button
                type="button"
                data-testid="button-register-back-language"
                onClick={() => setStep('language')}
                className="-ms-2 mb-2 flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-primary transition-colors hover:text-primary/80 outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <ChevronRight className="w-4 h-4 rotate-180 rtl:rotate-0" /> {t('common.back')}
              </button>

              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck className="w-5 h-5 text-primary" />
                <h2 className="font-serif text-xl text-foreground">{t('auth.ageVerification')}</h2>
              </div>
              <p className="text-sm text-foreground mb-3 leading-relaxed">
                {t('auth.adultsOnly')}
              </p>
              <p className="text-xs text-muted-foreground font-medium mb-5">
                {t('auth.ageOnboarding')}
              </p>

              <div className="space-y-3">
                <button
                  type="button"
                  data-testid="button-register-confirm-age"
                  onClick={() => {
                    setAcceptedAgeRequirement(true);
                    setStep('email');
                  }}
                  className="btn-glow flex min-h-12 w-full items-center justify-center px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                   {t('auth.ageConfirm')}
                </button>
                <button
                  type="button"
                  data-testid="button-register-under-age"
                  onClick={() => {
                    toast({
                       title: t('auth.cannotContinue'),
                       description: t('auth.mustBeAdult'),
                      variant: "destructive"
                    });
                  }}
                  className="glass flex min-h-12 w-full items-center justify-center rounded-full px-4 text-base text-foreground transition-colors hover:bg-muted/70 outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                   {t('auth.underAge')}
                </button>
              </div>
            </div>
          )}

          {step === 'email' && (
            <div className="w-full min-w-0 max-w-full animate-in fade-in slide-in-from-right-4 duration-300">
              <button
                type="button"
                data-testid="button-register-back-age"
                onClick={() => setStep('age')}
                disabled={sending || resending}
                className="-ms-2 mb-2 flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-primary transition-colors hover:text-primary/80 outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <ChevronRight className="w-4 h-4 rotate-180 rtl:rotate-0" /> {t('common.back')}
              </button>

              <h2 className="mb-1 font-serif text-xl text-foreground sm:text-2xl">{t('auth.createAccount')}</h2>
              <p className="mb-4 text-sm font-medium text-muted-foreground sm:mb-5">
                Create a password, then verify your email before signing in.
              </p>

              {linkSent ? (
                <div className="space-y-4 text-center" data-testid="status-register-verification-pending">
                  <Mail className="mx-auto h-10 w-10 text-cyan-400" />
                  <p role="status" className="rounded-xl border border-green-400/30 bg-green-500/10 p-3 text-sm text-green-300">
                    Check your email to verify your account before signing in.
                  </p>
                  <button
                    type="button"
                    data-testid="button-register-resend-verification"
                    onClick={resendVerification}
                    disabled={sending || resending || resendCooldown > 0}
                    className="btn-glow flex min-h-12 w-full items-center justify-center px-4 disabled:bg-muted disabled:text-muted-foreground"
                  >
                    {resending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                    {resendCooldown > 0
                      ? `${t('auth.verifyCooldown')} (${resendCooldown}s)`
                      : t('auth.verifyResend')}
                  </button>
                  <button
                    type="button"
                    data-testid="button-register-edit-email"
                    disabled={sending || resending}
                    onClick={() => setLinkSent(false)}
                    className="text-sm font-semibold text-primary hover:text-primary/80 disabled:text-muted-foreground"
                  >
                    Edit email
                  </button>
                </div>
              ) : <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="w-full min-w-0 max-w-full space-y-3"
                  noValidate
                >
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem className="min-w-0 max-w-full space-y-1">
                        <FormLabel className="block text-sm font-semibold text-foreground">
                          {t('auth.namePlaceholder')}
                        </FormLabel>
                        <div className="group relative w-full min-w-0 max-w-full">
                          <User aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                          <FormControl>
                            <input
                              type="text"
                              autoComplete="name"
                              autoCapitalize="words"
                              enterKeyHint="next"
                              placeholder={t('auth.namePlaceholder')}
                              data-testid="input-register-name"
                              {...field}
                              className="glass-input block min-h-12 w-full min-w-0 max-w-full appearance-none rounded-xl py-2.5 ps-10 pe-3 text-base leading-6 text-foreground caret-primary outline-none placeholder:text-muted-foreground transition-[border-color,box-shadow] focus:border-primary/70 focus:ring-2 focus:ring-primary/25"
                            />
                          </FormControl>
                        </div>
                        <FormMessage className="max-w-full break-words text-xs font-medium text-destructive" />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem className="min-w-0 max-w-full space-y-1">
                        <FormLabel className="block text-sm font-semibold text-foreground">
                          {t('auth.email')}
                        </FormLabel>
                        <div className="group relative w-full min-w-0 max-w-full">
                          <Mail aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                          <FormControl>
                            <input
                              type="email"
                              autoComplete="email"
                              autoCapitalize="none"
                              autoCorrect="off"
                              inputMode="email"
                              enterKeyHint="next"
                              spellCheck={false}
                              placeholder="hello@world.com"
                              data-testid="input-register-email"
                              {...field}
                              className="glass-input block min-h-12 w-full min-w-0 max-w-full appearance-none rounded-xl py-2.5 ps-10 pe-3 text-base leading-6 text-foreground caret-primary outline-none placeholder:text-muted-foreground transition-[border-color,box-shadow] focus:border-primary/70 focus:ring-2 focus:ring-primary/25"
                            />
                          </FormControl>
                        </div>
                        <FormMessage className="max-w-full break-words text-xs font-medium text-destructive" />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem className="min-w-0 max-w-full space-y-1">
                        <FormLabel className="block text-sm font-semibold text-foreground">
                          {t('auth.password')}
                        </FormLabel>
                        <div className="group relative w-full min-w-0 max-w-full">
                          <Lock aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                          <FormControl>
                            <input
                              type="password"
                              autoComplete="new-password"
                              data-testid="input-register-password"
                              {...field}
                              className="glass-input block min-h-12 w-full min-w-0 max-w-full appearance-none rounded-xl py-2.5 ps-10 pe-3 text-base leading-6 text-foreground caret-primary outline-none placeholder:text-muted-foreground transition-[border-color,box-shadow] focus:border-primary/70 focus:ring-2 focus:ring-primary/25"
                            />
                          </FormControl>
                        </div>
                        <FormMessage className="max-w-full break-words text-xs font-medium text-destructive" />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem className="min-w-0 max-w-full space-y-1">
                        <FormLabel className="block text-sm font-semibold text-foreground">
                          {t('auth.confirmPassword')}
                        </FormLabel>
                        <div className="group relative w-full min-w-0 max-w-full">
                          <Lock aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                          <FormControl>
                            <input
                              type="password"
                              autoComplete="new-password"
                              data-testid="input-register-confirm-password"
                              {...field}
                              className="glass-input block min-h-12 w-full min-w-0 max-w-full appearance-none rounded-xl py-2.5 ps-10 pe-3 text-base leading-6 text-foreground caret-primary outline-none placeholder:text-muted-foreground transition-[border-color,box-shadow] focus:border-primary/70 focus:ring-2 focus:ring-primary/25"
                            />
                          </FormControl>
                        </div>
                        <FormMessage className="max-w-full break-words text-xs font-medium text-destructive" />
                      </FormItem>
                    )}
                  />
                  <button
                    type="submit"
                    data-testid="button-register-submit"
                    disabled={sending || resending || resendCooldown > 0}
                    className="btn-glow mt-2 flex min-h-12 w-full min-w-0 items-center justify-center px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
                  >
                    {sending ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : null}
                    {sending
                      ? 'Creating account…'
                      : resendCooldown > 0
                        ? `${t('auth.verifyCooldown')} (${resendCooldown}s)`
                        : t('auth.createAccount')}
                  </button>

                  <p className="max-w-full break-words px-1 pt-1 text-center text-xs font-medium leading-relaxed text-muted-foreground">
                    {t('auth.termsAgree')}{' '}
                    <Link
                      href="/terms"
                      data-testid="link-register-terms"
                      className="rounded-sm font-semibold text-foreground underline underline-offset-2 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    >
                      {t('auth.termsLink')}
                    </Link>
                    {' & '}
                    <Link
                      href="/privacy"
                      data-testid="link-register-privacy"
                      className="rounded-sm font-semibold text-foreground underline underline-offset-2 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    >
                      {t('auth.privacyLink')}
                    </Link>
                  </p>
                </form>
              </Form>}
            </div>
          )}
        </div>

        {/* Sign in link */}
        <p className="mt-4 flex min-h-11 max-w-full flex-wrap items-center justify-center gap-x-1 text-center text-sm font-medium text-muted-foreground sm:mt-5">
          {t('auth.alreadyMember')}{' '}
          <Link
            href="/login"
            data-testid="link-register-sign-in"
            className="inline-flex min-h-11 items-center rounded-lg px-1 font-semibold text-accent transition-colors hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            {t('auth.signInLink')}
          </Link>
        </p>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useLocation, Link } from 'wouter';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Lock, Mail } from 'lucide-react';
import { useI18n } from '@/i18n';
import { getSupabase, supabaseConfigurationError } from '@/lib/supabase';
import { buildAuthCallbackUrl, getAuthCallbackOrigin, validateSameAppDestination } from '@/lib/auth-flow';
import { getEmailRetryAfter } from '@/lib/password-recovery';
import BrandLogo from '@/components/brand/BrandLogo';

const loginSchema = z.object({
  email: z.string().trim().email('Please enter a valid email').max(320, 'Email is too long'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128, 'Password is too long'),
});

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useI18n();
  const [sending, setSending] = useState(false);
  const [sendingMagicLink, setSendingMagicLink] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [magicLinkCooldown, setMagicLinkCooldown] = useState(0);
  const passwordInFlight = useRef(false);
  const magicLinkInFlight = useRef(false);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  // Explicit success signal after account deletion hard-navigates here.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('deleted') === '1') {
      toast({ title: t('profile.deleteSuccess') });
      // Strip the signal so a reload does not re-toast.
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [toast, t]);

  useEffect(() => {
    if (magicLinkCooldown <= 0) return;
    const timer = window.setTimeout(
      () => setMagicLinkCooldown((current) => Math.max(0, current - 1)),
      1_000,
    );
    return () => window.clearTimeout(timer);
  }, [magicLinkCooldown]);

  const onSubmit = async (data: z.infer<typeof loginSchema>) => {
    if (passwordInFlight.current || magicLinkInFlight.current) return;
    passwordInFlight.current = true;
    setSending(true);
    try {
      const next = validateSameAppDestination(
        new URLSearchParams(window.location.search).get('next'),
      );
      const { error } = await getSupabase().auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });
      if (error) throw error;
      setLocation(next ?? '/discover', { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : supabaseConfigurationError;
      form.setError('email', { type: 'server', message });
      toast({ title: t('auth.loginFailed'), description: message, variant: 'destructive' });
    } finally {
      passwordInFlight.current = false;
      setSending(false);
    }
  };

  const requestMagicLink = async () => {
    if (passwordInFlight.current || magicLinkInFlight.current || magicLinkCooldown > 0) return;
    magicLinkInFlight.current = true;
    setSendingMagicLink(true);
    const emailValid = await form.trigger('email');
    if (!emailValid) {
      magicLinkInFlight.current = false;
      setSendingMagicLink(false);
      return;
    }
    try {
      const next = validateSameAppDestination(
        new URLSearchParams(window.location.search).get('next'),
      );
      const { error } = await getSupabase().auth.signInWithOtp({
        email: form.getValues('email').trim(),
        options: {
          shouldCreateUser: false,
          emailRedirectTo: buildAuthCallbackUrl(
            getAuthCallbackOrigin(),
            import.meta.env.BASE_URL,
            next,
          ),
        },
      });
      if (error) throw error;
      setMagicLinkSent(true);
      setMagicLinkCooldown(60);
      toast({ title: 'Magic link sent', description: 'Check your email for your sign-in link.' });
    } catch (error) {
      const emailRetryAfter = getEmailRetryAfter(error);
      if (emailRetryAfter > 0) setMagicLinkCooldown(emailRetryAfter);
      const message = emailRetryAfter > 0
        ? t('auth.verifyCooldown')
        : error instanceof Error
          ? error.message
          : supabaseConfigurationError;
      form.setError('email', { type: 'server', message });
      toast({ title: t('auth.loginFailed'), description: message, variant: 'destructive' });
    } finally {
      magicLinkInFlight.current = false;
      setSendingMagicLink(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center p-6 relative overflow-x-hidden overflow-y-auto">
      {/* Nebula blobs */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 rounded-full opacity-20 blur-3xl animate-pulse pointer-events-none" style={{ background: 'rgba(255,45,122,0.6)' }} />
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 rounded-full opacity-20 blur-3xl animate-pulse pointer-events-none" style={{ background: 'rgba(139,92,246,0.6)', animationDelay: '1s' }} />

      <div className="w-full max-w-sm z-10 flex flex-col items-center my-auto">
        {/* Brand */}
        <div className="mb-2 w-full text-center">
          <BrandLogo className="mx-auto h-24 w-full max-w-[340px]" />
          <p className="text-xs tracking-widest uppercase text-muted-foreground font-medium font-sans mt-1">
            {t('common.tagline')}
          </p>
        </div>

        {/* Glass card */}
        <div className="glass rounded-2xl p-6 w-full mt-8">
          <h2 className="font-serif text-2xl text-foreground mb-5">{t('auth.welcomeBack')}</h2>
          <p className="text-sm text-muted-foreground -mt-3 mb-5">
            Sign in with the email and password for your verified LandOverSEA account.
          </p>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <label htmlFor="login-email" className="block text-sm font-semibold text-foreground mb-1.5">
                      {t('auth.email')}
                    </label>
                    <FormControl>
                      <div className="relative group">
                        <Mail aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
                        <input
                          id="login-email"
                          type="email"
                          autoComplete="username"
                          placeholder="hello@world.com"
                          {...field}
                          className="glass-input w-full rounded-xl p-3 pl-10 text-sm text-foreground caret-primary outline-none placeholder:text-muted-foreground placeholder:opacity-100 focus:border-primary/70 focus:ring-2 focus:ring-primary/25 transition-[border-color,box-shadow]"
                        />
                      </div>
                    </FormControl>
                    <FormMessage className="text-destructive text-xs font-medium" />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <label htmlFor="login-password" className="block text-sm font-semibold text-foreground mb-1.5">
                      {t('auth.password')}
                    </label>
                    <FormControl>
                      <div className="relative group">
                        <Lock aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
                        <input
                          id="login-password"
                          type="password"
                          autoComplete="current-password"
                          data-testid="input-login-password"
                          {...field}
                          className="glass-input w-full rounded-xl p-3 pl-10 text-sm text-foreground caret-primary outline-none placeholder:text-muted-foreground placeholder:opacity-100 focus:border-primary/70 focus:ring-2 focus:ring-primary/25 transition-[border-color,box-shadow]"
                        />
                      </div>
                    </FormControl>
                    <FormMessage className="text-destructive text-xs font-medium" />
                  </FormItem>
                )}
              />

              <button
                type="submit"
                 disabled={sending || sendingMagicLink}
                className="btn-glow w-full h-12 text-base mt-2 flex items-center justify-center disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
              >
                {sending ? (
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                ) : null}
                {sending ? t('auth.signingIn') : t('auth.signIn')}
              </button>
            </form>
          </Form>

          <button
            type="button"
            data-testid="button-login-magic-link"
            onClick={requestMagicLink}
            disabled={sending || sendingMagicLink || magicLinkCooldown > 0}
            className="glass mt-3 flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold text-foreground hover:bg-muted/70 disabled:text-muted-foreground"
          >
            {sendingMagicLink ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Mail className="me-2 h-4 w-4" />}
            {sendingMagicLink
              ? 'Sending…'
              : magicLinkCooldown > 0
                ? `Request another sign-in link in ${magicLinkCooldown}s`
                : 'Email me a magic sign-in link'}
          </button>
          {magicLinkSent && (
            <p role="status" className="mt-2 text-center text-xs text-muted-foreground">
              Check your email for the sign-in link.
            </p>
          )}

          {/* Forgot password link */}
          <div className="mt-4 text-center">
            <Link
              href="/forgot-password"
              data-testid="link-forgot-password"
              className="rounded-sm text-sm font-medium text-primary hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-colors"
            >
              {t('auth.forgotPassword')}
            </Link>
          </div>
        </div>

        {/* Register link */}
        <p className="mt-6 text-sm text-muted-foreground">
          {t('auth.newToApp')}{' '}
          <Link href="/register" className="rounded-sm text-primary hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-colors font-semibold">
            {t('auth.joinNow')} →
          </Link>
        </p>
      </div>
    </div>
  );
}

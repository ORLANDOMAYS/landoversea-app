import { type ReactNode, useRef } from 'react';
import { useLocation, Redirect } from 'wouter';
import { type User } from '@workspace/api-client-react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useQuery } from '@tanstack/react-query';
import { getProfile } from '@/lib/supabase-api';
import { isProfileComplete } from '@/lib/auth-flow';

const PUBLIC_ROUTES = [
  '/login',
  '/auth/callback',
  '/register',
  '/terms',
  '/privacy',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/delete-account',
];

interface AuthGuardProps {
  children: (user: User | undefined) => ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const [location] = useLocation();
  const auth = useAuth();
  const confirmedCompleteUserIdRef = useRef<string | null>(null);
  // Route access is based on the pathname only. Query parameters carry
  // recovery/verification state and must not turn a public page into a
  // protected route (for example /verify-email?token=... or /login?deleted=1).
  const routePath = location.split(/[?#]/, 1)[0];
  const isPublic = PUBLIC_ROUTES.some((r) => routePath === r || routePath.startsWith(r + '/'));

  const { data: user, isLoading, isError, error, refetch, isFetching } = useQuery({
    // This query returns the generated API User shape, not the full Supabase
    // profile used by page surfaces. Keep the cache keys distinct so the guard
    // cannot replace a profile (and its photos) with its smaller gate model.
    queryKey: ['supabase', 'profile-gate', auth.user?.id],
    enabled: !isPublic && Boolean(auth.user),
    queryFn: async (): Promise<User> => {
      if (!auth.user) throw new Error('Authentication required.');
      const profile = await getProfile(auth.user.id);
      // The generated API model predates UUID auth IDs. This numeric value is
      // presentation-only; ownership is always derived from auth.uid().
      const presentationId = [...auth.user.id].reduce(
        (value, character) => ((value * 31 + character.charCodeAt(0)) >>> 0),
        0,
      );
      return {
        id: presentationId,
        email: auth.user.email ?? '',
        name: profile?.display_name ?? auth.user.user_metadata?.display_name ?? '',
        role: 'user',
        isProfileComplete: isProfileComplete(profile),
        isPremium: profile?.premium ?? false,
        isEmailVerified: Boolean(auth.user.email_confirmed_at),
        verificationRequired: false,
        createdAt: auth.user.created_at,
      };
    },
    retry: 1,
    staleTime: 30_000,
  });
  if (confirmedCompleteUserIdRef.current !== (auth.user?.id ?? null)) {
    confirmedCompleteUserIdRef.current = null;
  }
  if (auth.user && user?.isProfileComplete) {
    confirmedCompleteUserIdRef.current = auth.user.id;
  }
  const profileCompletionConfirmed = Boolean(
    user?.isProfileComplete ||
    (auth.user && confirmedCompleteUserIdRef.current === auth.user.id),
  );

  // ── Public pages: render immediately, no auth check ───────────────────────
  if (isPublic) return <>{children(undefined)}</>;

  if (auth.loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (auth.error) {
    return (
      <div className="h-screen flex flex-col gap-4 items-center justify-center px-6 text-center bg-background" role="alert">
        <p className="text-foreground font-medium">Couldn't verify your session</p>
        <p className="text-muted-foreground text-sm">{auth.error.message}</p>
        <button type="button" className="btn-glow rounded-full px-6 py-2.5" onClick={auth.retry}>Retry</button>
      </div>
    );
  }

  if (!auth.session) return <Redirect to="/login" />;

  // Supabase is the session owner. Profile read failures stay recoverable at
  // the current URL and are never interpreted as an anonymous session.
  if (isError) {
    return (
      <div className="h-screen flex flex-col gap-4 items-center justify-center px-6 text-center bg-background" role="alert">
        <p className="text-foreground font-medium">Couldn't verify your session</p>
        <p className="text-muted-foreground text-sm">Check your connection and try again.</p>
        <button
          type="button"
          className="btn-glow rounded-full px-6 py-2.5 disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
          disabled={isFetching}
          onClick={() => refetch()}
        >
          {isFetching ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    );
  }

  // ── Onboarding special-case: auth required but profile need not be complete
  if (location === '/onboarding') {
    if (isLoading) {
      return (
        <div className="h-screen flex items-center justify-center bg-background">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      );
    }
    if (!user) return <Redirect to="/login" />;
    return <>{children(user)}</>;
  }

  // ── Protected pages: show spinner only on the very first session load ─────
  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // ── Not authenticated → login ─────────────────────────────────────────────
  if (!user) return <Redirect to="/login" />;

  // ── Authenticated but verification required → verify email ───────────────
  if (user.verificationRequired && !user.isEmailVerified) return <Redirect to="/verify-email" />;

  // ── Authenticated but onboarding not complete → onboarding ───────────────
  if (!profileCompletionConfirmed) return <Redirect to="/onboarding" />;

  return <>{children(user)}</>;
}

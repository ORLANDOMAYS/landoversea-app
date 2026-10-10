import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import { getSupabase } from './supabase';

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  error: Error | null;
  retry: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

// The generated client remains the bridge for richer server-owned features.
// Reading the token for each request avoids stale access tokens after refresh.
setAuthTokenGetter(async () => {
  try {
    const { data } = await getSupabase().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let previousUserId: string | null = null;
    let subscription: { unsubscribe: () => void } | undefined;

    try {
      const client = getSupabase();
      void client.auth.getSession().then(({ data, error: sessionError }) => {
        if (!active) return;
        if (sessionError) {
          setError(sessionError);
        } else {
          previousUserId = data.session?.user.id ?? null;
          setSession(data.session);
          setError(null);
        }
        setLoading(false);
      });

      const result = client.auth.onAuthStateChange((_event, nextSession) => {
        if (!active) return;
        const nextUserId = nextSession?.user.id ?? null;
        if (nextUserId !== previousUserId) {
          // Never allow cached data from one identity to be observed by another.
          queryClient.clear();
          previousUserId = nextUserId;
        }
        setSession(nextSession);
        setError(null);
        setLoading(false);
      });
      subscription = result.data.subscription;
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error('Unable to initialize authentication.'));
      setLoading(false);
    }

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, [attempt, queryClient]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      error,
      retry: () => {
        setLoading(true);
        setError(null);
        setAttempt((value) => value + 1);
      },
    }),
    [session, loading, error],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider.');
  return value;
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const { data, error } = await getSupabase().auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error('Authentication required.');
  const headers = new Headers(init.headers);
  if (!headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers, credentials: init.credentials ?? 'include' });
}

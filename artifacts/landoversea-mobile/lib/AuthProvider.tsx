import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseConfigurationError } from './supabase';
import { clearUserScopedCaches } from './auth';
import { PROFILE_PUBLIC_SELECT } from './profileColumns';

type Profile = Record<string, unknown> & { id: string };
type AuthState = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  error: Error | null;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

async function readProfile(userId: string): Promise<Profile | null> {
  if (!supabase) throw new Error(supabaseConfigurationError);
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_PUBLIC_SELECT)
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export function AuthProvider({ children }: React.PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const userIdRef = useRef<string | null>(null);
  const identityGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  const isCurrentIdentity = useCallback((expectedUserId: string | null, expectedGeneration: number) => (
    mountedRef.current
    && userIdRef.current === expectedUserId
    && identityGenerationRef.current === expectedGeneration
  ), []);

  const refreshProfile = useCallback(async () => {
    const expectedUserId = userIdRef.current;
    const expectedGeneration = identityGenerationRef.current;
    if (!expectedUserId) {
      setProfile(null);
      return;
    }
    try {
      const nextProfile = await readProfile(expectedUserId);
      if (isCurrentIdentity(expectedUserId, expectedGeneration)) {
        setProfile(nextProfile);
        setError(null);
      }
    } catch (cause) {
      if (isCurrentIdentity(expectedUserId, expectedGeneration)) {
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      }
      throw cause;
    }
  }, [isCurrentIdentity]);

  useEffect(() => {
    let active = true;
    mountedRef.current = true;
    if (!supabase) {
      setError(new Error(supabaseConfigurationError));
      setLoading(false);
      return;
    }
    const applySession = async (next: Session | null, clearCaches: boolean) => {
      if (!active) return;
      const expectedUserId = next?.user.id ?? null;
      if (userIdRef.current !== expectedUserId) {
        userIdRef.current = expectedUserId;
        identityGenerationRef.current += 1;
        setProfile(null);
      }
      const expectedGeneration = identityGenerationRef.current;
      setSession(next);
      setError(null);
      try {
        if (clearCaches) await clearUserScopedCaches();
        if (!isCurrentIdentity(expectedUserId, expectedGeneration)) return;
        const nextProfile = expectedUserId ? await readProfile(expectedUserId) : null;
        if (isCurrentIdentity(expectedUserId, expectedGeneration)) setProfile(nextProfile);
      } catch (cause) {
        if (isCurrentIdentity(expectedUserId, expectedGeneration)) {
          setError(cause instanceof Error ? cause : new Error(String(cause)));
        }
      } finally {
        if (isCurrentIdentity(expectedUserId, expectedGeneration)) setLoading(false);
      }
    };
    let authStateObserved = false;
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (authStateObserved) return;
      if (sessionError) {
        if (active) {
          setError(sessionError);
          setLoading(false);
        }
      } else {
        void applySession(data.session, false);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      authStateObserved = true;
      void applySession(next, userIdRef.current !== (next?.user.id ?? null));
    });
    return () => {
      active = false;
      mountedRef.current = false;
      identityGenerationRef.current += 1;
      listener.subscription.unsubscribe();
    };
  }, [isCurrentIdentity]);

  const value = useMemo<AuthState>(() => ({
    session,
    user: session?.user ?? null,
    profile,
    loading,
    error,
    refreshProfile,
  }), [session, profile, loading, error, refreshProfile]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
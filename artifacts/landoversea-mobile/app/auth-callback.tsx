import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';
import { createAuthCallbackUrl } from '@/lib/auth-callback-link';
import { parseAuthCallbackUrl } from '@/lib/auth-flow';
import { markPasswordRecoverySession } from '@/lib/password-recovery';
import { supabase, supabaseConfigurationError } from '@/lib/supabase';

const consumedCallbacks = new Set<string>();

function callbackIdentity(url: string, parsed: ReturnType<typeof parseAuthCallbackUrl>): string {
  if (parsed.kind === 'pkce') return `code:${parsed.code}`;
  if (parsed.kind === 'recovery-token') return `token:${parsed.tokenHash}`;
  return `url:${url}`;
}

function callbackUrlFromRouteParams(params: Record<string, string | string[] | undefined>): string | null {
  if (typeof params.callbackUrl === 'string') return params.callbackUrl;
  const query: Record<string, string> = {};
  for (const key of ['code', 'type', 'token_hash', 'error', 'error_description', 'access_token', 'refresh_token']) {
    const value = params[key];
    if (typeof value === 'string' && value) query[key] = value;
  }
  return Object.keys(query).length > 0 ? createAuthCallbackUrl(query) : null;
}

export default function AuthCallbackScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState(false);
  const [processingRecovery, setProcessingRecovery] = useState(false);
  const routeCallbackUrl = useMemo(
    () => callbackUrlFromRouteParams(params as Record<string, string | string[] | undefined>),
    [
      params.access_token,
      params.callbackUrl,
      params.code,
      params.error,
      params.error_description,
      params.refresh_token,
      params.token_hash,
      params.type,
    ],
  );

  useEffect(() => {
    let active = true;
    let completed = false;
    let operation = Promise.resolve(false);

    const complete = async (callbackUrl: string | null): Promise<boolean> => {
      let recovery = false;
      try {
        if (!supabase) throw new Error(supabaseConfigurationError);
        const parsed = parseAuthCallbackUrl(callbackUrl);
        recovery =
          parsed.kind === 'pkce' ||
          parsed.kind === 'recovery-token' ||
          parsed.kind === 'legacy' ||
          parsed.kind === 'error'
            ? parsed.isRecovery
            : false;
        if (active) setProcessingRecovery(recovery);
        if (parsed.kind === 'error' || parsed.kind === 'invalid') throw new Error(parsed.message);
        const identity = callbackIdentity(callbackUrl!, parsed);
        if (consumedCallbacks.has(identity)) {
          throw new Error('This sign-in link is invalid, expired, or has already been used.');
        }
        const { error: authError } =
          parsed.kind === 'pkce'
            ? await supabase.auth.exchangeCodeForSession(parsed.code)
            : parsed.kind === 'recovery-token'
              ? await supabase.auth.verifyOtp({
                  token_hash: parsed.tokenHash,
                  type: 'recovery',
                })
              : await supabase.auth.setSession({
                  access_token: parsed.accessToken,
                  refresh_token: parsed.refreshToken,
                });
        if (authError) throw authError;
        consumedCallbacks.add(identity);
        if (parsed.isRecovery) {
          await markPasswordRecoverySession();
          completed = true;
          if (active) router.replace('/(auth)/reset-password');
          return true;
        }

        completed = true;
        if (active) router.replace('/');
        return true;
      } catch (cause) {
        if (active) {
          setRecoveryError(recovery);
          setError(
            recovery
              ? 'This password reset link is invalid, expired, or has already been used.'
              : cause instanceof Error
                ? cause.message
                : String(cause),
          );
        }
        return false;
      }
    };

    const enqueue = (url: string | null) => {
      if (!url || completed) return;
      operation = operation.then(() => completed ? true : complete(url));
    };

    enqueue(routeCallbackUrl);
    void Linking.getInitialURL().then(enqueue);
    const subscription = Linking.addEventListener('url', event => enqueue(event.url));

    return () => {
      active = false;
      subscription.remove();
    };
  }, [routeCallbackUrl, router]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {!error && <ActivityIndicator size="large" color={colors.primary} />}
      <Text accessibilityRole={error ? 'alert' : undefined} style={[styles.text, { color: colors.foreground }]}>
        {error ?? (processingRecovery ? 'Opening password reset…' : 'Signing you in…')}
      </Text>
      {error && (
        <Button
          title={recoveryError ? 'Request a new reset link' : 'Request a new link'}
          onPress={() => router.replace(recoveryError ? '/(auth)/forgot-password' : '/(auth)/login')}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 20 },
  text: { fontFamily: 'Inter_500Medium', fontSize: 16, textAlign: 'center' },
});
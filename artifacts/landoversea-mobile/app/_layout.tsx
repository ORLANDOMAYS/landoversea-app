import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { setBaseUrl } from '@workspace/api-client-react';
import { resolveDomain } from '@/lib/appDomain';
import { I18nProvider, useI18n } from '@/i18n';
import { setGlobalQueryClient } from '@/lib/auth';
import * as Notifications from 'expo-notifications';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { resolveInternalRoute } from '@/lib/internalRoutes';
import { RevenueCatProvider } from '@/lib/revenuecat';
import { AuthProvider, useAuth } from '@/lib/AuthProvider';
import { isProfileComplete } from '@/lib/auth-flow';
import { supabase, supabaseConfigurationError } from '@/lib/supabase';

SplashScreen.preventAutoHideAsync();

const resolvedDomain = resolveDomain();
if (resolvedDomain.ok) {
  setBaseUrl(resolvedDomain.origin);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => {
        const status = error?.status;
        if (status === 401) return false;
        if (status !== undefined && status >= 400 && status < 500) return false;
        return failureCount < 1;
      },
      staleTime: 30_000,
    },
  },
});

setGlobalQueryClient(queryClient);

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function useProtectedRoute() {
  const segments = useSegments();
  const router = useRouter();
  const { user, profile, error, loading: isLoading, refreshProfile } = useAuth();
  const isError = !!error;
  const [isReady, setIsReady] = React.useState(false);
  const [cleanupError, setCleanupError] = React.useState<unknown>(null);

  useEffect(() => {
    // Basic debounce to avoid flashing during hydration
    const timer = setTimeout(() => setIsReady(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isReady || isLoading) return;

    const inAuthGroup = (segments[0] as string) === '(auth)';
    const isPasswordReset =
      inAuthGroup && segments.join('/') === '(auth)/reset-password';
    const isAuthCallback = (segments[0] as string) === 'auth-callback';
    const isPublicDeletion = (segments[0] as string) === 'delete-account-request';
    const isLegal = (segments[0] as string) === 'terms' || (segments[0] as string) === 'privacy';
    const isPublic = inAuthGroup || isAuthCallback || isPublicDeletion || isLegal;

    if (isError) return;

    if (!user && !isPublic) {
      router.replace('/(auth)/welcome' as any);
    } else if (user) {
      const complete = isProfileComplete(profile);
      if (!complete && !isPasswordReset && !isAuthCallback && (segments[0] as string) !== 'onboarding') {
        router.replace('/onboarding' as any);
      } else if (
        complete &&
        isPublic &&
        !isPasswordReset &&
        !isAuthCallback &&
        (segments[0] as string) !== 'delete-account-request'
      ) {
        router.replace('/(tabs)/discover' as any);
      }
    }
  }, [user, segments, isReady, isError, isLoading, router, error, cleanupError]);

  return {
      startupError: cleanupError ?? (isReady && isError ? error : null),
    retryStartup: cleanupError
      ? () => {
          setCleanupError(null);
          return Promise.resolve();
        }
      : refreshProfile,
    retryingStartup: isLoading,
  };
}

function RootLayoutNav() {
  const router = useRouter();
  const { startupError, retryStartup, retryingStartup } = useProtectedRoute();

  useEffect(() => {
    const openNotificationRoute = (value: unknown) => {
      router.push(resolveInternalRoute(value) as never);
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      openNotificationRoute(response.notification.request.content.data.url);
    });
    Notifications.getLastNotificationResponseAsync()
      .then(response => {
        if (response) openNotificationRoute(response.notification.request.content.data.url);
      })
      .catch(() => undefined);
    return () => subscription.remove();
  }, [router]);

  if (startupError) {
    return <StartupErrorScreen onRetry={() => void retryStartup()} retrying={retryingStartup} />;
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="auth-callback" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="settings" />
      <Stack.Screen name="safety" />
      <Stack.Screen name="delete-account" />
      <Stack.Screen name="delete-account-request" />
      <Stack.Screen name="profile/edit" />
      <Stack.Screen name="coaches/dashboard" />
      <Stack.Screen name="coaches/apply" />
      <Stack.Screen name="coaches/[id]" />
      <Stack.Screen name="admin" />
      <Stack.Screen name="messages/[conversationId]" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="premium" />
      <Stack.Screen name="culture" />
      <Stack.Screen name="learning" />
      <Stack.Screen name="events/index" />
      <Stack.Screen name="tribes/index" />
      <Stack.Screen name="workshops/index" />
      <Stack.Screen name="terms" />
      <Stack.Screen name="privacy" />
    </Stack>
  );
}

function StartupErrorScreen({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  const colors = useColors();
  const { t } = useI18n();

  return (
    <View
      accessibilityRole="alert"
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Ionicons name="cloud-offline-outline" size={64} color={colors.destructive} />
      <Text style={[styles.title, { color: colors.foreground }]}>{t('premium.genericError')}</Text>
      <Text style={[styles.text, { color: colors.mutedForeground }]}>{t('discover.loadErrorDesc')}</Text>
      <Button
        title={t('common.retry')}
        onPress={onRetry}
        loading={retrying}
        accessibilityLabel={t('common.retry')}
        style={styles.retryButton}
      />
    </View>
  );
}

function ConfigErrorScreen({ reason }: { reason: string }) {
  const colors = useColors();
  const { t } = useI18n();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Ionicons name="warning" size={64} color={colors.destructive} />
      <Text style={[styles.title, { color: colors.foreground }]}>{t('mobile.configurationError')}</Text>
      <Text style={[styles.text, { color: colors.mutedForeground }]}>
        {t('mobile.configurationErrorReason', { reason })}
      </Text>
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  if (!resolvedDomain.ok || !supabase) {
    return (
      <SafeAreaProvider>
        <I18nProvider>
          <ConfigErrorScreen reason={resolvedDomain.ok ? supabaseConfigurationError : resolvedDomain.reason} />
        </I18nProvider>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <I18nProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
             <AuthProvider>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <RevenueCatProvider>
                  <KeyboardProvider>
                    <RootLayoutNav />
                  </KeyboardProvider>
                </RevenueCatProvider>
              </GestureHandlerRootView>
             </AuthProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 24, marginTop: 16, marginBottom: 8 },
  text: { fontFamily: 'Inter_400Regular', fontSize: 16, textAlign: 'center' },
  retryButton: { marginTop: 24, minWidth: 140 },
});

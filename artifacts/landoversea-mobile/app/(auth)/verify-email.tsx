import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Text, Alert, TextInput } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Button } from '@/components/ui/Button';
import {
  FORM_ACTION_KEYBOARD_OFFSET,
  KeyboardAwareScrollViewCompat,
} from '@/components/KeyboardAwareScrollViewCompat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useI18n } from '@/i18n';
import { useVerifyEmail, useResendVerificationEmail, useGetCurrentUser, useLogoutUser } from '@workspace/api-client-react';
import { performLogoutCleanup } from '@/lib/auth';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '@/components/ui/GlassCard';

function getApiErrorDetails(error: unknown, fallback: string): {
  message: string;
  status?: number;
  retryAfter: number;
} {
  if (!error || typeof error !== 'object') {
    return { message: fallback, retryAfter: 0 };
  }
  const candidate = error as { data?: unknown; status?: unknown };
  const data =
    candidate.data && typeof candidate.data === 'object'
      ? (candidate.data as Record<string, unknown>)
      : {};
  const message =
    typeof data.error === 'string' && data.error.trim()
      ? data.error
      : fallback;
  const retryAfter =
    typeof data.retryAfter === 'number' &&
    Number.isFinite(data.retryAfter) &&
    data.retryAfter > 0
      ? Math.ceil(data.retryAfter)
      : 0;
  return {
    message,
    status:
      typeof candidate.status === 'number' ? candidate.status : undefined,
    retryAfter,
  };
}

export default function VerifyEmailScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const params = useLocalSearchParams<{
    code?: string;
    delivery?: string;
    message?: string;
    retryAfter?: string;
  }>();

  const { data: user, refetch: refetchUser } = useGetCurrentUser();
  const verifyEmail = useVerifyEmail();
  const resendEmail = useResendVerificationEmail();
  const logoutUser = useLogoutUser();

  const initialCode =
    typeof params.code === 'string' && /^\d{6}$/.test(params.code)
      ? params.code
      : '';
  const initialRetryAfter = Number(params.retryAfter);
  const [code, setCode] = useState(initialCode);
  const [resendCooldown, setResendCooldown] = useState(
    Number.isFinite(initialRetryAfter) && initialRetryAfter > 0
      ? Math.ceil(initialRetryAfter)
      : 0,
  );
  const [deliveryMessage, setDeliveryMessage] = useState<string | null>(
    typeof params.message === 'string'
      ? params.message
      : params.delivery === 'unavailable'
        ? t('auth.verifyUnavailable')
        : null,
  );

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown(current => Math.max(0, current - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleVerify = async () => {
    if (code.length !== 6) return;
    try {
      await verifyEmail.mutateAsync({ data: { code } });
      const refreshed = await refetchUser();
      router.replace(
        refreshed.data?.isProfileComplete
          ? ('/(tabs)/discover' as any)
          : ('/onboarding' as any),
      );
    } catch (e: any) {
      Alert.alert(
        t('premium.genericError'),
        getApiErrorDetails(e, t('auth.verifyInvalid')).message,
      );
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || resendEmail.isPending) return;
    try {
      const data = await resendEmail.mutateAsync();
      if (
        data.verificationDelivery !== 'email' &&
        data.verificationDelivery !== 'development'
      ) {
        setDeliveryMessage(t('auth.verifyUnavailable'));
        return;
      }
      if (data.code) setCode(data.code);
      setResendCooldown(
        typeof data.retryAfter === 'number' && data.retryAfter > 0
          ? Math.ceil(data.retryAfter)
          : 0,
      );
      setDeliveryMessage(data.message);
      Alert.alert(t('mobile.success'), data.message);
    } catch (e: any) {
      const details = getApiErrorDetails(e, t('auth.verifyUnavailable'));
      if (details.status === 429 && details.retryAfter > 0) {
        setResendCooldown(details.retryAfter);
      }
      setDeliveryMessage(details.message);
      Alert.alert(t('premium.genericError'), details.message);
    }
  };

  const handleLogout = async () => {
    try {
      await logoutUser.mutateAsync();
    } catch {}
    await performLogoutCleanup(user?.id);
    router.replace('/(auth)/welcome' as any);
  };

  return (
    <KeyboardAwareScrollViewCompat
      testID="verify-email-scroll"
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{
        paddingTop: insets.top + 40,
        paddingBottom: insets.bottom + 20,
        paddingHorizontal: 24,
      }}
      bottomOffset={FORM_ACTION_KEYBOARD_OFFSET}
      extraKeyboardSpace={16}
    >
      <View style={styles.header}>
        <View style={[styles.iconContainer, { backgroundColor: colors.glassStrong, borderColor: colors.border }]}>
          <Ionicons name="mail-open-outline" size={32} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>{t('auth.verifyTitle')}</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{t('auth.verifySubtitle')}</Text>
        {user?.email && (
          <Text style={[styles.emailText, { color: colors.foreground }]}>{user.email}</Text>
        )}
      </View>

      <GlassCard style={styles.formCard}>
        <TextInput
          style={[
            styles.codeInput, 
            { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }
          ]}
          placeholder="000000"
          placeholderTextColor={colors.placeholder}
          keyboardType="number-pad"
          maxLength={6}
          value={code}
          onChangeText={setCode}
          textContentType="oneTimeCode"
        />

        <Button
          title={t('auth.verifySubmit')}
          size="lg"
          onPress={handleVerify}
          loading={verifyEmail.isPending}
          disabled={code.length !== 6}
          style={styles.submitBtn}
        />

        <Button
          title={resendCooldown > 0 ? `${t('auth.verifyResend')} (${resendCooldown}s)` : t('auth.verifyResend')}
          variant="ghost"
          onPress={handleResend}
          loading={resendEmail.isPending}
          disabled={resendCooldown > 0}
          accessibilityLabel={resendCooldown > 0 ? `${t('auth.verifyCooldown')} ${resendCooldown}` : t('auth.verifyResend')}
          style={styles.resendBtn}
        />
        {resendCooldown > 0 && (
          <Text accessibilityLiveRegion="polite" style={[styles.cooldownText, { color: colors.mutedForeground }]}>
            {t('auth.verifyCooldown')} ({resendCooldown}s)
          </Text>
        )}
        {deliveryMessage && (
          <Text
            accessibilityRole={params.delivery === 'unavailable' ? 'alert' : 'text'}
            accessibilityLiveRegion="polite"
            style={[
              styles.deliveryText,
              {
                color:
                  params.delivery === 'unavailable'
                    ? colors.destructive
                    : colors.mutedForeground,
              },
            ]}
          >
            {deliveryMessage}
          </Text>
        )}
      </GlassCard>

      <Button
        title={t('auth.logout')}
        variant="ghost"
        onPress={handleLogout}
        style={styles.logoutBtn}
      />
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 22,
  },
  emailText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    marginTop: 8,
  },
  formCard: {
    padding: 24,
  },
  codeInput: {
    borderWidth: 1,
    borderRadius: 16,
    height: 64,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 28,
    textAlign: 'center',
    letterSpacing: 8,
    marginBottom: 24,
  },
  submitBtn: {
    marginBottom: 16,
  },
  resendBtn: {
    marginTop: 8,
  },
  cooldownText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
  },
  deliveryText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 18,
  },
  logoutBtn: {
    marginTop: 40,
  }
});

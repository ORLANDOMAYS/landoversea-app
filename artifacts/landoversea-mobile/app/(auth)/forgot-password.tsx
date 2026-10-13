import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Text, Alert } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useI18n } from '@/i18n';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '@/components/ui/GlassCard';
import { supabase, supabaseConfigurationError } from '@/lib/supabase';
import { createRecoveryCallbackUrl } from '@/lib/auth-callback-link';
import { getEmailRetryAfter } from '@/lib/password-recovery';

export default function ForgotPasswordScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();

  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [retryAfter, setRetryAfter] = useState(0);
  const recoveryFlight = useRef(false);

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = setInterval(() => {
      setRetryAfter((value) => Math.max(0, value - 1));
    }, 1_000);
    return () => clearInterval(timer);
  }, [retryAfter]);

  const handleSubmit = async () => {
    if (!email || retryAfter > 0 || recoveryFlight.current) return;
    recoveryFlight.current = true;
    setLoading(true);
    setErrorMessage('');
    try {
      if (!supabase) throw new Error(supabaseConfigurationError);
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: createRecoveryCallbackUrl(),
      });
      if (error) throw error;
      setSubmitted(true);
      setRetryAfter(60);
    } catch (cause) {
      const emailRetryAfter = getEmailRetryAfter(cause);
      const message = emailRetryAfter > 0
        ? t('auth.verifyCooldown')
        : cause instanceof Error && cause.message === supabaseConfigurationError
          ? cause.message
          : t('auth.forgotUnavailable');
      if (emailRetryAfter > 0) setRetryAfter(emailRetryAfter);
      setErrorMessage(message);
      Alert.alert(t('premium.genericError'), message);
    } finally {
      recoveryFlight.current = false;
      setLoading(false);
    }
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{
        paddingTop: insets.top + 20,
        paddingBottom: insets.bottom + 20,
        paddingHorizontal: 24,
      }}
    >
      <View style={styles.header}>
        <Button
          variant="ghost"
          size="icon"
          onPress={() => router.back()}
          leftIcon={<Ionicons name="arrow-back" size={24} color={colors.foreground} />}
          style={styles.backBtn}
        />
        <Text style={[styles.title, { color: colors.foreground }]}>{t('auth.forgotTitle')}</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{t('auth.forgotSubtitle')}</Text>
      </View>

      <GlassCard style={styles.formCard}>
        {submitted ? (
          <View style={styles.successContainer}>
            <View style={[styles.successIcon, { backgroundColor: colors.glassStrong, borderColor: colors.border }]}>
              <Ionicons name="checkmark-circle-outline" size={32} color={colors.primary} />
            </View>
            <Text style={[styles.successText, { color: colors.foreground }]}>{t('auth.forgotSent')}</Text>
            <Button
              title={retryAfter > 0 ? `${t('auth.forgotSubmit')} (${retryAfter}s)` : t('auth.forgotSubmit')}
              onPress={handleSubmit}
              loading={loading}
              disabled={loading || retryAfter > 0}
              style={styles.submitBtn}
            />
            {retryAfter > 0 && (
              <Text accessibilityLiveRegion="polite" style={[styles.cooldownText, { color: colors.mutedForeground }]}>
                {t('auth.verifyCooldown')} ({retryAfter}s)
              </Text>
            )}
            <Button
              title={t('auth.backToLogin')}
              onPress={() => router.back()}
              disabled={loading}
              style={styles.submitBtn}
            />
          </View>
        ) : (
          <>
            <Input
              placeholder={t('auth.email')}
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
              leftIcon={<Ionicons name="mail-outline" size={20} color={colors.mutedForeground} />}
            />
            {errorMessage ? (
              <Text accessibilityRole="alert" style={[styles.errorText, { color: colors.destructive }]}>
                {errorMessage}
              </Text>
            ) : null}
            
            <Button
              title={retryAfter > 0 ? `${t('auth.forgotSubmit')} (${retryAfter}s)` : t('auth.forgotSubmit')}
              size="lg"
              onPress={handleSubmit}
              loading={loading}
               disabled={loading || !email || retryAfter > 0}
              style={styles.submitBtn}
            />
          </>
        )}
      </GlassCard>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { marginBottom: 32 },
  backBtn: { alignSelf: 'flex-start', marginLeft: -16, marginBottom: 8 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 32, marginBottom: 8 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 22 },
  formCard: { padding: 24 },
  submitBtn: { marginTop: 16 },
  successContainer: { alignItems: 'center', paddingVertical: 16 },
  successIcon: { width: 64, height: 64, borderRadius: 32, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  successText: { fontFamily: 'Inter_400Regular', fontSize: 16, textAlign: 'center', lineHeight: 24, marginBottom: 32 },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19, marginTop: 12 },
  cooldownText: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', marginTop: 8 },
});

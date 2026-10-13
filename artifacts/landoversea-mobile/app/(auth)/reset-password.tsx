import React, { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import { useI18n } from '@/i18n';
import { supabase, supabaseConfigurationError } from '@/lib/supabase';
import {
  clearPasswordRecoverySession,
  hasPasswordRecoverySession,
} from '@/lib/password-recovery';
import {
  completePasswordRecovery,
  PasswordRecoveryCompletionError,
} from '@/lib/password-recovery-flow';

export default function ResetPasswordScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [checking, setChecking] = useState(true);
  const [validSession, setValidSession] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const updateFlight = useRef(false);

  useEffect(() => {
    let active = true;
    if (!supabase) {
      setChecking(false);
      return;
    }
    void Promise.all([
      supabase.auth.getSession(),
      hasPasswordRecoverySession(),
    ]).then(([sessionResult, hasRecovery]) => {
      if (!active) return;
      setValidSession(!sessionResult.error && Boolean(sessionResult.data.session) && hasRecovery);
      setChecking(false);
    }).catch(() => {
      if (active) {
        setValidSession(false);
        setChecking(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async () => {
    if (updateFlight.current || loading) return;
    if (newPassword.length < 8) {
      Alert.alert(t('auth.resetTitle'), t('auth.validPasswordMin'));
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert(t('auth.resetTitle'), t('auth.passwordsMismatch'));
      return;
    }
    updateFlight.current = true;
    setLoading(true);
    try {
      if (!supabase) throw new Error(supabaseConfigurationError);
      await completePasswordRecovery(
        supabase.auth,
        newPassword,
        clearPasswordRecoverySession,
      );
      setNewPassword('');
      setConfirmPassword('');
      setValidSession(false);
      setComplete(true);
    } catch (cause) {
      const message =
        cause instanceof PasswordRecoveryCompletionError && cause.passwordUpdated
          ? `${t('auth.resetSuccess')} ${t('auth.resetUnavailable')}`
          : t('auth.resetUnavailable');
      Alert.alert(t('auth.resetTitle'), message);
    } finally {
      updateFlight.current = false;
      setLoading(false);
    }
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: 'center',
        paddingTop: insets.top + 20,
        paddingBottom: insets.bottom + 20,
        paddingHorizontal: 24,
      }}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {complete
            ? t('auth.resetSuccess')
            : validSession
              ? t('auth.resetTitle')
              : t('auth.resetInvalid')}
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {checking
            ? 'Checking your reset link…'
            : complete
              ? t('auth.backToLogin')
            : validSession
              ? t('auth.resetSubtitle')
              : 'Recovery links expire and can only be used once.'}
        </Text>
      </View>

      <GlassCard style={styles.formCard}>
        {checking ? (
          <Button title="Checking…" loading disabled />
        ) : complete ? (
          <>
            <Ionicons
              name="checkmark-circle"
              size={48}
              color={colors.primary}
              style={styles.successIcon}
            />
            <Text
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={[styles.subtitle, styles.successMessage, { color: colors.foreground }]}
            >
              {t('auth.resetSuccess')}
            </Text>
            <Button
              title={t('auth.signIn')}
              size="lg"
              onPress={() => router.replace('/(auth)/login')}
              style={styles.submitBtn}
            />
          </>
        ) : validSession ? (
          <>
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>
              {t('auth.newPassword')}
            </Text>
            <Input
              placeholder={t('auth.newPassword')}
              accessibilityLabel={t('auth.newPassword')}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              leftIcon={<Ionicons name="lock-closed-outline" size={20} color={colors.mutedForeground} />}
            />
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>
              {t('auth.confirmPassword')}
            </Text>
            <Input
              placeholder={t('auth.confirmPassword')}
              accessibilityLabel={t('auth.confirmPassword')}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              leftIcon={<Ionicons name="lock-closed-outline" size={20} color={colors.mutedForeground} />}
            />
            <Button
              title={t('auth.resetSubmit')}
              size="lg"
              onPress={handleSubmit}
              loading={loading}
              disabled={loading || newPassword.length < 8 || !confirmPassword}
              style={styles.submitBtn}
            />
          </>
        ) : (
          <Button
            title={t('auth.forgotSubmit')}
            size="lg"
            onPress={() => router.replace('/(auth)/forgot-password')}
          />
        )}
      </GlassCard>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { marginBottom: 32 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 32, marginBottom: 8 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 22 },
  formCard: { padding: 24 },
  inputLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginBottom: 8 },
  submitBtn: { marginTop: 16 },
  successIcon: { alignSelf: 'center', marginBottom: 16 },
  successMessage: { textAlign: 'center' },
});
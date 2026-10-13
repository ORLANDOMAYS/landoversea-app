import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Text, Alert, Switch, Pressable } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  FORM_ACTION_KEYBOARD_OFFSET,
  KeyboardAwareScrollViewCompat,
} from '@/components/KeyboardAwareScrollViewCompat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useI18n, LOCALE_META, Locale } from '@/i18n';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '@/components/ui/GlassCard';
import { supabase, supabaseConfigurationError } from '@/lib/supabase';
import { useGetAuthProviders } from '@workspace/api-client-react';
import { createAuthCallbackUrl } from '@/lib/auth-callback-link';
import { getEmailRetryAfter } from '@/lib/password-recovery';

function getApiErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const data = (error as { data?: unknown }).data;
  if (data && typeof data === 'object') {
    const message = (data as { error?: unknown }).error;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

export default function RegisterScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, locale, setLocale } = useI18n();
  const { data: providers } = useGetAuthProviders();

  const [step, setStep] = useState(1); // 1 = Lang, 2 = 18+, 3 = Email/Providers
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [verificationPending, setVerificationPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isAdult, setIsAdult] = useState(false);
  const signupFlight = useRef(false);
  const resendFlight = useRef(false);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown(value => Math.max(0, value - 1));
    }, 1_000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleNextStep = () => {
    if (step === 1) setStep(2);
    else if (step === 2 && isAdult) setStep(3);
  };

  const handleRegister = async () => {
    if (
      !name ||
      !email ||
      !isAdult ||
      password.length < 8 ||
      signupFlight.current ||
      resendCooldown > 0
    ) return;
    if (password !== confirmPassword) {
      Alert.alert(t('auth.registrationFailed'), t('auth.passwordsMismatch'));
      return;
    }
    signupFlight.current = true;
    setLoading(true);
    try {
      if (!supabase) throw new Error(supabaseConfigurationError);
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: createAuthCallbackUrl(),
          data: { display_name: name.trim(), accepted_age_requirement: true },
        },
      });
      if (error) throw error;
      if (data.session) {
        router.replace('/');
      } else {
        setVerificationPending(true);
        setResendCooldown(60);
      }
    } catch (e: any) {
      const emailRetryAfter = getEmailRetryAfter(e);
      if (emailRetryAfter > 0) setResendCooldown(emailRetryAfter);
      Alert.alert(
        t('auth.registrationFailed'),
        emailRetryAfter > 0
          ? t('auth.verifyCooldown')
          : e?.message || getApiErrorMessage(e, t('auth.registrationError')),
      );
    } finally {
      signupFlight.current = false;
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendFlight.current || resendCooldown > 0) return;
    resendFlight.current = true;
    setResending(true);
    try {
      if (!supabase) throw new Error(supabaseConfigurationError);
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: { emailRedirectTo: createAuthCallbackUrl() },
      });
      if (error) throw error;
      setResendCooldown(60);
      Alert.alert(t('auth.signUp'), t('auth.verifyResent'));
    } catch (cause: any) {
      const emailRetryAfter = getEmailRetryAfter(cause);
      if (emailRetryAfter > 0) setResendCooldown(emailRetryAfter);
      Alert.alert(
        t('auth.registrationFailed'),
        emailRetryAfter > 0
          ? t('auth.verifyCooldown')
          : cause?.message || t('auth.verifyUnavailable'),
      );
    } finally {
      resendFlight.current = false;
      setResending(false);
    }
  };

  return (
    <KeyboardAwareScrollViewCompat
      testID="register-scroll"
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.scrollContent,
        {
          paddingTop: insets.top + 20,
          paddingBottom: insets.bottom + 20,
          paddingHorizontal: 24,
        },
      ]}
      bottomOffset={FORM_ACTION_KEYBOARD_OFFSET}
      extraKeyboardSpace={16}
    >
      <View style={styles.header}>
        <Button
          variant="ghost"
          size="icon"
          onPress={() => step > 1 ? setStep(step - 1) : router.back()}
          leftIcon={<Ionicons name="arrow-back" size={24} color={colors.foreground} />}
          style={styles.backBtn}
        />
        <Text style={[styles.title, { color: colors.foreground }]}>{t('auth.joinTitle')}</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{t('auth.joinSubtitle')}</Text>
      </View>

      {verificationPending ? (
        <GlassCard style={styles.formCard}>
          <View style={styles.pendingContainer}>
            <View style={[styles.pendingIcon, { backgroundColor: colors.glassStrong, borderColor: colors.border }]}>
              <Ionicons name="mail-open-outline" size={32} color={colors.primary} />
            </View>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{t('auth.verifyTitle')}</Text>
            <Text style={[styles.pendingText, { color: colors.mutedForeground }]}>{t('auth.verifyResent')}</Text>
            <Text style={[styles.pendingEmail, { color: colors.foreground }]}>{email.trim()}</Text>
            <Button
              title={resendCooldown > 0 ? `${t('auth.verifyResend')} (${resendCooldown}s)` : t('auth.verifyResend')}
              onPress={handleResend}
              loading={resending}
              disabled={resending || resendCooldown > 0}
              style={styles.submitBtn}
            />
            {resendCooldown > 0 && (
              <Text accessibilityLiveRegion="polite" style={[styles.cooldownText, { color: colors.mutedForeground }]}>
                {t('auth.verifyCooldown')} ({resendCooldown}s)
              </Text>
            )}
            <Button
              title={t('auth.goToLogin')}
              variant="ghost"
              onPress={() => router.replace('/(auth)/login')}
              disabled={resending}
            />
          </View>
        </GlassCard>
      ) : step === 1 && (
        <GlassCard style={styles.formCard}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{t('language.label')}</Text>
          <View style={styles.langGrid}>
            {Object.keys(LOCALE_META).map(key => (
              <Pressable 
                key={key} 
                style={[styles.langBtn, { borderColor: locale === key ? colors.primary : colors.border, backgroundColor: locale === key ? colors.primary : 'transparent' }]}
                onPress={() => setLocale(key as Locale)}
              >
                <Text style={[styles.langText, { color: locale === key ? colors.primaryForeground : colors.foreground }]}>
                  {LOCALE_META[key as Locale].label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Button
            testID="register-language-next"
            title={t('common.continue')}
            size="lg"
            onPress={handleNextStep}
            style={styles.submitBtn}
          />
        </GlassCard>
      )}

      {step === 2 && (
        <GlassCard style={styles.formCard}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{t('auth.ageVerification')}</Text>
          <Text style={[styles.desc, { color: colors.mutedForeground }]}>{t('auth.adultsOnly')}</Text>
          
          <View style={[styles.switchRow, { borderColor: colors.border }]}>
            <Text style={[styles.switchLabel, { color: colors.foreground }]}>{t('auth.ageConfirm')}</Text>
            <Switch
              value={isAdult}
              onValueChange={setIsAdult}
              trackColor={{ false: colors.muted, true: colors.primary }}
              thumbColor={colors.foreground}
            />
          </View>

          <Button
            testID="register-age-next"
            title={t('common.continue')}
            size="lg"
            onPress={handleNextStep}
            disabled={!isAdult}
            style={styles.submitBtn}
          />
        </GlassCard>
      )}

      {step === 3 && (
        <GlassCard style={styles.formCard}>
          <Input
            placeholder={t('auth.name')}
            autoCapitalize="words"
            value={name}
            onChangeText={setName}
            leftIcon={<Ionicons name="person-outline" size={20} color={colors.mutedForeground} />}
          />
          <Input
            placeholder={t('auth.email')}
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
            leftIcon={<Ionicons name="mail-outline" size={20} color={colors.mutedForeground} />}
          />
          <Input
            placeholder={t('auth.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            leftIcon={<Ionicons name="lock-closed-outline" size={20} color={colors.mutedForeground} />}
          />
          <Input
            placeholder={t('auth.confirmPassword')}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            leftIcon={<Ionicons name="lock-closed-outline" size={20} color={colors.mutedForeground} />}
          />
          <Button
            testID="register-submit"
            title={resendCooldown > 0
              ? `${t('auth.verifyCooldown')} (${resendCooldown}s)`
              : t('auth.createAccount')}
            size="lg"
            onPress={handleRegister}
            loading={loading}
            disabled={loading || resendCooldown > 0 || !name || !email || password.length < 8 || !confirmPassword}
            style={styles.submitBtn}
          />
          <View style={styles.termsRow}>
            <Text style={[styles.termsText, { color: colors.mutedForeground }]}>
              {t('auth.termsAgree')}{' '}
            </Text>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t('auth.termsLink')}
              hitSlop={8}
              onPress={() => router.push('/terms' as any)}
            >
              <Text style={[styles.termsText, styles.legalLink, { color: colors.primary }]}>{t('auth.termsLink')}</Text>
            </Pressable>
            <Text style={[styles.termsText, { color: colors.mutedForeground }]}> {t('mobile.and')} </Text>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t('auth.privacyLink')}
              hitSlop={8}
              onPress={() => router.push('/privacy' as any)}
            >
              <Text style={[styles.termsText, styles.legalLink, { color: colors.primary }]}>{t('auth.privacyLink')}</Text>
            </Pressable>
            <Text style={[styles.termsText, { color: colors.mutedForeground }]}>.</Text>
          </View>
          {providers && (!providers.google.available || !providers.apple.available) ? (
            <View style={styles.providersContainer}>
              <Text style={[styles.providerText, { color: colors.disabledForeground }]}>
                {t('auth.providerUnavailable')}
              </Text>
            </View>
          ) : null}

        </GlassCard>
      )}
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  header: { marginBottom: 32 },
  backBtn: { alignSelf: 'flex-start', marginLeft: -16, marginBottom: 8 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 32, marginBottom: 8 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 16 },
  formCard: { padding: 24 },
  sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 20, marginBottom: 12 },
  langGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  langBtn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  langText: { fontFamily: 'Inter_500Medium', fontSize: 15 },
  desc: { fontFamily: 'Inter_400Regular', fontSize: 15, marginBottom: 24, lineHeight: 22 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderTopWidth: 1, borderBottomWidth: 1, marginBottom: 32 },
  switchLabel: { fontFamily: 'Inter_500Medium', fontSize: 16 },
  submitBtn: { marginTop: 8 },
  termsRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 16 },
  termsText: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  legalLink: { textDecorationLine: 'underline' },
  providersContainer: { marginTop: 32, alignItems: 'center' },
  divider: { height: 1, width: '100%', position: 'absolute', top: '50%' },
  orText: { fontFamily: 'Inter_500Medium', fontSize: 14, paddingHorizontal: 12, marginBottom: 24 },
  providerBtn: { flexDirection: 'row', alignItems: 'center', padding: 16, borderWidth: 1, borderRadius: 16, width: '100%', marginBottom: 12, gap: 12 },
  providerText: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  pendingContainer: { alignItems: 'center' },
  pendingIcon: { width: 64, height: 64, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  pendingText: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, textAlign: 'center' },
  pendingEmail: { fontFamily: 'Inter_600SemiBold', fontSize: 16, marginTop: 12, marginBottom: 16 },
  cooldownText: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', marginTop: 8, marginBottom: 8 },
});

import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Text, Alert, Pressable } from 'react-native';
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
import { createAuthCallbackUrl } from '@/lib/auth-callback-link';
import { getEmailRetryAfter } from '@/lib/password-recovery';
import { BrandLogo } from '@/components/brand/BrandLogo';

export default function LoginScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [magicLinkCooldown, setMagicLinkCooldown] = useState(0);
  const loginFlight = useRef(false);
  const magicLinkFlight = useRef(false);

  useEffect(() => {
    if (magicLinkCooldown <= 0) return;
    const timer = setTimeout(() => {
      setMagicLinkCooldown(value => Math.max(0, value - 1));
    }, 1_000);
    return () => clearTimeout(timer);
  }, [magicLinkCooldown]);

  const handleLogin = async () => {
    if (!email || password.length < 8 || loginFlight.current || magicLinkFlight.current) return;
    loginFlight.current = true;
    setLoading(true);
    try {
      if (!supabase) throw new Error(supabaseConfigurationError);
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      router.replace('/');
    } catch (e: any) {
      Alert.alert(t('auth.loginFailed'), e?.message || t('auth.loginError'));
    } finally {
      loginFlight.current = false;
      setLoading(false);
    }
  };

  const handleMagicLink = async () => {
    if (!email || magicLinkFlight.current || loginFlight.current || magicLinkCooldown > 0) return;
    magicLinkFlight.current = true;
    setMagicLinkLoading(true);
    try {
      if (!supabase) throw new Error(supabaseConfigurationError);
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: false,
          emailRedirectTo: createAuthCallbackUrl(),
        },
      });
      if (error) throw error;
      setMagicLinkSent(true);
      setMagicLinkCooldown(60);
      Alert.alert(t('auth.signIn'), 'Check your email for the sign-in link.');
    } catch (e: any) {
      const emailRetryAfter = getEmailRetryAfter(e);
      if (emailRetryAfter > 0) setMagicLinkCooldown(emailRetryAfter);
      Alert.alert(
        t('auth.loginFailed'),
        emailRetryAfter > 0 ? t('auth.verifyCooldown') : e?.message || t('auth.loginError'),
      );
    } finally {
      magicLinkFlight.current = false;
      setMagicLinkLoading(false);
    }
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{
        paddingTop: insets.top + 60,
        paddingBottom: insets.bottom + 20,
        paddingHorizontal: 24,
      }}
      bottomOffset={20}
    >
      <View style={styles.header}>
        <View style={styles.logoWrap}>
          <BrandLogo width={225} foreground={colors.foreground} />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>{t('auth.signIn')}</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{t('auth.welcomeBack')}</Text>
      </View>

      <GlassCard style={styles.formCard}>
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
          autoComplete="password"
          textContentType="password"
          leftIcon={<Ionicons name="lock-closed-outline" size={20} color={colors.mutedForeground} />}
        />
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push('/(auth)/forgot-password' as any)}
        >
          <Text style={[styles.forgotPassword, { color: colors.primary }]}>
            {t('auth.forgotPassword')}
          </Text>
        </Pressable>
        <Button
          title={t('auth.signIn')}
          size="lg"
          onPress={handleLogin}
          loading={loading}
          disabled={loading || magicLinkLoading || !email || password.length < 8}
          style={styles.submitBtn}
        />
        <Button
          title={magicLinkCooldown > 0
            ? `${t('auth.verifyCooldown')} (${magicLinkCooldown}s)`
            : `${t('auth.signInLink')} · ${t('auth.email')}`}
          variant="ghost"
          onPress={handleMagicLink}
          loading={magicLinkLoading}
          disabled={loading || magicLinkLoading || magicLinkCooldown > 0 || !email}
          style={styles.magicLinkBtn}
        />
        {magicLinkSent && (
          <Text accessibilityLiveRegion="polite" style={[styles.magicLinkStatus, { color: colors.mutedForeground }]}>
            Check your email for the sign-in link.
          </Text>
        )}
      </GlassCard>
      
      <View style={styles.footerRow}>
        <Text style={[styles.footerText, { color: colors.mutedForeground }]}>{t('auth.newToApp')}</Text>
        <Pressable onPress={() => router.push('/(auth)/register' as any)}>
          <Text style={[styles.linkText, { color: colors.primary }]}>{t('auth.signUp')}</Text>
        </Pressable>
      </View>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    marginBottom: 40,
  },
  logoWrap: {
    alignItems: 'flex-start',
    marginBottom: 28,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 32,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
  },
  formCard: {
    padding: 24,
  },
  forgotPassword: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    textAlign: 'right',
    marginBottom: 24,
  },
  submitBtn: {
    marginTop: 8,
  },
  magicLinkBtn: {
    marginTop: 12,
  },
  magicLinkStatus: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
    textAlign: 'center',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 40,
  },
  footerText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  linkText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
});

import React from 'react';
import { View, StyleSheet, Text, Pressable } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Button } from '@/components/ui/Button';
import { useRouter } from 'expo-router';
import { useI18n } from '@/i18n';
import { LinearGradient } from 'expo-linear-gradient';
import { BrandLogo } from '@/components/brand/BrandLogo';

export default function WelcomeScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useI18n();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={[colors.background, colors.backgroundElevated, colors.background]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.content}>
        <View style={styles.brandContainer}>
          <View style={styles.logoWrap}>
            <BrandLogo width={300} foreground={colors.foreground} />
          </View>
          <Text style={[styles.tagline, { color: colors.mutedForeground }]}>{t('common.tagline').toUpperCase()}</Text>
        </View>

        <View style={styles.actionContainer}>
          <Button 
            title={t('auth.joinNow')}
            size="lg"
            onPress={() => router.push('/(auth)/register' as any)}
          />
          <View style={styles.loginRow}>
            <Text style={[styles.haveAccountText, { color: colors.mutedForeground }]}>
              {t('auth.haveAccount')}
            </Text>
            <Pressable onPress={() => router.push('/(auth)/login' as any)}>
              <Text style={[styles.loginText, { color: colors.primary }]}>{t('auth.signIn')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'space-between',
    paddingTop: 100,
    paddingBottom: 60,
  },
  brandContainer: {
    alignItems: 'center',
  },
  logoWrap: {
    minHeight: 92,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  tagline: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    letterSpacing: 3,
    marginTop: 12,
  },
  actionContainer: {
    gap: 24,
  },
  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  haveAccountText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  loginText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
});

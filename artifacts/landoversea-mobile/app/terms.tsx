import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useI18n } from '@/i18n';

export default function TermsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useI18n();
  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} style={styles.back} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>{t('terms.title')}</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <Text style={[styles.updated, { color: colors.mutedForeground }]}>{t('terms.lastUpdated')}</Text>
        <Text style={[styles.heading, { color: colors.foreground }]}>{t('terms.s1Title')}</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>{t('terms.s1Body')}</Text>
        <Text style={[styles.heading, { color: colors.foreground }]}>{t('terms.s2Title')}</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>{t('terms.s2Body')}</Text>
        <Text style={[styles.heading, { color: colors.foreground }]}>{t('terms.s3Title')}</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>{t('terms.s3Body')}</Text>
        <Text style={[styles.heading, { color: colors.foreground }]}>{t('terms.s4Title')}</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>{t('terms.s4Body')}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { minHeight: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20, marginStart: 8 },
  content: { paddingHorizontal: 24, paddingTop: 12 },
  updated: { fontFamily: 'Inter_400Regular', fontSize: 14, marginBottom: 24 },
  heading: { fontFamily: 'Inter_600SemiBold', fontSize: 18, marginTop: 20, marginBottom: 8 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 23 },
});
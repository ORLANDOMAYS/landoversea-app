import React from 'react';
import { View, StyleSheet, Text, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/i18n';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useGetCulturalPassport } from '@workspace/api-client-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';

export default function CultureScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const router = useRouter();

  const { data: passport, isLoading } = useGetCulturalPassport();

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={4}
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={28} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>{t('mobile.culturePassport')}</Text>
      </View>
      
      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      ) : (
        <ScrollView style={styles.content} contentContainerStyle={{ padding: 24 }}>
          <GlassCard style={styles.passportCard}>
            <Ionicons name="earth" size={64} color={colors.primary} style={{ alignSelf: 'center', marginBottom: 16 }} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t('mobile.culturePassportBody')}</Text>
            <Text style={[styles.cardLevel, { color: colors.mutedForeground }]}>
              {t('mobile.levelLabel')}: {passport?.level || 1} • {t('mobile.xpLabel')}: {(passport as any)?.xp || 0}
            </Text>
          </GlassCard>
          <View style={styles.exploreRow}>
            <Button title={t('culture.events')} variant="outline" style={styles.exploreButton} onPress={() => router.push('/events' as never)} />
            <Button title={t('culture.tribes')} variant="outline" style={styles.exploreButton} onPress={() => router.push('/tribes' as never)} />
          </View>

          <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 32 }]}>{t('mobile.stamps')}</Text>
          {passport?.stamps?.length ? (
            <View style={styles.stampsGrid}>
              {passport.stamps.map(stamp => (
                <View key={stamp.id} style={[styles.stamp, { backgroundColor: colors.glassStrong, borderColor: colors.border }]}>
                  <Text style={[styles.stampIcon]}>{(stamp as any).icon || '🏛️'}</Text>
                  <Text style={[styles.stampName, { color: colors.foreground }]}>{(stamp as any).name || stamp.title || stamp.country}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={{ color: colors.mutedForeground }}>{t('mobile.noStamps')}</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20, marginLeft: 16 },
  content: { flex: 1 },
  passportCard: { padding: 32, alignItems: 'center' },
  exploreRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  exploreButton: { flex: 1 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 24, textAlign: 'center', marginBottom: 8 },
  cardLevel: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18, marginBottom: 16 },
  stampsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  stamp: { width: '47%', padding: 16, borderRadius: 16, borderWidth: 1, alignItems: 'center' },
  stampIcon: { fontSize: 32, marginBottom: 8 },
  stampName: { fontFamily: 'Inter_500Medium', fontSize: 14, textAlign: 'center' }
});

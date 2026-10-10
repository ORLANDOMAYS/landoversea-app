import React from 'react';
import { View, StyleSheet, Text, ActivityIndicator, Pressable } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/i18n';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useGetLanguageStreak } from '@workspace/api-client-react';
import { GlassCard } from '@/components/ui/GlassCard';

export default function LearningScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const router = useRouter();

  const { data: streak, isLoading } = useGetLanguageStreak();

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
        <Text style={[styles.title, { color: colors.foreground }]}>{t('mobile.learning')}</Text>
      </View>
      
      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      ) : (
        <View style={styles.content}>
          <GlassCard style={styles.card}>
            <Ionicons name="flame" size={64} color={colors.primary} style={{ alignSelf: 'center', marginBottom: 16 }} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t('mobile.learningStreak')}</Text>
            
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={[styles.statValue, { color: colors.foreground }]}>{streak?.currentStreak || 0}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{t('mobile.days')}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statValue, { color: colors.foreground }]}>{streak?.longestStreak || 0}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{t('mobile.best')}</Text>
              </View>
            </View>
          </GlassCard>

          <Text style={[styles.info, { color: colors.mutedForeground }]}>
            {t('mobile.learningPracticeDescription')}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20, marginLeft: 16 },
  content: { flex: 1, padding: 24 },
  card: { padding: 32 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 24, textAlign: 'center', marginBottom: 24 },
  statsRow: { flexDirection: 'row', justifyContent: 'center', gap: 32 },
  statBox: { alignItems: 'center' },
  statValue: { fontFamily: 'Inter_700Bold', fontSize: 36, marginBottom: 4 },
  statLabel: { fontFamily: 'Inter_500Medium', fontSize: 16 },
  info: { fontFamily: 'Inter_400Regular', fontSize: 16, textAlign: 'center', marginTop: 32, lineHeight: 24 }
});

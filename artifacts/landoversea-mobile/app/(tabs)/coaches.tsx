import React from 'react';
import { View, StyleSheet, Text, FlatList, ActivityIndicator, Pressable, RefreshControl } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveCoaches } from '@/lib/liveSupabase';
import { Ionicons } from '@expo/vector-icons';
import { AuthenticatedProfileImage } from '@/components/AuthenticatedProfileImage';
import { useI18n } from '@/i18n';
import { GlassCard } from '@/components/ui/GlassCard';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';

export default function CoachesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const router = useRouter();

  const coachesQuery = useLiveCoaches();
  const { data: coaches, isLoading, isError, isRefetching } = coachesQuery;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>{t('coaching.title')}</Text>
        <Button title={t('culture.workshops')} variant="ghost" size="sm" onPress={() => router.push('/workshops' as never)} />
      </View>

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.primary} /></View>
      ) : isError ? (
        <View accessibilityRole="alert" style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>{t('discover.loadErrorDesc')}</Text>
          <Button title={t('common.retry')} onPress={() => void coachesQuery.refetch()} />
        </View>
      ) : coaches?.length ? (
        <FlatList
          data={coaches}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 84 }]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void coachesQuery.refetch()} tintColor={colors.primary} colors={[colors.primary]} />}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/coaches/${item.id}` as never)}
            >
            <GlassCard style={styles.card}>
              <View style={styles.cardHeader}>
                <AuthenticatedProfileImage
                  url={item.photoUrl}
                  style={styles.avatar}
                  accessibilityLabel={item.displayName}
                />
                <View style={styles.cardInfo}>
                  <Text style={[styles.name, { color: colors.foreground }]}>{item.displayName}</Text>
                  {item.specialties && item.specialties.length > 0 && (
                    <Text style={[styles.specialty, { color: colors.mutedForeground }]}>{item.specialties.join(' • ')}</Text>
                  )}
                  {item.rating != null && (
                    <View style={styles.ratingRow}>
                      <Ionicons name="star" size={14} color={colors.secondary} />
                      <Text style={[styles.ratingText, { color: colors.foreground }]}>{item.rating.toFixed(1)}</Text>
                      <Text style={[styles.reviewCount, { color: colors.mutedForeground }]}>({item.reviewCount || 0})</Text>
                    </View>
                  )}
                </View>
              </View>
            </GlassCard>
            </Pressable>
          )}
        />
      ) : (
        <View style={styles.empty}>
          <Ionicons name="compass-outline" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{t('mobile.noCoachesAvailable')}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 24, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 24 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontFamily: 'Inter_400Regular', fontSize: 15, textAlign: 'center', marginVertical: 16, paddingHorizontal: 24 },
  list: { paddingHorizontal: 16 },
  card: { marginBottom: 16, padding: 16 },
  cardHeader: { flexDirection: 'row' },
  avatar: { width: 64, height: 64, borderRadius: 32, marginRight: 16 },
  cardInfo: { flex: 1, justifyContent: 'center' },
  name: { fontFamily: 'Inter_600SemiBold', fontSize: 18 },
  specialty: { fontFamily: 'Inter_400Regular', fontSize: 14, marginTop: 4 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 },
  ratingText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  reviewCount: { fontFamily: 'Inter_400Regular', fontSize: 14 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18, marginTop: 16 }
});

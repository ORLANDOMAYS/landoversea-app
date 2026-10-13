import React from 'react';
import { View, StyleSheet, Text, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveMatches } from '@/lib/liveSupabase';
import { Ionicons } from '@expo/vector-icons';
import { AuthenticatedProfileImage } from '@/components/AuthenticatedProfileImage';
import { useI18n } from '@/i18n';
import { Link } from 'expo-router';
import { Button } from '@/components/ui/Button';

export default function MatchesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();

  const matchesQuery = useLiveMatches();
  const { data: matches, isLoading, isError, isRefetching } = matchesQuery;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>{t('matches.title')}</Text>
      </View>

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.primary} /></View>
      ) : isError ? (
        <View accessibilityRole="alert" style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>{t('discover.loadErrorDesc')}</Text>
          <Button title={t('common.retry')} onPress={() => void matchesQuery.refetch()} />
        </View>
      ) : matches?.length ? (
        <FlatList
          data={matches}
          keyExtractor={item => item.id.toString()}
          numColumns={2}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 84 }]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void matchesQuery.refetch()} tintColor={colors.primary} colors={[colors.primary]} />}
          columnWrapperStyle={styles.row}
          renderItem={({ item }) => (
            <Link href={`/messages/${item.conversationId}` as any} style={styles.matchLink}>
              <View style={[styles.matchCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <AuthenticatedProfileImage
                  url={item.otherUser?.photos?.[0]?.url}
                  style={styles.matchImage}
                  accessibilityLabel={item.otherUser?.name ?? t('mobile.unknownUser')}
                />
                <View style={styles.matchInfo}>
                  <Text style={[styles.matchName, { color: colors.cardForeground }]} numberOfLines={1}>
                    {item.otherUser?.name}
                  </Text>
                  <Text style={[styles.matchDate, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {new Date(item.createdAt).toLocaleDateString()}
                  </Text>
                </View>
              </View>
            </Link>
          )}
        />
      ) : (
        <View style={styles.empty}>
          <Ionicons name="heart-dislike-outline" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{t('matches.noMatchesTitle')}</Text>
          <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>{t('matches.noMatchesDesc')}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 24, paddingVertical: 16 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 24 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontFamily: 'Inter_400Regular', fontSize: 15, textAlign: 'center', marginVertical: 16, paddingHorizontal: 24 },
  list: { padding: 16 },
  row: { justifyContent: 'space-between', marginBottom: 16 },
  matchLink: { width: '48%' },
  matchCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  matchImage: { width: '100%', aspectRatio: 1 },
  matchInfo: { padding: 12 },
  matchName: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  matchDate: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18, marginTop: 16 },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center', marginTop: 8 }
});

import React from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getGetTribesQueryKey, useGetTribes } from '@workspace/api-client-react';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { useColors } from '@/hooks/useColors';
import { useI18n } from '@/i18n';

export default function TribesScreen() {
  const colors = useColors(); const insets = useSafeAreaInsets(); const router = useRouter(); const { t, locale, dir } = useI18n();
  const query = useGetTribes({ query: { queryKey: getGetTribesQueryKey(), staleTime: 30_000 } });
  return <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
    <View style={[styles.header, { flexDirection: dir === 'rtl' ? 'row-reverse' : 'row' }]}><Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={28} color={colors.foreground} /></Pressable><Text style={[styles.title, { color: colors.foreground, writingDirection: dir }]}>{t('culture.tribes')}</Text></View>
    {query.isLoading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : query.isError ? <View accessibilityRole="alert" style={styles.centered}><Text style={{ color: colors.mutedForeground }}>{t('discover.loadErrorDesc')}</Text><Button title={t('common.retry')} onPress={() => void query.refetch()} /></View> :
      <FlatList data={query.data ?? []} keyExtractor={item => String(item.id)} contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]} refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} colors={[colors.primary]} />} renderItem={({ item }) =>
        <Pressable accessibilityRole="button" onPress={() => router.push(`/tribes/${item.id}` as never)}><GlassCard style={styles.card}><Text style={[styles.cardTitle, { color: colors.foreground, writingDirection: dir }]}>{item.name}</Text><Text style={[styles.meta, { color: colors.primary, writingDirection: dir }]}>{[item.country, item.language].filter(Boolean).join(' · ')}</Text>{item.description ? <Text numberOfLines={3} style={[styles.body, { color: colors.mutedForeground, writingDirection: dir }]}>{item.description}</Text> : null}<Text style={[styles.meta, { color: colors.mutedForeground, writingDirection: dir }]}>{t('mobile.membersCount', { count: item.memberCount.toLocaleString(locale) })}</Text></GlassCard></Pressable>
      } ListEmptyComponent={<View style={styles.centered}><Ionicons name="people-outline" size={48} color={colors.mutedForeground} /><Text style={{ color: colors.mutedForeground, writingDirection: dir }}>{t('mobile.tribesEmpty')}</Text></View>} />}
  </View>;
}
const styles = StyleSheet.create({
  container: { flex: 1 }, header: { alignItems: 'center', padding: 16 }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 22, marginStart: 12 }, loader: { marginTop: 32 }, centered: { flexGrow: 1, minHeight: 280, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  list: { padding: 16, flexGrow: 1 }, card: { padding: 18, marginBottom: 12 }, cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18 }, meta: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 8 }, body: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, marginTop: 10 },
});
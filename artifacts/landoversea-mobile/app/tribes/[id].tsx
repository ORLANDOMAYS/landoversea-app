import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getGetTribesQueryKey, useGetTribes, useJoinTribe, useLeaveTribe } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { useColors } from '@/hooks/useColors';
import { useI18n } from '@/i18n';

export default function TribeDetailScreen() {
  const colors = useColors(); const insets = useSafeAreaInsets(); const router = useRouter(); const { t, locale, dir } = useI18n(); const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string | string[] }>(); const id = Number(Array.isArray(params.id) ? params.id[0] : params.id); const validId = Number.isInteger(id) && id > 0;
  const query = useGetTribes({ query: { queryKey: getGetTribesQueryKey(), enabled: validId } }); const join = useJoinTribe(); const leave = useLeaveTribe(); const tribe = query.data?.find(item => item.id === id);
  const toggle = async () => {
    if (!tribe) return;
    join.reset();
    leave.reset();
    try {
      if (tribe.isMember) await leave.mutateAsync({ tribeId: id });
      else await join.mutateAsync({ tribeId: id });
      await queryClient.invalidateQueries({ queryKey: getGetTribesQueryKey() });
    } catch {
      // The generated mutation retains the error so the inline retry remains visible.
    }
  };
  const mutationError = join.isError || leave.isError;
  return <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
    <View style={[styles.header, { flexDirection: dir === 'rtl' ? 'row-reverse' : 'row' }]}><Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={28} color={colors.foreground} /></Pressable><Text style={[styles.title, { color: colors.foreground, writingDirection: dir }]}>{t('culture.tribes')}</Text></View>
    {query.isLoading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : query.isError ? <View accessibilityRole="alert" style={styles.centered}><Text style={{ color: colors.mutedForeground }}>{t('discover.loadErrorDesc')}</Text><Button title={t('common.retry')} onPress={() => void query.refetch()} /></View> : !validId || !tribe ? <View accessibilityRole="alert" style={styles.centered}><Text style={{ color: colors.mutedForeground, writingDirection: dir }}>{t('mobile.tribeNotFound')}</Text><Button title={t('common.back')} onPress={() => router.back()} /></View> :
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}><GlassCard style={styles.card}><Text style={[styles.name, { color: colors.foreground, writingDirection: dir }]}>{tribe.name}</Text><Text style={[styles.meta, { color: colors.primary, writingDirection: dir }]}>{[tribe.country, tribe.language].filter(Boolean).join(' · ')}</Text><Text style={[styles.meta, { color: colors.mutedForeground, writingDirection: dir }]}>{t('mobile.membersCount', { count: tribe.memberCount.toLocaleString(locale) })}</Text>{tribe.description ? <Text style={[styles.body, { color: colors.foreground, writingDirection: dir }]}>{tribe.description}</Text> : null}<Button testID={tribe.isMember ? 'leave-tribe' : 'join-tribe'} title={tribe.isMember ? t('mobile.leaveTribe') : t('mobile.joinTribe')} variant={tribe.isMember ? 'outline' : 'primary'} loading={join.isPending || leave.isPending} onPress={() => void toggle()} />{mutationError ? <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.mutationError}><Text style={{ color: colors.destructive, writingDirection: dir }}>{t('mobile.tribeMembershipError')}</Text><Button testID="retry-tribe-membership" title={t('common.retry')} variant="outline" size="sm" onPress={() => void toggle()} /></View> : null}</GlassCard></ScrollView>}
  </View>;
}
const styles = StyleSheet.create({
  container: { flex: 1 }, header: { alignItems: 'center', padding: 16 }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, title: { fontFamily: 'Inter_700Bold', fontSize: 22, marginStart: 12 }, loader: { marginTop: 32 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }, content: { padding: 20 }, card: { padding: 22, gap: 14 }, name: { fontFamily: 'Inter_700Bold', fontSize: 26 }, meta: { fontFamily: 'Inter_500Medium', fontSize: 14 }, body: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 24 }, mutationError: { gap: 10, alignItems: 'flex-start' },
});
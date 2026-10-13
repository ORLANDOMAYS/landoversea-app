import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getGetWorkshopQueryKey, getGetWorkshopsQueryKey, useEnrollWorkshop, useGetWorkshop } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { useColors } from '@/hooks/useColors';
import { useI18n } from '@/i18n';

export default function WorkshopDetailScreen() {
  const colors = useColors(); const insets = useSafeAreaInsets(); const router = useRouter(); const { t, locale, dir } = useI18n(); const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string | string[] }>(); const id = Number(Array.isArray(params.id) ? params.id[0] : params.id); const validId = Number.isInteger(id) && id > 0;
  const query = useGetWorkshop(id, { query: { queryKey: getGetWorkshopQueryKey(id), enabled: validId } }); const enroll = useEnrollWorkshop(); const workshop = query.data;
  const handleEnroll = async () => {
    enroll.reset();
    try {
      await enroll.mutateAsync({ workshopId: id });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetWorkshopQueryKey(id) }),
        queryClient.invalidateQueries({ queryKey: getGetWorkshopsQueryKey() }),
      ]);
    } catch {
      // The generated mutation retains the error so the inline retry remains visible.
    }
  };
  return <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
    <View style={[styles.header, { flexDirection: dir === 'rtl' ? 'row-reverse' : 'row' }]}><Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={28} color={colors.foreground} /></Pressable><Text style={[styles.title, { color: colors.foreground, writingDirection: dir }]}>{t('culture.workshops')}</Text></View>
    {query.isLoading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : query.isError ? <View accessibilityRole="alert" style={styles.centered}><Text style={{ color: colors.mutedForeground }}>{t('discover.loadErrorDesc')}</Text><Button title={t('common.retry')} onPress={() => void query.refetch()} /></View> : !validId || !workshop ? <View accessibilityRole="alert" style={styles.centered}><Text style={{ color: colors.mutedForeground, writingDirection: dir }}>{t('mobile.workshopNotFound')}</Text><Button title={t('common.back')} onPress={() => router.back()} /></View> :
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}><GlassCard style={styles.card}><Text style={[styles.name, { color: colors.foreground, writingDirection: dir }]}>{workshop.title}</Text><Text style={[styles.meta, { color: colors.primary, writingDirection: dir }]}>{new Date(workshop.scheduledAt).toLocaleString(locale)}</Text><Text style={[styles.meta, { color: colors.mutedForeground, writingDirection: dir }]}>{t('mobile.workshopDurationParticipants', { minutes: workshop.durationMinutes ?? 60, current: workshop.currentParticipants ?? 0, maximum: workshop.maxParticipants })}</Text>{workshop.coach?.displayName ? <Text style={[styles.meta, { color: colors.foreground, writingDirection: dir }]}>{workshop.coach.displayName}</Text> : null}{workshop.description ? <Text style={[styles.body, { color: colors.foreground, writingDirection: dir }]}>{workshop.description}</Text> : null}<Button testID="enroll-workshop" title={workshop.isEnrolled ? t('mobile.enrolled') : t('mobile.enroll')} disabled={workshop.isEnrolled} loading={enroll.isPending} onPress={() => void handleEnroll()} />{enroll.isError ? <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.mutationError}><Text style={{ color: colors.destructive, writingDirection: dir }}>{t('mobile.workshopEnrollError')}</Text><Button testID="retry-workshop-enrollment" title={t('common.retry')} variant="outline" size="sm" onPress={() => void handleEnroll()} /></View> : null}</GlassCard></ScrollView>}
  </View>;
}
const styles = StyleSheet.create({
  container: { flex: 1 }, header: { alignItems: 'center', padding: 16 }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, title: { fontFamily: 'Inter_700Bold', fontSize: 22, marginStart: 12 }, loader: { marginTop: 32 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }, content: { padding: 20 }, card: { padding: 22, gap: 14 }, name: { fontFamily: 'Inter_700Bold', fontSize: 26 }, meta: { fontFamily: 'Inter_500Medium', fontSize: 14 }, body: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 24 }, mutationError: { gap: 10, alignItems: 'flex-start' },
});
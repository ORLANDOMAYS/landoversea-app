import React, { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getGetCulturalEventsQueryKey, useCancelEventRsvp, useGetCulturalEvents, useRsvpEvent } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { useColors } from '@/hooks/useColors';
import { useI18n } from '@/i18n';

export default function EventsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, locale, dir } = useI18n();
  const queryClient = useQueryClient();
  const [failedChange, setFailedChange] = useState<{ eventId: number; next: boolean } | null>(null);
  const [feedback, setFeedback] = useState<{ eventId: number; message: string } | null>(null);
  const eventParams = { limit: 50 };
  const query = useGetCulturalEvents(eventParams, { query: { queryKey: getGetCulturalEventsQueryKey(eventParams), staleTime: 30_000 } });
  const rsvp = useRsvpEvent();
  const cancelRsvp = useCancelEventRsvp();

  const changeRsvp = async (eventId: number, next: boolean) => {
    setFailedChange(null);
    setFeedback(null);
    queryClient.setQueryData(getGetCulturalEventsQueryKey(eventParams), (current: typeof query.data) =>
      current?.map(item => item.id === eventId ? { ...item, isRsvped: next } : item));
    try {
      if (next) await rsvp.mutateAsync({ eventId });
      else await cancelRsvp.mutateAsync({ eventId });
      setFeedback({ eventId, message: t(next ? 'mobile.rsvpConfirmed' : 'mobile.rsvpCancelled') });
    } catch {
      queryClient.setQueryData(getGetCulturalEventsQueryKey(eventParams), (current: typeof query.data) =>
        current?.map(item => item.id === eventId ? { ...item, isRsvped: !next } : item));
      setFailedChange({ eventId, next });
    } finally {
      await queryClient.invalidateQueries({ queryKey: getGetCulturalEventsQueryKey() });
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { flexDirection: dir === 'rtl' ? 'row-reverse' : 'row' }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={28} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground, writingDirection: dir }]}>{t('culture.events')}</Text>
      </View>
      {query.isLoading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : query.isError ? (
        <View accessibilityRole="alert" style={styles.centered}>
          <Text style={[styles.message, { color: colors.mutedForeground }]}>{t('discover.loadErrorDesc')}</Text>
          <Button title={t('common.retry')} onPress={() => void query.refetch()} />
        </View>
      ) : (
        <FlatList
          data={query.data ?? []}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} colors={[colors.primary]} />}
          renderItem={({ item }) => {
            const pending = (rsvp.isPending && rsvp.variables?.eventId === item.id)
              || (cancelRsvp.isPending && cancelRsvp.variables?.eventId === item.id);
            return (
            <Pressable accessibilityRole="button" accessibilityLabel={item.title} onPress={() => router.push(`/events/${item.id}` as never)}>
              <GlassCard style={styles.card}>
                <Text style={[styles.cardTitle, { color: colors.foreground, writingDirection: dir }]}>{item.title}</Text>
                <Text style={[styles.meta, { color: colors.primary, writingDirection: dir }]}>{item.country} · {new Date(item.date).toLocaleString(locale)}</Text>
                {item.description ? <Text numberOfLines={3} style={[styles.message, { color: colors.mutedForeground, writingDirection: dir }]}>{item.description}</Text> : null}
                <Button
                  title={item.isRsvped ? t('mobile.cancelRsvp') : t('mobile.rsvp')}
                  variant={item.isRsvped ? 'outline' : 'primary'}
                  loading={pending}
                  accessibilityLabel={item.isRsvped ? t('mobile.cancelRsvp') : t('mobile.rsvp')}
                  testID={`${item.isRsvped ? 'cancel-rsvp' : 'rsvp'}-${item.id}`}
                  onPress={(pressEvent) => {
                    pressEvent.stopPropagation();
                    void changeRsvp(item.id, !item.isRsvped);
                  }}
                />
                {feedback?.eventId === item.id ? <Text accessibilityLiveRegion="polite" style={[styles.feedback, { color: colors.primary, writingDirection: dir }]}>{feedback.message}</Text> : null}
                {failedChange?.eventId === item.id ? (
                  <View accessibilityRole="alert" style={styles.retry}>
                    <Text style={[styles.message, { color: colors.destructive, writingDirection: dir }]}>{t(failedChange.next ? 'mobile.rsvpError' : 'mobile.cancelRsvpError')}</Text>
                    <Button title={t('common.retry')} variant="outline" disabled={pending} onPress={() => void changeRsvp(item.id, failedChange.next)} />
                  </View>
                ) : null}
              </GlassCard>
            </Pressable>
          )}}
          ListEmptyComponent={<View style={styles.centered}><Ionicons name="calendar-outline" size={48} color={colors.mutedForeground} /><Text style={[styles.message, { color: colors.mutedForeground, writingDirection: dir }]}>{t('mobile.eventsEmpty')}</Text></View>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: 'center', padding: 16 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 22, marginStart: 12 },
  loader: { marginTop: 32 },
  centered: { flexGrow: 1, minHeight: 280, alignItems: 'center', justifyContent: 'center', padding: 24 },
  message: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, textAlign: 'center', marginVertical: 12 },
  list: { padding: 16, flexGrow: 1 },
  card: { padding: 18, marginBottom: 12 },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18 },
  meta: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 8 },
  feedback: { fontFamily: 'Inter_500Medium', fontSize: 14, marginTop: 10, textAlign: 'center' },
  retry: { gap: 8 },
});
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getGetCulturalEventsQueryKey, useCancelEventRsvp, useGetCulturalEvents, useRsvpEvent } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { useColors } from '@/hooks/useColors';
import { useI18n } from '@/i18n';

export default function EventDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, locale, dir } = useI18n();
  const queryClient = useQueryClient();
  const [failedChange, setFailedChange] = useState<boolean | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Number(Array.isArray(params.id) ? params.id[0] : params.id);
  const validId = Number.isInteger(id) && id > 0;
  const listParams = { limit: 100 };
  const query = useGetCulturalEvents(listParams, { query: { queryKey: getGetCulturalEventsQueryKey(listParams), enabled: validId } });
  const rsvp = useRsvpEvent();
  const cancelRsvp = useCancelEventRsvp();
  const event = query.data?.find(item => item.id === id);

  const changeRsvp = async (next: boolean) => {
    setFailedChange(null);
    setFeedback(null);
    queryClient.setQueryData(getGetCulturalEventsQueryKey(listParams), (current: typeof query.data) =>
      current?.map(item => item.id === id ? { ...item, isRsvped: next } : item));
    try {
      if (next) await rsvp.mutateAsync({ eventId: id });
      else await cancelRsvp.mutateAsync({ eventId: id });
      setFeedback(t(next ? 'mobile.rsvpConfirmed' : 'mobile.rsvpCancelled'));
    } catch {
      queryClient.setQueryData(getGetCulturalEventsQueryKey(listParams), (current: typeof query.data) =>
        current?.map(item => item.id === id ? { ...item, isRsvped: !next } : item));
      setFailedChange(next);
    } finally {
      await queryClient.invalidateQueries({ queryKey: getGetCulturalEventsQueryKey() });
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { flexDirection: dir === 'rtl' ? 'row-reverse' : 'row' }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={28} color={colors.foreground} /></Pressable>
         <Text style={[styles.title, { color: colors.foreground, writingDirection: dir }]}>{t('culture.events')}</Text>
      </View>
      {query.isLoading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : query.isError ? (
        <View accessibilityRole="alert" style={styles.centered}><Text style={{ color: colors.mutedForeground }}>{t('discover.loadErrorDesc')}</Text><Button title={t('common.retry')} onPress={() => void query.refetch()} /></View>
      ) : !validId || !event ? (
        <View accessibilityRole="alert" style={styles.centered}><Text style={{ color: colors.mutedForeground, writingDirection: dir }}>{t('mobile.eventNotFound')}</Text><Button title={t('common.back')} onPress={() => router.back()} /></View>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          <GlassCard style={styles.card}>
            <Text style={[styles.eventTitle, { color: colors.foreground, writingDirection: dir }]}>{event.title}</Text>
            <Text style={[styles.meta, { color: colors.primary, writingDirection: dir }]}>{event.country}</Text>
            <Text style={[styles.meta, { color: colors.mutedForeground, writingDirection: dir }]}>{new Date(event.date).toLocaleString(locale)}</Text>
            {event.description ? <Text style={[styles.body, { color: colors.foreground, writingDirection: dir }]}>{event.description}</Text> : null}
            <Button
              title={event.isRsvped ? t('mobile.cancelRsvp') : t('mobile.rsvp')}
              variant={event.isRsvped ? 'outline' : 'primary'}
              loading={rsvp.isPending || cancelRsvp.isPending}
              accessibilityLabel={event.isRsvped ? t('mobile.cancelRsvp') : t('mobile.rsvp')}
              testID={event.isRsvped ? 'cancel-event-rsvp' : 'event-rsvp'}
              onPress={() => void changeRsvp(!event.isRsvped)}
            />
            {feedback ? <Text accessibilityLiveRegion="polite" style={{ color: colors.primary, writingDirection: dir }}>{feedback}</Text> : null}
            {failedChange !== null ? (
              <View accessibilityRole="alert" style={styles.retry}>
                <Text style={{ color: colors.destructive, writingDirection: dir }}>{t(failedChange ? 'mobile.rsvpError' : 'mobile.cancelRsvpError')}</Text>
                <Button title={t('common.retry')} variant="outline" onPress={() => void changeRsvp(failedChange)} />
              </View>
            ) : null}
          </GlassCard>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 }, header: { alignItems: 'center', padding: 16 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 22, marginStart: 12 }, loader: { marginTop: 32 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  content: { padding: 20 }, card: { padding: 22, gap: 14 },
  eventTitle: { fontFamily: 'Inter_700Bold', fontSize: 26 }, meta: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 24 },
  retry: { gap: 10 },
});
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isSupabaseUuid, useLiveCoach } from '@/lib/liveSupabase';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { useColors } from '@/hooks/useColors';
import { useI18n } from '@/i18n';
import { AuthenticatedProfileImage } from '@/components/AuthenticatedProfileImage';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createUuidCoachBooking, getUuidCoachAvailability, type CoachTimeSlot } from '@/lib/safeApi';

const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export default function CoachDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const liveCoachId = Array.isArray(id) ? id[0] : id;
  const validCoachId = isSupabaseUuid(liveCoachId);
  const dates = useMemo(
    () => Array.from({ length: 7 }, (_, offset) => {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      return date;
    }),
    [],
  );
  const [selectedDate, setSelectedDate] = useState(dateKey(dates[0]));
  const [selectedSlot, setSelectedSlot] = useState<CoachTimeSlot | null>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const coachQuery = useLiveCoach(liveCoachId ?? '', validCoachId);
  const availabilityQuery = useQuery({
    queryKey: ['uuid-coach-availability', liveCoachId, selectedDate, timeZone],
    queryFn: () => getUuidCoachAvailability(liveCoachId!, selectedDate, timeZone),
    enabled: validCoachId,
  });
  const createBooking = useMutation({ mutationFn: createUuidCoachBooking });

  const handleBook = async () => {
    if (!selectedSlot?.available || !liveCoachId) return;
    const durationMinutes = Math.round(
      (new Date(selectedSlot.endAt).getTime() - new Date(selectedSlot.startAt).getTime()) / 60_000,
    );
    try {
      await createBooking.mutateAsync({
        coachId: liveCoachId,
        scheduledAt: selectedSlot.startAt,
        durationMinutes,
        notes: null,
      });
      Alert.alert(t('coaching.bookCoach'), t('common.confirm'), [
        { text: t('common.close'), onPress: () => router.back() },
      ]);
    } catch (error) {
      Alert.alert(t('premium.genericError'), error instanceof Error ? error.message : t('premium.cancellationFailedDesc'));
    }
  };

  if (!validCoachId) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.foreground }}>{t('premium.genericError')}</Text>
      </View>
    );
  }

  const coach = coachQuery.data;
  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={4}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={28} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>{t('coaching.bookCoach')}</Text>
      </View>
      {coachQuery.isLoading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : coachQuery.isError || !coach ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.mutedForeground }}>{t('premium.genericError')}</Text>
          <Button title={t('common.retry')} onPress={() => coachQuery.refetch()} style={styles.retry} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          <GlassCard style={styles.profile}>
            {coach.photoUrl ? (
              <AuthenticatedProfileImage
                url={coach.photoUrl}
                style={styles.avatar}
                accessibilityLabel={coach.displayName}
              />
            ) : (
              <View style={[styles.avatar, styles.noPhoto, { backgroundColor: colors.muted }]}>
                <Ionicons name="person-outline" size={42} color={colors.mutedForeground} />
              </View>
            )}
            <Text style={[styles.name, { color: colors.foreground }]}>{coach.displayName}</Text>
            {coach.isVerified ? <Ionicons name="shield-checkmark" size={20} color={colors.secondary} /> : null}
            {coach.bio ? <Text style={[styles.bio, { color: colors.mutedForeground }]}>{coach.bio}</Text> : null}
            {coach.specialties?.length ? (
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>{coach.specialties.join(' · ')}</Text>
            ) : null}
            {coach.languages?.length ? (
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>{coach.languages.join(' · ')}</Text>
            ) : null}
            <Text style={[styles.price, { color: colors.primary }]}>
              {coach.ratesPerHour != null
                ? new Intl.NumberFormat(undefined, { style: 'currency', currency: coach.currency ?? 'USD' }).format(coach.ratesPerHour)
                : t('premium.paymentsNotConfigured')}
            </Text>
          </GlassCard>

          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{t('coaching.bookCoach')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateRow}>
            {dates.map(date => {
              const value = dateKey(date);
              const active = value === selectedDate;
              return (
                <Pressable
                  key={value}
                  onPress={() => {
                    setSelectedDate(value);
                    setSelectedSlot(null);
                  }}
                  style={[
                    styles.date,
                    { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.glassStrong : 'transparent' },
                  ]}
                >
                  <Text style={{ color: active ? colors.primary : colors.foreground }}>
                    {date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {availabilityQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} style={styles.loader} />
          ) : availabilityQuery.isError ? (
            <View style={styles.bookingError} accessibilityRole="alert">
              <Text style={{ color: colors.destructive }}>
                {availabilityQuery.error instanceof Error ? availabilityQuery.error.message : t('premium.genericError')}
              </Text>
              <Button title={t('common.retry')} variant="outline" onPress={() => availabilityQuery.refetch()} />
            </View>
          ) : availabilityQuery.data?.some(slot => slot.available) ? (
            <View style={styles.slots}>
              {availabilityQuery.data.map(slot => {
                const active = selectedSlot?.startAt === slot.startAt;
                return (
                  <Pressable
                    key={`${slot.startAt}-${slot.endAt}`}
                    disabled={!slot.available}
                    onPress={() => setSelectedSlot(slot)}
                    style={[
                      styles.slot,
                      {
                        opacity: slot.available ? 1 : 0.4,
                        borderColor: active ? colors.primary : colors.border,
                        backgroundColor: active ? colors.primary : 'transparent',
                      },
                    ]}
                  >
                    <Text style={{ color: active ? colors.primaryForeground : colors.foreground }}>
                      {new Date(slot.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>{t('premium.paymentsNotConfigured')}</Text>
          )}
          <Button
            title={t('coaching.bookCoach')}
            onPress={handleBook}
            disabled={!selectedSlot?.available}
            loading={createBooking.isPending}
          />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, marginStart: 16 },
  loader: { marginVertical: 24 },
  retry: { marginTop: 16 },
  content: { padding: 20, gap: 18 },
  profile: { alignItems: 'center', padding: 20 },
  avatar: { width: 104, height: 104, borderRadius: 52, marginBottom: 12 },
  noPhoto: { alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: 'Inter_700Bold', fontSize: 24, textAlign: 'center' },
  bio: { fontFamily: 'Inter_400Regular', fontSize: 15, textAlign: 'center', marginTop: 10 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', marginTop: 6 },
  price: { fontFamily: 'Inter_600SemiBold', fontSize: 17, marginTop: 12 },
  sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18 },
  dateRow: { gap: 8 },
  date: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  slot: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 10 },
  empty: { textAlign: 'center', paddingVertical: 20 },
  payment: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center' },
  bookingError: { gap: 12, alignItems: 'center' },
});
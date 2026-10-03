import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  type CoachInput,
  getGetMyCoachProfileQueryKey,
  useCreateCoachProfile,
  useGetMyCoachProfile,
  useSubmitCoachVerification,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { GlassCard } from '@/components/ui/GlassCard';
import { useColors } from '@/hooks/useColors';
import { useI18n } from '@/i18n';

export default function CoachApplicationScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, dir } = useI18n();
  const profileQuery = useGetMyCoachProfile({ query: { retry: false, queryKey: getGetMyCoachProfileQueryKey() } });
  const createProfile = useCreateCoachProfile();
  const submitVerification = useSubmitCoachVerification();
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [languages, setLanguages] = useState('');
  const [specialties, setSpecialties] = useState('');
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submitApplication = async () => {
    const hourlyRate = Number(rate);
    if (!displayName.trim() || !bio.trim() || !Number.isFinite(hourlyRate) || hourlyRate <= 0) {
      setError(t('onboarding.required'));
      return;
    }
    const data: CoachInput = {
      displayName: displayName.trim(),
      bio: bio.trim(),
      languages: languages.split(',').map(value => value.trim()).filter(Boolean),
      specialties: specialties.split(',').map(value => value.trim()).filter(Boolean),
      sessionLengthsMinutes: [30, 60],
      ratesPerHour: hourlyRate,
      currency: 'USD',
      availability: {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        slots: [],
      },
    };
    setError(null);
    try {
      await createProfile.mutateAsync({ data });
      await profileQuery.refetch();
    } catch {
      setError(t('mobile.saveFailed'));
    }
  };

  const requestReview = async () => {
    setError(null);
    try {
      await submitVerification.mutateAsync({ data: { notes: null } });
      await profileQuery.refetch();
    } catch {
      setError(t('mobile.saveFailed'));
    }
  };

  const profile = profileQuery.data;
  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { flexDirection: dir === 'rtl' ? 'row-reverse' : 'row' }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground, writingDirection: dir }]}>{t('coaching.apply')}</Text>
      </View>
      {profileQuery.isLoading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : profileQuery.isError && (profileQuery.error as { status?: number } | null)?.status !== 404 ? (
        <View accessibilityRole="alert" style={styles.centered}><Text style={{ color: colors.destructive }}>{t('discover.loadErrorDesc')}</Text><Button title={t('common.retry')} onPress={() => profileQuery.refetch()} /></View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          {profile ? (
            <GlassCard style={styles.card}>
              <Text style={[styles.heading, { color: colors.foreground, writingDirection: dir }]}>{profile.displayName}</Text>
              <Text style={{ color: colors.mutedForeground, writingDirection: dir }}>{profile.verificationStatus}</Text>
              {profile.verificationStatus === 'unsubmitted' || profile.verificationStatus === 'rejected' ? (
                <Button title={t('common.submit')} onPress={requestReview} loading={submitVerification.isPending} />
              ) : null}
              <Button title={t('coaching.dashboard')} variant="outline" onPress={() => router.replace('/coaches/dashboard' as never)} />
            </GlassCard>
          ) : (
            <GlassCard style={styles.card}>
              <Input value={displayName} onChangeText={setDisplayName} placeholder={t('auth.name')} textAlign={dir === 'rtl' ? 'right' : 'left'} />
              <Input value={bio} onChangeText={setBio} placeholder={t('profile.bioPlaceholder')} multiline textAlign={dir === 'rtl' ? 'right' : 'left'} />
              <Input value={languages} onChangeText={setLanguages} placeholder={t('profile.languages')} textAlign={dir === 'rtl' ? 'right' : 'left'} />
              <Input value={specialties} onChangeText={setSpecialties} placeholder={t('profile.interests')} textAlign={dir === 'rtl' ? 'right' : 'left'} />
              <Input value={rate} onChangeText={setRate} placeholder={t('coaching.bookCoach')} keyboardType="decimal-pad" textAlign={dir === 'rtl' ? 'right' : 'left'} />
              <Text style={{ color: colors.mutedForeground, writingDirection: dir }}>{t('premium.paymentsNotConfigured')}</Text>
              <Button title={t('common.save')} onPress={submitApplication} loading={createProfile.isPending} />
            </GlassCard>
          )}
          {error ? <Text accessibilityRole="alert" style={{ color: colors.destructive, writingDirection: dir }}>{error}</Text> : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20, marginStart: 16 },
  loader: { marginTop: 32 },
  content: { padding: 20, gap: 14 },
  card: { padding: 18, gap: 12 },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 22 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
});
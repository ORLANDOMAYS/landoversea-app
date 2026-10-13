import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import {
  getGetMyCoachCredentialsQueryKey,
  type CoachCredentialInput,
  useFinalizeCoachCredential,
  useGetCoachDashboard,
  useGetMyCoachCredentials,
  useGetMyCoachProfile,
  useRequestUploadUrl,
  useUpdateCoachProfile,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { useColors } from '@/hooks/useColors';
import { useI18n } from '@/i18n';
import { Input } from '@/components/ui/Input';

const MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
type AllowedType = (typeof ALLOWED_TYPES)[number];
type PickedCredential = { uri: string; name: string; size: number; contentType: AllowedType };

export default function CoachDashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const profileQuery = useGetMyCoachProfile();
  const dashboardQuery = useGetCoachDashboard();
  const credentialsQuery = useGetMyCoachCredentials();
  const requestUrl = useRequestUploadUrl();
  const finalizeCredential = useFinalizeCoachCredential();
  const updateProfile = useUpdateCoachProfile();
  const [file, setFile] = useState<PickedCredential | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [bio, setBio] = useState('');
  const [rate, setRate] = useState('');

  const uploadCredential = async (credential: PickedCredential) => {
    setUploading(true);
    setError(null);
    setProgress(5);
    try {
      const localResponse = await fetch(credential.uri);
      if (!localResponse.ok) throw new Error(t('coachCredential.uploadFailed'));
      const blob = await localResponse.blob();
      if (blob.size < 1 || blob.size > MAX_SIZE) throw new Error(t('coachCredential.sizeLimit'));
      const bytes = await blob.arrayBuffer();
      setProgress(20);
      const authorization = await requestUrl.mutateAsync({
        data: {
          name: credential.name,
          contentType: credential.contentType,
          size: blob.size,
          purpose: 'coach_credential',
        },
      });
      if (!authorization.uploadToken) throw new Error(t('coachCredential.authorizationMissing'));
      setProgress(40);
      const response = await fetch(authorization.uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': credential.contentType },
        body: bytes,
      });
      if (!response.ok) throw new Error(t('coachCredential.uploadFailed'));
      setProgress(85);
      const data: CoachCredentialInput = {
        objectPath: authorization.objectPath,
        uploadToken: authorization.uploadToken,
        kind: 'certification',
        title: credential.name,
        originalName: credential.name,
        contentType: credential.contentType,
        size: blob.size,
      };
      await finalizeCredential.mutateAsync({ data });
      await queryClient.invalidateQueries({ queryKey: getGetMyCoachCredentialsQueryKey() });
      setProgress(100);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('coachCredential.uploadRetry'));
    } finally {
      setUploading(false);
    }
  };

  const pickCredential = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: [...ALLOWED_TYPES],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const contentType = asset.mimeType;
    if (!contentType || !ALLOWED_TYPES.includes(contentType as AllowedType)) {
      setError(t('coachCredential.allowedTypes'));
      return;
    }
    if (!asset.size || asset.size > MAX_SIZE) {
      setError(t('coachCredential.sizeLimit'));
      return;
    }
    const selected: PickedCredential = {
      uri: asset.uri,
      name: asset.name,
      size: asset.size,
      contentType: contentType as AllowedType,
    };
    setFile(selected);
    await uploadCredential(selected);
  };

  const loading = profileQuery.isLoading || dashboardQuery.isLoading || credentialsQuery.isLoading;
  const profile = profileQuery.data;
  const dashboard = dashboardQuery.data;
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
        <Text style={[styles.title, { color: colors.foreground }]}>{t('coaching.dashboard')}</Text>
      </View>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : profileQuery.isError || !profile ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.mutedForeground }}>{t('premium.genericError')}</Text>
          <Button title={t('common.retry')} onPress={() => profileQuery.refetch()} style={styles.retry} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          <GlassCard style={styles.card}>
            <Text style={[styles.name, { color: colors.foreground }]}>{profile.displayName}</Text>
            <Text style={{ color: colors.mutedForeground }}>{profile.verificationStatus}</Text>
            <Text style={{ color: profile.isPayoutReady ? colors.secondary : colors.mutedForeground }}>
              {profile.isPayoutReady ? t('common.yes') : t('premium.paymentsNotConfigured')}
            </Text>
          </GlassCard>
          <GlassCard style={styles.card}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{t('profile.editProfile')}</Text>
            <Input value={bio} onChangeText={setBio} placeholder={profile.bio || t('profile.bioPlaceholder')} multiline />
            <Input value={rate} onChangeText={setRate} placeholder={profile.ratesPerHour != null ? String(profile.ratesPerHour) : t('coaching.bookCoach')} keyboardType="decimal-pad" />
            <Button
              testID="save-coach-profile"
              title={t('common.save')}
              loading={updateProfile.isPending}
              onPress={async () => {
                const numericRate = Number(rate);
                if (!bio.trim() && (!rate.trim() || !Number.isFinite(numericRate) || numericRate <= 0)) {
                  setError(t('onboarding.required'));
                  return;
                }
                try {
                  await updateProfile.mutateAsync({
                    data: {
                      ...(bio.trim() ? { bio: bio.trim() } : {}),
                      ...(rate.trim() && Number.isFinite(numericRate) && numericRate > 0 ? { ratesPerHour: numericRate } : {}),
                    },
                  });
                  setBio('');
                  setRate('');
                  await profileQuery.refetch();
                } catch {
                  setError(t('mobile.saveFailed'));
                }
              }}
            />
          </GlassCard>
          {dashboard ? (
            <View style={styles.metrics}>
              {[
                [t('coaching.clientProgress'), dashboard.totalClients],
                [t('coaching.bookCoach'), dashboard.totalBookings],
                [t('premium.title'), dashboard.totalRevenue],
              ].map(([label, value]) => (
                <GlassCard key={String(label)} style={styles.metric}>
                  <Text style={[styles.metricValue, { color: colors.foreground }]}>{String(value)}</Text>
                  <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{String(label)}</Text>
                </GlassCard>
              ))}
            </View>
          ) : null}
          <GlassCard style={styles.card}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{t('coachCredential.uploadDocument')}</Text>
            <Text style={[styles.description, { color: colors.mutedForeground }]}>{t('coachCredential.allowedTypesAndSize')}</Text>
            <Button title={t('coachCredential.chooseDocument')} onPress={pickCredential} disabled={uploading} loading={uploading} />
            {uploading ? (
              <View style={styles.status}>
                <View style={[styles.track, { backgroundColor: colors.muted }]}>
                  <View style={[styles.fill, { backgroundColor: colors.primary, width: `${progress}%` }]} />
                </View>
                <Text style={{ color: colors.mutedForeground }}>{t('coachCredential.uploading', { progress })}</Text>
              </View>
            ) : null}
            {progress === 100 && !error ? <Text style={{ color: colors.secondary }}>{t('coachCredential.complete')}</Text> : null}
            {error ? (
              <View style={styles.status}>
                <Text style={{ color: colors.destructive }}>{error}</Text>
                <Button title={t('coachCredential.retry')} variant="outline" onPress={() => file && uploadCredential(file)} disabled={!file} />
              </View>
            ) : null}
          </GlassCard>
          <GlassCard style={styles.card}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{t('coachCredential.previouslySubmitted')}</Text>
            {credentialsQuery.data?.length ? credentialsQuery.data.map(credential => (
              <View key={credential.id} style={[styles.credential, { borderBottomColor: colors.border }]}>
                <Text style={{ color: colors.foreground }}>{credential.originalName}</Text>
                <Text style={{ color: colors.mutedForeground }}>{credential.status}</Text>
              </View>
            )) : <Text style={{ color: colors.mutedForeground }}>{t('premium.paymentsNotConfigured')}</Text>}
          </GlassCard>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20, marginStart: 16 },
  loader: { marginTop: 32 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  retry: { marginTop: 16 },
  content: { padding: 20, gap: 16 },
  card: { padding: 18, gap: 10 },
  name: { fontFamily: 'Inter_700Bold', fontSize: 22 },
  metrics: { flexDirection: 'row', gap: 8 },
  metric: { flex: 1, padding: 12, alignItems: 'center' },
  metricValue: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  metricLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'center' },
  sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18 },
  description: { fontFamily: 'Inter_400Regular', fontSize: 14 },
  status: { gap: 8, marginTop: 8 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8 },
  credential: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
});
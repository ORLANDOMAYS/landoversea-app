import React, { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getAdminListReportsQueryKey,
  getAdminListVerificationsQueryKey,
  useAdminListReports,
  useAdminListVerifications,
  useAdminReviewReport,
  useAdminReviewVerification,
  useGetCurrentUser,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { useColors } from '@/hooks/useColors';
import { useI18n } from '@/i18n';
import { AuthenticatedProfileImage } from '@/components/AuthenticatedProfileImage';

export default function AdminScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, dir } = useI18n();
  const queryClient = useQueryClient();
  const userQuery = useGetCurrentUser();
  const isAdmin = userQuery.data?.role === 'admin';
  const reportParams = { status: 'pending' };
  const verificationParams = { status: 'pending' };
  const reports = useAdminListReports(reportParams, { query: { enabled: isAdmin, queryKey: getAdminListReportsQueryKey(reportParams) } });
  const verifications = useAdminListVerifications(verificationParams, { query: { enabled: isAdmin, queryKey: getAdminListVerificationsQueryKey(verificationParams) } });
  const reviewReport = useAdminReviewReport();
  const reviewVerification = useAdminReviewVerification();
  const [actionError, setActionError] = useState(false);

  const refresh = async () => {
    await Promise.all([reports.refetch(), verifications.refetch()]);
  };
  const decideVerification = async (requestId: number, status: 'approved' | 'rejected') => {
    setActionError(false);
    try {
      await reviewVerification.mutateAsync({ requestId, data: { status, adminNotes: null } });
      await queryClient.invalidateQueries({ queryKey: getAdminListVerificationsQueryKey(verificationParams) });
    } catch { setActionError(true); }
  };
  const decideReport = async (reportId: number, status: 'dismissed' | 'actioned', restrictUser: boolean) => {
    setActionError(false);
    try {
      await reviewReport.mutateAsync({ reportId, data: { status, restrictUser, adminNotes: null } });
      await queryClient.invalidateQueries({ queryKey: getAdminListReportsQueryKey(reportParams) });
    } catch { setActionError(true); }
  };

  if (userQuery.isLoading) return <View style={[styles.centered, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  if (userQuery.isError) return <View accessibilityRole="alert" style={[styles.centered, { backgroundColor: colors.background }]}><Text style={{ color: colors.destructive }}>{t('discover.loadErrorDesc')}</Text><Button title={t('common.retry')} onPress={() => userQuery.refetch()} /></View>;
  if (!isAdmin) return <View accessibilityRole="alert" style={[styles.centered, { backgroundColor: colors.background }]}><Ionicons name="lock-closed" size={42} color={colors.destructive} /><Text style={{ color: colors.foreground }}>{t('safety.title')}</Text><Button title={t('common.back')} onPress={() => router.back()} /></View>;

  const loading = reports.isLoading || verifications.isLoading;
  const loadError = reports.isError || verifications.isError;
  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { flexDirection: dir === 'rtl' ? 'row-reverse' : 'row' }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.backButton}><Ionicons name="chevron-back" size={28} color={colors.foreground} /></Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Admin</Text>
      </View>
      {loading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : loadError ? (
        <View accessibilityRole="alert" style={styles.centered}><Text style={{ color: colors.destructive }}>{t('discover.loadErrorDesc')}</Text><Button title={t('common.retry')} onPress={() => void refresh()} /></View>
      ) : (
        <ScrollView refreshControl={<RefreshControl refreshing={reports.isRefetching || verifications.isRefetching} onRefresh={() => void refresh()} />} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Verification queue</Text>
          {verifications.data?.map(item => <GlassCard key={item.id} style={styles.card}>{item.selfieUrl ? <AuthenticatedProfileImage url={item.selfieUrl} style={styles.verificationImage} accessibilityLabel={`User ${item.userId}`} /> : null}<Text style={{ color: colors.foreground }}>User #{item.userId}</Text><Text style={{ color: colors.mutedForeground }}>{item.status}</Text><View style={styles.controls}><Button testID={`approve-verification-${item.id}`} title="Approve" size="sm" onPress={() => void decideVerification(item.id, 'approved')} /><Button testID={`reject-verification-${item.id}`} title="Reject" size="sm" variant="outline" onPress={() => void decideVerification(item.id, 'rejected')} /></View></GlassCard>)}
          {!verifications.data?.length ? <Text style={{ color: colors.mutedForeground }}>{t('notifications.noNotifications')}</Text> : null}
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Reports</Text>
          {reports.data?.map(item => <GlassCard key={item.id} style={styles.card}><Text style={{ color: colors.foreground }}>{item.reason}</Text>{item.description ? <Text style={{ color: colors.mutedForeground }}>{item.description}</Text> : null}<View style={styles.controls}><Button testID={`dismiss-report-${item.id}`} title="Dismiss" size="sm" variant="outline" onPress={() => void decideReport(item.id, 'dismissed', false)} /><Button testID={`action-report-${item.id}`} title="Restrict user" size="sm" onPress={() => void decideReport(item.id, 'actioned', true)} /></View></GlassCard>)}
          {!reports.data?.length ? <Text style={{ color: colors.mutedForeground }}>{t('notifications.noNotifications')}</Text> : null}
          {actionError ? <View accessibilityRole="alert"><Text style={{ color: colors.destructive }}>{t('mobile.saveFailed')}</Text><Button title={t('common.retry')} variant="outline" onPress={() => void refresh()} /></View> : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  header: { alignItems: 'center', padding: 16 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 21, marginStart: 12 },
  loader: { marginTop: 32 },
  content: { padding: 18, gap: 12 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, marginTop: 10 },
  card: { padding: 16, gap: 10 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  verificationImage: { width: 120, height: 120, borderRadius: 12 },
});
import React from 'react';
import { View, StyleSheet, Text, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveMyProfile } from '@/lib/liveSupabase';
import { useAuth } from '@/lib/AuthProvider';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { performLogoutCleanup } from '@/lib/auth';
import { useRouter } from 'expo-router';
import { AuthenticatedProfileImage } from '@/components/AuthenticatedProfileImage';

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const router = useRouter();

  const { user, profile } = useAuth();
  const profileQuery = useLiveMyProfile();
  const photos = [...(profileQuery.data?.photos ?? [])].sort(
    (a, b) => a.position - b.position || String(a.id).localeCompare(String(b.id)),
  );
  const primaryPhoto = photos.find(photo => photo.isPrimary) ?? photos[0];

  const handleLogout = async () => {
    Alert.alert(t('auth.logout'), t('auth.logoutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('auth.logout'), style: 'destructive', onPress: async () => {
        await performLogoutCleanup(user?.id);
        router.replace('/(auth)/welcome' as any);
      }}
    ]);
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom + 84 }}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>{t('profile.title')}</Text>
      </View>

      <View style={styles.profileInfo}>
        {profileQuery.isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.avatarContainer} />
        ) : profileQuery.isError ? (
          <View style={styles.profileError} accessibilityRole="alert">
            <Text style={[styles.email, { color: colors.mutedForeground }]}>{t('discover.loadErrorDesc')}</Text>
            <Button title={t('common.retry')} variant="outline" onPress={() => profileQuery.refetch()} />
          </View>
        ) : (
          <View style={[styles.avatarContainer, { borderColor: colors.border }]}>
            <AuthenticatedProfileImage
              url={primaryPhoto?.url}
              style={styles.avatar}
              accessibilityLabel={t('editProfile.photoAlt', { number: 1 })}
            />
          </View>
        )}
        <Text style={[styles.name, { color: colors.foreground }]}>{profileQuery.data?.name ?? user?.user_metadata?.name}</Text>
        <Text style={[styles.email, { color: colors.mutedForeground }]}>{user?.email}</Text>
        <Button title={t('profile.editProfile')} variant="ghost" onPress={() => router.push('/profile/edit' as any)} />
      </View>

      <View style={styles.actions}>
        <Button
          variant="outline"
          leftIcon={<Ionicons name="settings-outline" size={20} color={colors.foreground} />}
          title={t('nav.settings')}
          onPress={() => router.push('/settings' as any)}
          style={styles.actionBtn}
        />
        <Button
          variant="outline"
          leftIcon={<Ionicons name="shield-outline" size={20} color={colors.foreground} />}
          title={t('nav.safety')}
          onPress={() => router.push('/safety' as any)}
          style={styles.actionBtn}
        />
        <Button
          variant="outline"
          leftIcon={<Ionicons name="star-outline" size={20} color={colors.foreground} />}
          title={t('premium.title')}
          onPress={() => router.push('/premium' as any)}
          style={styles.actionBtn}
        />
        <Button
          variant="outline"
          leftIcon={<Ionicons name="earth-outline" size={20} color={colors.foreground} />}
          title={t('mobile.culturePassport')}
          onPress={() => router.push('/culture' as any)}
          style={styles.actionBtn}
        />
        <Button
          variant="outline"
          leftIcon={<Ionicons name="school-outline" size={20} color={colors.foreground} />}
          title={t('mobile.learning')}
          onPress={() => router.push('/learning' as any)}
          style={styles.actionBtn}
        />
        <Button
          testID="coaching-entry"
          variant="outline"
          leftIcon={<Ionicons name="people-outline" size={20} color={colors.foreground} />}
          title={profile?.role === 'coach' ? t('coaching.dashboard') : t('coaching.apply')}
          onPress={() => router.push(profile?.role === 'coach' ? '/coaches/dashboard' as any : '/coaches/apply' as any)}
          style={styles.actionBtn}
        />
        {profile?.role === 'admin' ? (
          <Button
            testID="admin-entry"
            variant="outline"
            leftIcon={<Ionicons name="shield-checkmark-outline" size={20} color={colors.foreground} />}
            title="Admin"
            onPress={() => router.push('/admin' as any)}
            style={styles.actionBtn}
          />
        ) : null}
        <Button
          variant="ghost"
          leftIcon={<Ionicons name="log-out-outline" size={20} color={colors.destructive} />}
          title={t('auth.logout')}
          onPress={handleLogout}
          style={styles.logoutBtn}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 24, paddingVertical: 16 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 24 },
  profileInfo: { alignItems: 'center', paddingVertical: 32 },
  avatarContainer: { width: 120, height: 120, borderRadius: 60, borderWidth: 2, padding: 4, marginBottom: 16 },
  avatar: { width: '100%', height: '100%', borderRadius: 56 },
  profileError: { alignItems: 'center', gap: 12, paddingHorizontal: 24, marginBottom: 16 },
  name: { fontFamily: 'Inter_700Bold', fontSize: 24, marginBottom: 4 },
  email: { fontFamily: 'Inter_400Regular', fontSize: 15 },
  actions: { paddingHorizontal: 24, gap: 16 },
  actionBtn: { justifyContent: 'flex-start', paddingHorizontal: 24 },
  logoutBtn: { justifyContent: 'flex-start', paddingHorizontal: 24, marginTop: 16 }
});

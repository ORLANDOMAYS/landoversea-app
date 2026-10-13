import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Text, ScrollView, Pressable, Alert, ActivityIndicator, Switch } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n, LOCALE_META, Locale } from '@/i18n';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { performLogoutCleanup } from '@/lib/auth';
import { useLiveLocations } from '@/lib/liveSupabase';
import { useAuth } from '@/lib/AuthProvider';
import {
  useGetNotificationPreferences,
  useUpdateNotificationPreferences,
  type NotificationPreferences,
} from '@workspace/api-client-react';

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const { user, profile } = useAuth();
  const [locationCity, setLocationCity] = useState('');
  const [locationCountry, setLocationCountry] = useState('');
  const locations = useLiveLocations();
  const preferencesQuery = useGetNotificationPreferences();
  const updatePreferences = useUpdateNotificationPreferences();
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [failedPreferences, setFailedPreferences] = useState<NotificationPreferences | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    if (preferencesQuery.data && !dirty.current) setPreferences(preferencesQuery.data);
  }, [preferencesQuery.data]);

  const savePreferences = async (next: NotificationPreferences) => {
    const previous = preferences;
    dirty.current = true;
    setPreferences(next);
    setFailedPreferences(null);
    try {
      const saved = await updatePreferences.mutateAsync({ data: next });
      setPreferences(saved);
      dirty.current = false;
      await preferencesQuery.refetch();
    } catch {
      setPreferences(previous);
      setFailedPreferences(next);
      dirty.current = false;
      Alert.alert(t('premium.genericError'), t('mobile.saveFailed'));
    }
  };

  const togglePreference = (key: 'pushEnabled' | 'emailEnabled' | 'bookingEnabled' | 'readReceipts') => {
    if (!preferences || updatePreferences.isPending) return;
    void savePreferences({ ...preferences, [key]: !preferences[key] });
  };

  const handleLogout = () => {
    Alert.alert(t('auth.logout'), t('auth.logoutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('auth.logout'), style: 'destructive', onPress: async () => {
        await performLogoutCleanup(user?.id);
        router.replace('/(auth)/welcome' as any);
      }}
    ]);
  };

  const addLocation = async () => {
    if (!locationCity.trim() || !locationCountry.trim()) return;
    try {
      await locations.add.mutateAsync({ city: locationCity, country: locationCountry });
      setLocationCity('');
      setLocationCountry('');
    } catch (error) {
      Alert.alert(t('premium.genericError'), error instanceof Error ? error.message : t('mobile.saveFailed'));
    }
  };

  const removeLocation = async (id: string) => {
    try {
      await locations.remove.mutateAsync(id);
    } catch (error) {
      Alert.alert(t('premium.genericError'), error instanceof Error ? error.message : t('mobile.saveFailed'));
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>{t('nav.settings')}</Text>
      </View>
      <ScrollView style={styles.content} contentContainerStyle={{ padding: 24, paddingBottom: 100 }}>
        
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{t('language.label')}</Text>
        <View style={styles.langGrid}>
          {Object.keys(LOCALE_META).map(key => (
            <Pressable 
              key={key} 
              style={[styles.langBtn, { borderColor: locale === key ? colors.primary : colors.border, backgroundColor: locale === key ? colors.primary : 'transparent' }]}
              onPress={() => setLocale(key as Locale)}
            >
              <Text style={[styles.langText, { color: locale === key ? colors.primaryForeground : colors.foreground }]}>
                {LOCALE_META[key as Locale].label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{t('onboarding.locationTitle')}</Text>
        {locations.query.isLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : locations.query.isError ? (
          <View accessibilityRole="alert" style={styles.preferenceError}>
            <Text style={{ color: colors.mutedForeground }}>{t('discover.loadErrorDesc')}</Text>
            <Button title={t('common.retry')} variant="outline" onPress={() => locations.query.refetch()} />
          </View>
        ) : (
          <>
            {locations.query.data?.map(location => (
              <View key={location.id} style={[styles.locationRow, { borderColor: colors.border }]}>
                <Text style={[styles.locationText, { color: colors.foreground }]}>
                  {location.city}, {location.country}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('common.delete')}
                  onPress={() => void removeLocation(location.id)}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.destructive} />
                </Pressable>
              </View>
            ))}
            {(locations.query.data?.length ?? 0) < 3 ? (
              <View style={styles.locationForm}>
                <Input placeholder={t('onboarding.cityLabel')} value={locationCity} onChangeText={setLocationCity} />
                <Input placeholder={t('onboarding.country')} value={locationCountry} onChangeText={setLocationCountry} />
                <Button
                  title={t('common.save')}
                  onPress={() => void addLocation()}
                  loading={locations.add.isPending}
                  disabled={!locationCity.trim() || !locationCountry.trim()}
                />
              </View>
            ) : null}
          </>
        )}

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{t('settings.preferences')}</Text>
        {preferencesQuery.isLoading && !preferences ? (
          <ActivityIndicator color={colors.primary} />
        ) : preferencesQuery.isError && !preferences ? (
          <View accessibilityRole="alert" style={styles.preferenceError}>
            <Text style={{ color: colors.mutedForeground }}>{t('discover.loadErrorDesc')}</Text>
            <Button title={t('common.retry')} variant="outline" onPress={() => preferencesQuery.refetch()} />
          </View>
        ) : preferences ? (
          ([
            ['pushEnabled', t('settings.pushNotifications')],
            ['emailEnabled', t('settings.emailNotifications')],
            ['bookingEnabled', `${t('nav.coaching')} · ${t('nav.notifications')}`],
            ['readReceipts', t('settings.readReceipts')],
          ] as const).map(([key, label]) => (
            <View key={key} style={[styles.preferenceRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.preferenceLabel, { color: colors.foreground }]}>{label}</Text>
              <Switch
                accessibilityLabel={label}
                value={preferences[key]}
                disabled={updatePreferences.isPending}
                onValueChange={() => togglePreference(key)}
                trackColor={{ false: colors.muted, true: colors.primary }}
              />
            </View>
          ))
        ) : null}
        {failedPreferences && (
          <View accessibilityRole="alert" style={styles.preferenceError}>
            <Text style={{ color: colors.destructive }}>{t('mobile.saveFailed')}</Text>
            <Button
              title={t('common.retry')}
              variant="outline"
              loading={updatePreferences.isPending}
              onPress={() => void savePreferences(failedPreferences)}
            />
          </View>
        )}

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <Button
          variant="ghost"
          style={styles.navRow}
          onPress={() => router.push('/notifications' as any)}
          leftIcon={<Ionicons name="notifications-outline" size={24} color={colors.foreground} />}
          title={t('nav.notifications')}
        />

        <Button
          testID="settings-coaching-entry"
          variant="ghost"
          style={styles.navRow}
          onPress={() => router.push(profile?.role === 'coach' ? '/coaches/dashboard' as any : '/coaches/apply' as any)}
          leftIcon={<Ionicons name="people-outline" size={24} color={colors.foreground} />}
          title={profile?.role === 'coach' ? t('coaching.dashboard') : t('coaching.apply')}
        />

        {profile?.role === 'admin' ? (
          <Button
            testID="settings-admin-entry"
            variant="ghost"
            style={styles.navRow}
            onPress={() => router.push('/admin' as any)}
            leftIcon={<Ionicons name="shield-checkmark-outline" size={24} color={colors.foreground} />}
            title="Admin"
          />
        ) : null}

        <Button
          variant="ghost"
          style={styles.navRow}
          onPress={() => router.push('/privacy' as any)}
          leftIcon={<Ionicons name="shield-checkmark-outline" size={24} color={colors.foreground} />}
          title={t('auth.privacyLink')}
        />

        <Button
          variant="ghost"
          style={styles.navRow}
          onPress={() => router.push('/terms' as any)}
          leftIcon={<Ionicons name="document-text-outline" size={24} color={colors.foreground} />}
          title={t('auth.termsLink')}
        />

        <Button
          variant="ghost"
          style={styles.navRow}
          onPress={() => router.push('/safety' as any)}
          leftIcon={<Ionicons name="help-buoy-outline" size={24} color={colors.foreground} />}
          title={t('mobile.support')}
        />

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <Button
          variant="ghost"
          style={styles.navRow}
          onPress={handleLogout}
          leftIcon={<Ionicons name="log-out-outline" size={24} color={colors.destructive} />}
          title={t('auth.logout')}
        />

        <Button
          variant="ghost"
          style={styles.navRow}
          onPress={() => router.push('/delete-account' as any)}
          leftIcon={<Ionicons name="warning-outline" size={24} color={colors.destructive} />}
          title={t('profile.deleteAccount')}
        />

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20, marginLeft: 16 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1 },
  sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18, marginBottom: 16 },
  langGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  langBtn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  langText: { fontFamily: 'Inter_500Medium', fontSize: 15 },
  divider: { height: 1, width: '100%', marginVertical: 24 },
  navRow: { justifyContent: 'flex-start', paddingHorizontal: 0 },
  preferenceRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 },
  preferenceLabel: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 15 },
  preferenceError: { gap: 12, alignItems: 'center', paddingVertical: 12 },
  locationRow: { minHeight: 52, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  locationText: { fontFamily: 'Inter_500Medium', fontSize: 15 },
  locationForm: { gap: 10, marginTop: 14 },
});

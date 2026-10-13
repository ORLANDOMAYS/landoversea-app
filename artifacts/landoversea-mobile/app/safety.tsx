import React from 'react';
import { View, StyleSheet, Text, FlatList, ActivityIndicator, Alert, Pressable } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/i18n';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { useGetBlockedUsers, useUnblockUser } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { AuthenticatedProfileImage } from '@/components/AuthenticatedProfileImage';

export default function SafetyScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: blockedUsers, isLoading } = useGetBlockedUsers();
  const unblockUser = useUnblockUser();

  const handleUnblock = (id: number, name: string) => {
    Alert.alert(t('safety.unblockUser'), t('mobile.unblockConfirm', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      { 
        text: t('safety.unblock'),
        onPress: async () => {
          try {
            await unblockUser.mutateAsync({ blockedUserId: id });
            queryClient.invalidateQueries({ queryKey: ['getBlockedUsers'] });
          } catch (e) {
            Alert.alert(t('premium.genericError'), t('safety.unblockFailed'));
          }
        }
      }
    ]);
  };

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
        <Text style={[styles.title, { color: colors.foreground }]}>{t('nav.safety')}</Text>
      </View>
      
      <View style={styles.content}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{t('safety.blockedUsers')}</Text>
        
        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : blockedUsers?.length ? (
          <FlatList
            data={blockedUsers}
            keyExtractor={item => item.id.toString()}
            contentContainerStyle={{ paddingBottom: 24 }}
            renderItem={({ item }) => (
              <GlassCard style={styles.userCard}>
                <AuthenticatedProfileImage
                  url={item.blockedUser?.photos?.[0]?.url}
                  style={styles.avatar}
                  accessibilityLabel={item.blockedUser?.name ?? t('safety.unknownUser')}
                />
                <View style={styles.userInfo}>
                  <Text style={[styles.userName, { color: colors.foreground }]}>{item.blockedUser?.name ?? t('safety.unknownUser')}</Text>
                  <Text style={[styles.dateText, { color: colors.mutedForeground }]}>
                    {t('mobile.blockedOn', { date: new Date(item.createdAt).toLocaleDateString() })}
                  </Text>
                </View>
                <Button 
                  title={t('safety.unblock')}
                  variant="outline"
                  size="sm"
                  onPress={() => handleUnblock(item.blockedUserId, item.blockedUser?.name ?? t('safety.unknownUser'))}
                  loading={unblockUser.isPending}
                />
              </GlassCard>
            )}
          />
        ) : (
          <View style={styles.empty}>
            <Ionicons name="shield-checkmark-outline" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{t('safety.noBlockedUsers')}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20, marginLeft: 16 },
  content: { flex: 1, paddingHorizontal: 24 },
  sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18, marginBottom: 16, marginTop: 8 },
  userCard: { flexDirection: 'row', alignItems: 'center', padding: 16, marginBottom: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, marginRight: 16 },
  userInfo: { flex: 1 },
  userName: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  dateText: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 100 },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 16, marginTop: 16 }
});

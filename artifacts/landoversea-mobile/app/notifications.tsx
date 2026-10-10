import React, { useRef, useState } from 'react';
import { View, StyleSheet, Text, FlatList, ActivityIndicator, Pressable, RefreshControl } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/i18n';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { getGetNotificationsQueryKey, useGetNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { resolveInternalRoute } from '@/lib/internalRoutes';

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();

  const notificationsQuery = useGetNotifications(undefined, {
    query: { queryKey: getGetNotificationsQueryKey(), refetchInterval: 30_000, staleTime: 10_000 },
  });
  const { data: notifications, isLoading, isError, isRefetching } = notificationsQuery;
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const markingIds = useRef(new Set<number>());
  const [actionError, setActionError] = useState(false);

  const handleMarkAllRead = async () => {
    setActionError(false);
    try {
      await markAllRead.mutateAsync();
      await Promise.all([
        notificationsQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ['getUnreadCounts'] }),
      ]);
    } catch {
      setActionError(true);
    }
  };

  const handlePress = async (id: number, isRead: boolean, type: string, referenceId?: number) => {
    if (!isRead && !markingIds.current.has(id)) {
      markingIds.current.add(id);
      setActionError(false);
      try {
        await markRead.mutateAsync({ notificationId: id });
        await Promise.all([
          notificationsQuery.refetch(),
          queryClient.invalidateQueries({ queryKey: ['getUnreadCounts'] }),
        ]);
      } catch {
        setActionError(true);
      } finally {
        markingIds.current.delete(id);
      }
    }
    router.push(resolveInternalRoute(undefined, { type, relatedId: referenceId }) as never);
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
        <Text style={[styles.title, { color: colors.foreground }]}>{t('nav.notifications')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('notifications.markAll')}
          hitSlop={4}
          onPress={handleMarkAllRead}
          disabled={markAllRead.isPending}
          style={[styles.headerButton, styles.markAllButton]}
        >
          <Ionicons name="checkmark-done-outline" size={24} color={colors.primary} />
        </Pressable>
      </View>
      
      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      ) : isError ? (
        <View accessibilityRole="alert" style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>{t('discover.loadErrorDesc')}</Text>
          <Button title={t('common.retry')} onPress={() => void notificationsQuery.refetch()} />
        </View>
      ) : (
        <FlatList
          data={notifications || []}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void notificationsQuery.refetch()} tintColor={colors.primary} colors={[colors.primary]} />}
          ListHeaderComponent={actionError ? (
            <View accessibilityRole="alert" style={styles.actionError}>
              <Text style={{ color: colors.destructive }}>{t('mobile.saveFailed')}</Text>
              <Button title={t('common.retry')} size="sm" variant="outline" onPress={() => void notificationsQuery.refetch()} />
            </View>
          ) : null}
          renderItem={({ item }) => (
            <Pressable 
              style={[styles.item, { borderBottomColor: colors.border, backgroundColor: item.isRead ? 'transparent' : colors.glassStrong }]}
              onPress={() => handlePress(item.id, item.isRead, item.type, item.relatedId || undefined)}
            >
              <View style={styles.iconContainer}>
                <Ionicons 
                  name={item.type === 'message' ? 'chatbubble' : item.type === 'match' ? 'heart' : 'notifications'} 
                  size={24} 
                  color={item.isRead ? colors.mutedForeground : colors.primary} 
                />
              </View>
              <View style={styles.itemContent}>
                <Text style={[styles.itemTitle, { color: item.isRead ? colors.mutedForeground : colors.foreground }]}>{item.title}</Text>
                <Text style={[styles.itemBody, { color: colors.mutedForeground }]} numberOfLines={2}>{item.body}</Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="notifications-off-outline" size={48} color={colors.mutedForeground} />
              <Text style={{ color: colors.mutedForeground, marginTop: 16 }}>{t('notifications.noNotifications')}</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  markAllButton: { marginLeft: 'auto' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20, marginLeft: 16 },
  item: { flexDirection: 'row', padding: 16, borderBottomWidth: 1, borderRadius: 12, marginBottom: 8 },
  iconContainer: { marginRight: 16, justifyContent: 'center' },
  itemContent: { flex: 1 },
  itemTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 16, marginBottom: 4 },
  itemBody: { fontFamily: 'Inter_400Regular', fontSize: 14 },
  empty: { padding: 48, alignItems: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontFamily: 'Inter_400Regular', fontSize: 15, textAlign: 'center', marginVertical: 16 },
  actionError: { gap: 8, alignItems: 'center', paddingBottom: 12 },
});

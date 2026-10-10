import React from 'react';
import { View, StyleSheet, Text, FlatList, ActivityIndicator, Pressable, RefreshControl } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveMatches } from '@/lib/liveSupabase';
import { Ionicons } from '@expo/vector-icons';
import { AuthenticatedProfileImage } from '@/components/AuthenticatedProfileImage';
import { useI18n } from '@/i18n';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';

export default function MessagesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const router = useRouter();

  const conversationsQuery = useLiveMatches();
  const { data: conversations, isLoading, isError, isRefetching } = conversationsQuery;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>{t('messages.title')}</Text>
      </View>

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.primary} /></View>
      ) : isError ? (
        <View accessibilityRole="alert" style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>{t('discover.loadErrorDesc')}</Text>
          <Button title={t('common.retry')} onPress={() => void conversationsQuery.refetch()} />
        </View>
      ) : conversations?.length ? (
        <FlatList
          data={conversations}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 84 }]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void conversationsQuery.refetch()} tintColor={colors.primary} colors={[colors.primary]} />}
          renderItem={({ item }) => {
            const isGroup = item.type === 'group';
            const otherUser = item.participants?.[0];
            const groupTitle = item.title || t('conversation.groupChat');

            return (
              <Pressable onPress={() => router.push(`/messages/${item.id}` as any)}>
                <View style={[styles.convCard, { borderBottomColor: colors.border }]}>
                  {isGroup ? (
                    <View style={[styles.avatar, styles.groupAvatar, { backgroundColor: colors.primary }]}>
                      <Ionicons name="people" size={28} color={colors.primaryForeground} />
                    </View>
                  ) : (
                    <AuthenticatedProfileImage
                      url={otherUser?.photos?.[0]?.url}
                      style={styles.avatar}
                      accessibilityLabel={otherUser?.name ?? t('mobile.unknownUser')}
                    />
                  )}
                  <View style={styles.convInfo}>
                    <View style={styles.convHeader}>
                      <Text style={[styles.convName, { color: colors.foreground }]} numberOfLines={1}>
                        {isGroup ? groupTitle : (otherUser?.name ?? t('mobile.unknownUser'))}
                      </Text>
                      {item.lastMessage && (
                        <Text style={[styles.convTime, { color: colors.mutedForeground }]}>
                          {new Date(item.lastMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      )}
                    </View>
                    <View style={styles.convPreview}>
                      <Text
                        style={[
                          styles.lastMessage,
                          { color: item.unreadCount ? colors.foreground : colors.mutedForeground },
                          item.unreadCount ? { fontFamily: 'Inter_600SemiBold' } : {}
                        ]}
                        numberOfLines={1}
                      >
                        {item.lastMessage?.content || t('messages.sentAttachment')}
                      </Text>
                      {!!item.unreadCount && item.unreadCount > 0 && (
                        <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}>
                          <Text style={[styles.unreadText, { color: colors.primaryForeground }]}>{item.unreadCount}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      ) : (
        <View style={styles.empty}>
          <Ionicons name="chatbubbles-outline" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{t('messages.noConversations')}</Text>
          <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>{t('messages.noConversationsDesc')}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 24, paddingVertical: 16 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 24 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontFamily: 'Inter_400Regular', fontSize: 15, textAlign: 'center', marginVertical: 16, paddingHorizontal: 24 },
  list: { paddingHorizontal: 16 },
  convCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  avatar: { width: 56, height: 56, borderRadius: 28, marginRight: 16 },
  groupAvatar: { alignItems: 'center', justifyContent: 'center' },
  convInfo: { flex: 1, justifyContent: 'center' },
  convHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  convName: { fontFamily: 'Inter_600SemiBold', fontSize: 16, flex: 1, marginRight: 8 },
  convTime: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  convPreview: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lastMessage: { fontFamily: 'Inter_400Regular', fontSize: 14, flex: 1, marginRight: 8 },
  unreadBadge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unreadText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18, marginTop: 16 },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center', marginTop: 8 }
});

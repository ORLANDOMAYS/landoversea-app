import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Text, FlatList, ActivityIndicator, Pressable, RefreshControl, Modal, ScrollView } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isSupabaseUuid, sendLiveMessage, subscribeLiveMessages, useLiveConversation } from '@/lib/liveSupabase';
import { useAuth } from '@/lib/AuthProvider';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '@/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Input } from '@/components/ui/Input';
import { useQueryClient } from '@tanstack/react-query';
import { AuthenticatedProfileImage } from '@/components/AuthenticatedProfileImage';
import { Button } from '@/components/ui/Button';
import { LOCALES } from '@/i18n/types';
import { translateText, type TextTranslation } from '@/lib/safeApi';

type OptimisticMessage = {
  id: string; // clientRequestId
  content: string;
  senderId: string;
  attachmentUrl?: string;
  createdAt: string;
  status: 'sending' | 'failed' | 'sent';
  clientRequestId: string;
};

const RTL_LANGS = ['ar'];
const getDir = (lang?: string | null) => lang && RTL_LANGS.includes(lang) ? 'rtl' : 'ltr';

function createClientRequestId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

export default function ConversationScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, dir: appDir, locale } = useI18n();
  const { conversationId } = useLocalSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();

  const matchId = Array.isArray(conversationId) ? conversationId[0] : conversationId;
  const validId = isSupabaseUuid(matchId);

  const { user } = useAuth();
  const myUserId = user?.id ?? '';

  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [allMessages, setAllMessages] = useState<any[]>([]);

  const live = useLiveConversation(matchId ?? '', validId);
  const conversationQuery = {
    ...live.matches,
    data: live.conversation as any,
    isLoading: live.matches.isLoading,
    isError: live.matches.isError,
    isRefetching: live.matches.isRefetching,
    refetch: live.matches.refetch,
  };
  const messagesQuery = live.messages;
  const conversation = live.conversation as any;
  const { data: messages, isLoading } = messagesQuery;
  const [text, setText] = useState('');
  const [pendingMessages, setPendingMessages] = useState<OptimisticMessage[]>([]);
  const [targetLanguage, setTargetLanguage] = useState<string>(locale);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [draftTranslation, setDraftTranslation] = useState<TextTranslation | null>(null);
  const [draftTranslationError, setDraftTranslationError] = useState<string | null>(null);
  const [translatingDraft, setTranslatingDraft] = useState(false);
  const [messageTranslations, setMessageTranslations] = useState<Record<string, TextTranslation>>({});
  const [messageTranslationErrors, setMessageTranslationErrors] = useState<Record<string, string>>({});
  const [translatingMessageIds, setTranslatingMessageIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!validId || !matchId) return;
    const channel = subscribeLiveMessages(matchId, message => {
      setAllMessages(previous => {
        const byId = new Map(previous.map(item => [String(item.id), item]));
        byId.set(String(message.id), message);
        return Array.from(byId.values()).sort((a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      });
    }, () => {
      void messagesQuery.refetch();
    });
    return () => {
      void channel.unsubscribe();
    };
  }, [matchId, validId]);

  useEffect(() => {
    if (messages && messages.length > 0) {
      setAllMessages(prev => {
        const combined = [...prev, ...messages];
        const byId = new Map<string, any>();
        for (const m of combined) byId.set(String(m.id), m);
        return Array.from(byId.values()).sort((a, b) => {
          const byDate = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          return byDate !== 0 ? byDate : String(a.id).localeCompare(String(b.id));
        });
      });
      if (cursor !== undefined) setCursor(undefined);
    }
  }, [cursor, messages]);

  const executeSend = async (content: string, retryId?: string) => {
    const clientRequestId = retryId || createClientRequestId();

    if (pendingMessages.some(m => m.clientRequestId === clientRequestId && m.status === 'sending')) {
      return;
    }

    if (!retryId) {
      setPendingMessages(prev => [{
        id: clientRequestId,
        content,
        senderId: myUserId,
        createdAt: new Date().toISOString(),
        status: 'sending',
        clientRequestId,
      }, ...prev]);
    } else {
      setPendingMessages(prev => prev.map(m => m.id === retryId ? { ...m, status: 'sending' } : m));
    }

    try {
      const newMsg = await sendLiveMessage(matchId!, myUserId, content, appDir === 'rtl' ? 'ar' : 'en');

      setPendingMessages(prev => prev.filter(m => m.clientRequestId !== clientRequestId));

      setAllMessages(prev => {
        const byId = new Map<string, any>();
        for (const m of prev) byId.set(String(m.id), m);
        byId.set(String(newMsg.id), newMsg);
        return Array.from(byId.values()).sort((a, b) => {
          const byDate = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          return byDate !== 0 ? byDate : String(a.id).localeCompare(String(b.id));
        });
      });
      queryClient.invalidateQueries({ queryKey: ['supabase', 'messages', matchId] });
      queryClient.invalidateQueries({ queryKey: ['supabase', 'matches'] });
    } catch (e) {
      setPendingMessages(prev => prev.map(m => m.clientRequestId === clientRequestId ? { ...m, status: 'failed' } : m));
    }
  };

  const handleSend = () => {
    if (!text.trim()) return;
    const content = text;
    setText('');
    executeSend(content);
  };

  const handleRetry = (msg: OptimisticMessage) => {
    executeSend(msg.content, msg.clientRequestId);
  };

  const handleDiscard = (msg: OptimisticMessage) => {
    setPendingMessages(prev => prev.filter(m => m.clientRequestId !== msg.clientRequestId));
  };

  const previewDraftTranslation = async () => {
    if (!text.trim() || translatingDraft) return;
    setTranslatingDraft(true);
    setDraftTranslationError(null);
    try {
      setDraftTranslation(await translateText(text.trim(), targetLanguage));
    } catch (error) {
      setDraftTranslation(null);
      setDraftTranslationError(error instanceof Error ? error.message : t('conversation.previewUnavailable'));
    } finally {
      setTranslatingDraft(false);
    }
  };

  const translateMessage = async (msg: any) => {
    const messageId = String(msg.id);
    if (!msg.content || translatingMessageIds.has(messageId)) return;
    setTranslatingMessageIds(previous => new Set(previous).add(messageId));
    setMessageTranslationErrors(previous => {
      const next = { ...previous };
      delete next[messageId];
      return next;
    });
    try {
      const translated = await translateText(msg.content, targetLanguage);
      setMessageTranslations(previous => ({ ...previous, [messageId]: translated }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('conversation.translationFailed');
      setMessageTranslationErrors(previous => ({ ...previous, [messageId]: message }));
    } finally {
      setTranslatingMessageIds(previous => {
        const next = new Set(previous);
        next.delete(messageId);
        return next;
      });
    }
  };

  const handleLoadEarlier = () => {
    if (allMessages.length === 0) return;
    const oldest = allMessages.reduce((min, curr) =>
      new Date(curr.createdAt).getTime() < new Date(min.createdAt).getTime() ? curr : min
    , allMessages[0]);

    if (oldest) {
      const iso = new Date(oldest.createdAt).toISOString();
      setCursor(`${iso}|${oldest.id}`);
    }
  };

  const isGroup = conversation?.type === 'group';
  const otherUser = conversation?.participants?.[0];
  const groupTitle = conversation?.title || t('conversation.groupChat');
  const groupCount = conversation?.participants?.length || 0;

  const deliveredRequestIds = new Set((allMessages || []).map(m => m.clientRequestId).filter(Boolean));
  const combinedMessages = [
    ...(allMessages || []),
    ...pendingMessages.filter(m => !deliveredRequestIds.has(m.clientRequestId)),
  ];

  const refreshing = conversationQuery.isRefetching || messagesQuery.isRefetching;
  const refreshConversation = () => {
    void Promise.all([conversationQuery.refetch(), messagesQuery.refetch()]);
  };

  const renderMessage = ({ item }: { item: any }) => {
    const msg = item;
    const isMine = msg.senderId === myUserId;

    return (
      <MessageBubbleWrapper
        msg={msg}
        isMine={isMine}
        colors={colors}
        t={t}
        translation={messageTranslations[String(msg.id)]}
        translationError={messageTranslationErrors[String(msg.id)]}
        translating={translatingMessageIds.has(String(msg.id))}
        onTranslate={() => void translateMessage(msg)}
        handleRetry={() => handleRetry(msg)}
        handleDiscard={() => handleDiscard(msg)}
      />
    );
  };

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: colors.background }]} behavior="padding" keyboardVerticalOffset={0}>
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: colors.border, backgroundColor: colors.backgroundElevated }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={4}
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={28} color={colors.foreground} />
        </Pressable>

        {isGroup ? (
          <View style={[styles.headerAvatar, styles.noAvatar, { backgroundColor: colors.primary }]}>
            <Ionicons name="people" size={20} color={colors.primaryForeground} />
          </View>
        ) : otherUser?.photos?.[0]?.url ? (
          <AuthenticatedProfileImage
            url={otherUser.photos[0].url}
            style={styles.headerAvatar}
            accessibilityLabel={otherUser.name ?? t('mobile.unknownUser')}
          />
        ) : (
          <View style={[styles.headerAvatar, styles.noAvatar, { backgroundColor: colors.muted }]}>
            <Ionicons name="person" size={20} color={colors.mutedForeground} />
          </View>
        )}

        <View style={styles.headerInfo}>
          <Text style={[styles.headerName, { color: colors.foreground }]} numberOfLines={1}>
            {isGroup ? groupTitle : (otherUser?.name ?? t('mobile.unknownUser'))}
          </Text>
          {isGroup && (
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
              {t('conversation.membersCount', { count: groupCount })}
            </Text>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('conversation.targetLanguage')}
          onPress={() => setShowLangMenu(true)}
          style={styles.langBtn}
        >
          <Ionicons name="language" size={18} color={colors.primary} />
          <Text style={[styles.langText, { color: colors.foreground }]}>{targetLanguage}</Text>
        </Pressable>
      </View>

      {!validId || conversationQuery.isError || messagesQuery.isError ? (
        <View accessibilityRole="alert" style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
            {!validId ? t('conversation.notFound') : t('discover.loadErrorDesc')}
          </Text>
          {validId ? <Button title={t('common.retry')} onPress={refreshConversation} /> : null}
        </View>
      ) : isLoading || conversationQuery.isLoading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList
          data={combinedMessages.slice().reverse()}
          inverted
          keyExtractor={item => (item as any).clientRequestId || item.id.toString()}
          contentContainerStyle={styles.list}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshConversation} tintColor={colors.primary} colors={[colors.primary]} />}
          ListFooterComponent={
            allMessages.length > 0 && messages?.length === 50 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('conversation.loadEarlier')}
                style={styles.loadEarlierBtn}
                onPress={handleLoadEarlier}
              >
                <Text style={[styles.loadEarlierText, { color: colors.primary }]}>{t('conversation.loadEarlier')}</Text>
              </Pressable>
            ) : null
          }
          renderItem={renderMessage}
        />
      )}

      {draftTranslation ? (
        <View style={[styles.draftPreview, { borderColor: colors.border }]}>
          <Text style={[styles.draftLabel, { color: colors.mutedForeground }]}>{t('conversation.previewTranslated')}</Text>
          <Text style={[styles.draftText, { color: colors.foreground, writingDirection: getDir(targetLanguage) }]}>
            {draftTranslation.translatedContent}
          </Text>
        </View>
      ) : draftTranslationError ? (
        <Text accessibilityRole="alert" style={[styles.unsupportedNotice, { color: colors.destructive }]}>{draftTranslationError}</Text>
      ) : null}
      <Text accessibilityRole="alert" style={[styles.unsupportedNotice, { color: colors.mutedForeground }]}>
        Attachments, reactions, read receipts, and saved conversation translation preferences are unavailable in native chat. On-demand translation remains available.
      </Text>
      <View style={[styles.inputArea, { paddingBottom: insets.bottom + 12, borderTopColor: colors.border, backgroundColor: colors.backgroundElevated }]}>
        <Input
          placeholder={t('messages.typeMessage')}
          value={text}
          onChangeText={(value) => {
            setText(value);
            setDraftTranslation(null);
            setDraftTranslationError(null);
          }}
          style={styles.input}
          multiline
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('conversation.draftPreview')}
          style={styles.previewBtn}
          onPress={() => void previewDraftTranslation()}
          disabled={!text.trim() || translatingDraft}
        >
          {translatingDraft
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Ionicons name="language" size={20} color={colors.primary} />}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('messages.send')} style={[styles.sendBtn, { backgroundColor: colors.primary }]} onPress={handleSend} disabled={!text.trim()}>
          <Ionicons name="send" size={18} color={colors.primaryForeground} />
        </Pressable>
      </View>

      <Modal visible={showLangMenu} transparent animationType="slide" onRequestClose={() => setShowLangMenu(false)}>
        <Pressable style={[styles.modalOverlay, { backgroundColor: colors.overlay }]} onPress={() => setShowLangMenu(false)}>
          <View style={[styles.modalContent, { backgroundColor: colors.backgroundElevated, paddingBottom: insets.bottom }]}>
            <ScrollView>
              {LOCALES.map(language => (
                <Pressable
                  key={language}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: targetLanguage === language }}
                  style={[styles.langOption, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setTargetLanguage(language);
                    setDraftTranslation(null);
                    setShowLangMenu(false);
                  }}
                >
                  <Text style={[styles.langOptionText, { color: colors.foreground }]}>{language}</Text>
                  {targetLanguage === language ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const MessageBubbleWrapper = React.memo(({ msg, isMine, colors, t, translation, translationError, translating, onTranslate, handleRetry, handleDiscard }: any) => {
  const originalDir = getDir(msg.detectedLanguage || 'en');

  return (
    <View style={[styles.messageRow, isMine ? styles.messageMine : styles.messageTheirs]}>
      <Pressable
        style={[
        styles.messageBubble,
        { backgroundColor: isMine ? colors.primary : colors.glassStrong },
        msg.status === 'failed' && { backgroundColor: colors.destructive }
      ]}>
        {!!msg.content && (
          <View style={styles.textContent}>
            <Text style={[styles.messageText, { color: isMine ? colors.primaryForeground : colors.foreground, writingDirection: originalDir }]}>
              {msg.content}
            </Text>
            {translation ? (
              <>
                <View style={[styles.divider, { backgroundColor: isMine ? 'rgba(255,255,255,0.2)' : colors.border }]} />
                <Text style={[styles.messageText, { color: isMine ? colors.primaryForeground : colors.foreground, writingDirection: getDir(translation.targetLanguage) }]}>
                  {translation.translatedContent}
                </Text>
              </>
            ) : null}
            {translationError ? (
              <Text accessibilityRole="alert" style={[styles.messageText, { color: colors.destructive }]}>
                {translationError}
              </Text>
            ) : null}
            <Pressable accessibilityRole="button" onPress={onTranslate} disabled={translating}>
              <Text style={[styles.retryText, { color: isMine ? colors.primaryForeground : colors.primary }]}>
                {translating ? t('conversation.translating') : t('conversation.translated')}
              </Text>
            </Pressable>
          </View>
        )}

        {msg.createdAt && (
          <View style={[styles.bubbleFooter, isMine ? styles.bubbleFooterMine : styles.bubbleFooterTheirs]}>
            <Text style={[styles.timeText, { color: isMine ? 'rgba(255,255,255,0.7)' : colors.mutedForeground }]}>
              {msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
            </Text>
          </View>
        )}
      </Pressable>

      {msg.status === 'failed' && (
        <View style={styles.failedActions}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('conversation.retrySend')} onPress={handleRetry}>
            <Text style={{color: colors.primary, marginRight: 8, fontSize: 12}}>{t('conversation.retrySend')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t('conversation.discardSend')} onPress={handleDiscard}>
            <Text style={{color: colors.destructive, fontSize: 12}}>{t('conversation.discardSend')}</Text>
          </Pressable>
        </View>
      )}
      {msg.status === 'sending' && (
        <Text style={{color: colors.mutedForeground, fontSize: 12, marginTop: 4, alignSelf: 'flex-end'}}>{t('conversation.sending')}</Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, marginRight: 12 },
  noAvatar: { alignItems: 'center', justifyContent: 'center' },
  headerInfo: { flex: 1 },
  headerName: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  headerSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  translationControls: { flexDirection: 'row', alignItems: 'center' },
  toggleBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginRight: 4, borderWidth: 1, borderColor: 'transparent' },
  langBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: 'transparent' },
  langText: { fontFamily: 'Inter_500Medium', fontSize: 13, marginRight: 4 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontFamily: 'Inter_400Regular', fontSize: 15, textAlign: 'center', marginVertical: 16, paddingHorizontal: 24 },
  unsupportedNotice: { fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  list: { padding: 16 },
  loadEarlierBtn: { paddingVertical: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  loadEarlierText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  messageRow: { marginBottom: 12, flexDirection: 'column', alignItems: 'flex-start' },
  messageMine: { alignItems: 'flex-end' },
  messageTheirs: { alignItems: 'flex-start' },
  messageBubble: { maxWidth: '85%', padding: 12, borderRadius: 20 },
  textContent: { flexDirection: 'column' },
  bubbleFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 4, alignSelf: 'flex-end' },
  bubbleFooterMine: { justifyContent: 'flex-end' },
  bubbleFooterTheirs: { justifyContent: 'flex-start' },
  timeText: { fontFamily: 'Inter_400Regular', fontSize: 10 },
  readIcon: { marginLeft: 4 },
  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  reactionsMine: { justifyContent: 'flex-end' },
  reactionsTheirs: { justifyContent: 'flex-start' },
  reactionBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 12, borderWidth: 1 },
  reactionEmoji: { fontSize: 12 },
  sectionHeader: { marginBottom: 4 },
  sectionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  divider: { height: 1, marginVertical: 8 },
  messageText: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, flexShrink: 1 },
  failedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  retryText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, textDecorationLine: 'underline' },
  msgImage: { width: 200, height: 200, borderRadius: 12, marginBottom: 8 },
  failedActions: { flexDirection: 'row', marginTop: 4, alignSelf: 'flex-end' },
  draftPreview: { padding: 16, borderTopWidth: 1, borderBottomWidth: 1 },
  draftPreviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  draftPreviewTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  draftSection: { marginBottom: 12 },
  draftLabel: { fontFamily: 'Inter_500Medium', fontSize: 12, marginBottom: 4 },
  draftText: { fontFamily: 'Inter_400Regular', fontSize: 15, flexShrink: 1 },
  inputArea: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, alignItems: 'center' },
  attachBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  input: { flex: 1, marginBottom: 0, minHeight: 44, borderRadius: 22 },
  previewBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '70%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(150,150,150,0.2)' },
  modalTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18 },
  modalScroll: { paddingHorizontal: 20 },
  langOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  langOptionText: { fontFamily: 'Inter_500Medium', fontSize: 16 },
});

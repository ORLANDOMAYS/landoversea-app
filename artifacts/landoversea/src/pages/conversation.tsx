import { useState, useRef, useEffect, useMemo } from 'react';
import { useLocation, useParams } from 'wouter';
import { Loader2, ChevronLeft, Send, Globe2, X, Smile, MoreVertical, Check, CheckCheck, RefreshCw, BellOff, Bell, Flag, Ban, UserX, ImagePlus, Mic, SmilePlus, Copy, Video } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { resolveMediaUrl } from '@/lib/media-url';
import { LOCALES, RTL_LOCALES } from '@/i18n/types';
import Starfield from '@/components/Starfield';
import { authenticatedFetch, useAuth } from '@/lib/auth';
import {
  liveKeys,
  useLiveMatches,
  useLiveMessages,
  useLiveSendMessage,
} from '@/hooks/use-supabase-surfaces';
import { subscribeToMessages, unsubscribe } from '@/lib/supabase-api';
import { createVideoCall } from '@/lib/video-calls';

const PICKER_EMOJIS = ['😀','😂','🥰','😍','😎','🤔','😢','😮','👍','👎','🙏','🔥','❤️','💜','🎉','✨','🌍','☕','🍕','🎶','😴','🤗','👋','💪'];
const UUID_SIDECAR_UNAVAILABLE = 'Unavailable for Supabase conversations because no verified legacy account mapping exists.';

type TextTranslation = {
  originalContent: string;
  translatedContent: string;
  sourceLanguage: string | null;
  targetLanguage: string;
  status: 'done' | 'same_language';
};

async function translateText(
  text: string,
  targetLanguage: string,
  sourceLanguage?: string | null,
): Promise<TextTranslation> {
  const response = await authenticatedFetch(import.meta.env.BASE_URL + 'api/translations/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, targetLanguage, sourceLanguage: sourceLanguage ?? undefined }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || 'Translation failed');
  return body as TextTranslation;
}

type LocalOutgoingMessage = {
  clientId: string;
  idempotencyKey: string;
  content: string;
  createdAt: string;
  status: 'sending' | 'failed';
};

function MessageBubble({ msg, conversation, me, onReact, onCopy, onRetrySend, onDiscardSend, onTranslate }: any) {
  const { t } = useI18n();
  const isMine = msg.senderId === me.id;
  const isLocal = typeof msg.clientId === 'string';
  const reactions = (msg.reactions as any[]) || [];

  const map = new Map<string, number>();
  for (const r of reactions) {
    map.set(r.emoji, (map.get(r.emoji) || 0) + 1);
  }
  const groupedReactions = Array.from(map.entries());

  const attachmentSrc = (url: unknown): string | null => {
    if (typeof url !== 'string' || !url) return null;
    if (/^\/(api\/)?storage\/objects\//.test(url)) return import.meta.env.BASE_URL + url.replace(/^\//, '');
    if (url.startsWith('/objects/')) return resolveMediaUrl(url);
    if (/^https:\/\//i.test(url)) return url;
    return null;
  };

  const src = attachmentSrc(msg.attachmentUrl);
  const isImage = src && (msg.contentType === 'image');
  const isAudio = src && (msg.contentType === 'audio' || msg.contentType === 'voice');

  // Translation target logic
  let targetLang: string | null = null;
  if (isMine) {
    if (conversation?.type !== 'group' && conversation?.recipientTranslationLanguage) {
      targetLang = conversation.recipientTranslationLanguage;
    }
  } else if (conversation?.translationEnabled) {
    if (conversation.translationLanguage) {
      targetLang = conversation.translationLanguage;
    }
  }

  const activeTranslation = targetLang ? msg.translations?.find(
    (translation: any) => translation.targetLanguage === targetLang || translation.isStoredTranslation,
  ) : null;
  const shownTranslationText = activeTranslation?.translatedContent || activeTranslation?.translatedText;
  const isTranslating = activeTranslation?.status === 'pending' || msg._isTranslating;
  const hasFailed = activeTranslation?.status === 'failed' || msg._translationFailed;
  const hasCompletedTranslation = activeTranslation?.status === 'done' && Boolean(shownTranslationText);

  useEffect(() => {
    if (targetLang && !isLocal && msg.content) {
      if (!activeTranslation && !isTranslating && !hasFailed) {
        onTranslate(msg.id, targetLang);
      }
    }
  }, [targetLang, isLocal, msg.id, msg.content, activeTranslation, isTranslating, hasFailed]);

  const copyText = [
    msg.content,
    hasCompletedTranslation ? shownTranslationText : null,
  ].filter(part => typeof part === 'string' && part.trim().length > 0).join('\n');
  const hasCopyText = copyText.length > 0;

  const sourceLanguage = msg.detectedLanguage || activeTranslation?.sourceLanguage;
  const originalDir = RTL_LOCALES.includes(sourceLanguage) ? 'rtl' : 'ltr';
  const translatedDir = targetLang && RTL_LOCALES.includes(targetLang as any) ? 'rtl' : 'ltr';

  return (
    <div
      data-message-state={isLocal ? msg.localStatus : undefined}
      className={`flex flex-col ${isMine ? 'items-end' : 'items-start'} mb-2`}
    >
      <div className="relative group min-w-0 max-w-[85%] md:max-w-[75%]">
        <div
          className={`rounded-2xl px-4 py-3 select-text text-sm flex flex-col gap-2 ${
            isMine
              ? 'bg-gradient-to-br from-pink-600 to-purple-600 text-white rounded-se-sm shadow-sm'
              : 'glass-strong text-foreground rounded-ss-sm'
          }`}
        >
          {isImage && (
            <a href={src} target="_blank" rel="noopener noreferrer">
              <img src={src} alt={t('conversation.imageAttachment')} className="rounded-xl max-w-full max-h-64 object-cover" loading="lazy" />
            </a>
          )}
          {isAudio && (
            <audio controls src={src} className="max-w-full" />
          )}

          {msg.content && (
            <div className="flex flex-col gap-2">
              <div>
                {targetLang && activeTranslation?.status !== 'same_language' && (
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider opacity-70">
                    {t('conversation.originalMessage')}
                  </div>
                )}
                <div
                  dir={originalDir}
                  data-testid="message-original"
                  className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]"
                >
                  {msg.content}
                </div>
              </div>

              {targetLang && activeTranslation?.status === 'same_language' && (
                <div role="status" aria-live="polite" className="text-[10px] uppercase tracking-wider opacity-60 font-semibold flex items-center gap-1 border-t border-white/10 pt-2">
                  <Globe2 size={10} />
                  {t('conversation.translationSameLanguage')}
                </div>
              )}

              {targetLang && hasCompletedTranslation && (
                <div className="border-t border-white/20 pt-2 mt-1">
                  <div className="text-[10px] uppercase tracking-wider opacity-70 font-semibold mb-1 flex items-center gap-1">
                    <Globe2 size={10} />
                    {t('conversation.translatedMessage')}
                  </div>
                  <div dir={translatedDir} data-testid="message-translation" className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] opacity-90 font-medium">
                    {shownTranslationText}
                  </div>
                </div>
              )}

              {targetLang && isTranslating && (
                <div role="status" aria-live="polite" className="border-t border-white/20 pt-2 mt-1 flex items-center gap-2 opacity-70 text-xs italic">
                  <Loader2 size={12} className="animate-spin" />
                  {t('conversation.translationPending')}
                </div>
              )}

              {targetLang && (hasFailed || (activeTranslation?.status === 'done' && !shownTranslationText)) && !isTranslating && (
                <div role="status" aria-live="polite" className="border-t border-white/20 pt-2 mt-1">
                  <button type="button" onClick={() => onTranslate(msg.id, targetLang)} className="text-[10px] opacity-80 hover:opacity-100 underline underline-offset-2 flex items-center gap-1">
                    <RefreshCw size={10} /> {t('conversation.translationUnavailable')} - {t('common.retry')}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Metadata */}
          <div className={`text-[10px] flex items-center gap-1 opacity-70 ${isMine ? 'justify-end' : 'justify-start'}`}>
            <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            {isLocal && msg.localStatus === 'sending' && (
              <span className="inline-flex items-center gap-1">
                <Loader2 size={10} className="animate-spin" />
                {t('conversation.sending')}
              </span>
            )}
            {isMine && !isLocal && (
              msg.isRead
                ? <CheckCheck size={12} className="text-cyan-300 opacity-100" aria-label={t('conversation.seen')} />
                : <Check size={12} aria-label={t('conversation.sent')} />
            )}
          </div>
        </div>

        {/* Action Controls */}
        {!isLocal && (
          <button
            type="button"
            aria-label={t('conversation.addReaction')}
            disabled
            title={UUID_SIDECAR_UNAVAILABLE}
            className={`absolute top-1 ${isMine ? '-start-9' : '-end-9'} w-8 h-8 rounded-full glass-strong flex items-center justify-center text-foreground opacity-40 cursor-not-allowed`}
          >
            <SmilePlus size={16} />
          </button>
        )}

        {hasCopyText && !isLocal && (
          <button
            type="button"
            aria-label={t('conversation.copyMessage')}
            onClick={() => onCopy(copyText)}
            className={`absolute top-10 ${isMine ? '-start-9' : '-end-9'} w-8 h-8 rounded-full glass-strong flex items-center justify-center text-foreground hover:text-foreground opacity-70 md:opacity-0 md:group-hover:opacity-100 transition-opacity focus-visible:opacity-100`}
          >
            <Copy size={14} />
          </button>
        )}

        {/* Failed send actions */}
        {isLocal && msg.localStatus === 'failed' && (
          <div className="absolute top-1 -left-28 flex flex-col gap-1 items-end">
            <span className="text-[10px] text-red-400 font-semibold mb-1 whitespace-nowrap">
              {t('conversation.sendFailed')}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => onRetrySend(msg.clientId)}
                className="w-12 py-1 glass-strong rounded text-[10px] text-cyan-400 hover:text-cyan-300"
              >
                {t('conversation.retrySend')}
              </button>
              <button
                onClick={() => onDiscardSend(msg.clientId)}
                className="w-12 py-1 glass-strong rounded text-[10px] text-red-400 hover:text-red-300"
              >
                {t('conversation.discardSend')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Reactions */}
      {groupedReactions.length > 0 && (
        <div className={`flex flex-wrap gap-1 mt-1 ${isMine ? 'justify-end' : 'justify-start'}`}>
          {groupedReactions.map(([emoji, count]) => (
            <button
              key={emoji}
              disabled
              title={UUID_SIDECAR_UNAVAILABLE}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full glass bg-background/40 text-xs opacity-50 cursor-not-allowed"
            >
              <span>{emoji}</span>
              {count > 1 && <span className="text-[10px] text-muted-foreground">{count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Conversation() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const matchId = conversationId;
  const { t, locale } = useI18n();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const retryInFlightRef = useRef(new Set<string>());
  const translateInFlightRef = useRef(new Set<string>());
  const languageMenuRef = useRef<HTMLDivElement>(null);
  const languageButtonRef = useRef<HTMLButtonElement>(null);

  const { user: authUser } = useAuth();
  const me = authUser ? { id: authUser.id, name: authUser.user_metadata?.display_name ?? '' } : null;
  const [translationEnabled, setTranslationEnabled] = useState(true);
  const [translationLanguage, setTranslationLanguage] = useState<string>(locale);
  const { data: liveMatches, isLoading: isLoadingConv } = useLiveMatches();
  const liveMatch = liveMatches?.find((match) => match.id === matchId);
  const recipientLanguage = liveMatch?.participants?.[0]?.primaryLanguage;
  const conversation: any = liveMatch ? {
    id: liveMatch.id,
    type: 'direct',
    participants: liveMatch.participants,
    lastMessage: liveMatch.lastMessage,
    translationEnabled,
    translationLanguage,
    recipientTranslationLanguage: LOCALES.includes(recipientLanguage as any) ? recipientLanguage : null,
  } : null;

  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [allMessages, setAllMessages] = useState<any[]>([]);

  const { data: messages, isLoading: isLoadingMsgs } = useLiveMessages(matchId);

  const liveSendMutation = useLiveSendMessage();
  const sendMessageMutation: any = {
    ...liveSendMutation,
    mutateAsync: ({ data }: any) => liveSendMutation.mutateAsync({
      matchId,
      body: data.content,
      language: data.senderLanguage,
      translatedBody: data.translatedBody,
    }),
  };

  const [text, setText] = useState('');
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [localOutgoing, setLocalOutgoing] = useState<LocalOutgoingMessage[]>([]);
  const [startingVideoCall, setStartingVideoCall] = useState(false);

  const [previewDraft, setPreviewDraft] = useState<any | null>(null);
  const [isPreviewTranslating, setIsPreviewTranslating] = useState(false);
  const [translatingMsgs, setTranslatingMsgs] = useState<Record<string, boolean>>({});
  const [failedTranslatingMsgs, setFailedTranslatingMsgs] = useState<Record<string, boolean>>({});
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');

  const renderedMessages = useMemo(() => [
    ...allMessages.map(m => {
      const incomingTarget = conversation?.translationLanguage;
      const outgoingTarget = conversation?.type !== 'group' ? conversation?.recipientTranslationLanguage : null;
      const target = m.senderId === me?.id ? outgoingTarget : incomingTarget;
      const translationKey = `${m.id}:${target ?? ''}`;
      return {
        ...m,
        _isTranslating: translatingMsgs[translationKey],
        _translationFailed: failedTranslatingMsgs[translationKey],
      };
    }),
    ...localOutgoing.map(item => ({
      id: `local-${item.clientId}`,
      clientId: item.clientId,
      senderId: me?.id,
      content: item.content,
      contentType: 'text',
      createdAt: item.createdAt,
      localStatus: item.status,
    })),
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()), [allMessages, localOutgoing, translatingMsgs, failedTranslatingMsgs, me?.id, conversation]);

  useEffect(() => {
    setCursor(undefined);
    setAllMessages([]);
    setLocalOutgoing([]);
    setPreviewDraft(null);
    setTranslatingMsgs({});
    setFailedTranslatingMsgs({});
    translateInFlightRef.current.clear();
  }, [matchId, me?.id]);

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
    }
  }, [messages]);

  useEffect(() => {
    if (!matchId || !authUser) return;
    const channel = subscribeToMessages(
      matchId,
      (message) => {
        pushMessage({
          ...message,
          senderId: message.sender_id,
          content: message.body,
          translated_body: message.translated_body,
          sender_language: message.sender_language,
          createdAt: message.created_at,
          contentType: 'text',
          translations: message.translated_body ? [{
            targetLanguage: null,
            sourceLanguage: message.sender_language,
            translatedContent: message.translated_body,
            status: 'done',
            isStoredTranslation: true,
          }] : [],
        });
      },
      (status) => {
        // A fresh read after every (re)subscribe closes gaps from an offline
        // period; Supabase Realtime itself performs transport reconnection.
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('connected');
          queryClient.invalidateQueries({ queryKey: liveKeys.messages(matchId) });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setRealtimeStatus('error');
        } else {
          setRealtimeStatus('connecting');
        }
      },
    );
    return () => {
      void unsubscribe(channel);
    };
  }, [matchId, authUser?.id, queryClient]);

  useEffect(() => {
    if (!showLangMenu) return;
    languageMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus();
    const close = () => {
      setShowLangMenu(false);
      requestAnimationFrame(() => languageButtonRef.current?.focus());
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!languageMenuRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showLangMenu]);

  useEffect(() => {
    if (cursor === undefined) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [allMessages, localOutgoing, cursor]);

  if (!matchId) {
    return <div className="text-foreground p-8">{t('conversation.invalidId')}</div>;
  }

  if (isLoadingConv || isLoadingMsgs || !me) {
    return (
      <div className="flex justify-center items-center h-[100dvh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!conversation) {
    return <div className="text-foreground p-8">{t('conversation.notFound')}</div>;
  }

  const isGroup = conversation.type === 'group';
  const otherUser = conversation.participants?.[0];
  const photo = resolveMediaUrl(otherUser?.photos?.[0]?.url) || 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&q=80&w=150';
  const translationLanguageName = conversation.translationLanguage
    ? t(`languageNames.${conversation.translationLanguage}` as any) || conversation.translationLanguage
    : '';
  const translationModeLabel = isGroup
    ? `${t('conversation.translateForMe')}: ${translationLanguageName}`
    : translationLanguageName;

  const sendLocalMessage = async (localMessage: LocalOutgoingMessage) => {
    if (retryInFlightRef.current.has(localMessage.clientId)) return;
    retryInFlightRef.current.add(localMessage.clientId);
    setLocalOutgoing(prev => prev.map(item => (
      item.clientId === localMessage.clientId ? { ...item, status: 'sending' } : item
    )));

    try {
      const sourceLanguage = locale;
      const targetLanguage = conversation.recipientTranslationLanguage;
      let translatedBody: string | undefined;
      if (targetLanguage && targetLanguage !== sourceLanguage) {
        const translation = await translateText(localMessage.content, targetLanguage, sourceLanguage);
        translatedBody = translation.translatedContent;
      }
      const newMsg = await sendMessageMutation.mutateAsync({
        data: {
          contentType: 'text',
          content: localMessage.content,
          idempotencyKey: localMessage.idempotencyKey,
          senderLanguage: sourceLanguage,
          translatedBody,
        },
      });
      setLocalOutgoing(prev => prev.filter(item => item.clientId !== localMessage.clientId));
      pushMessage(newMsg);
    } catch {
      setLocalOutgoing(prev => prev.map(item => (
        item.clientId === localMessage.clientId ? { ...item, status: 'failed' } : item
      )));
    } finally {
      retryInFlightRef.current.delete(localMessage.clientId);
    }
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const content = text.trim();
    if (!content || sendMessageMutation.isPending) return;

    const idempotencyKey = crypto.randomUUID();
    const localMessage: LocalOutgoingMessage = {
      clientId: idempotencyKey,
      idempotencyKey,
      content,
      createdAt: new Date().toISOString(),
      status: 'sending',
    };
    setText('');
    setPreviewDraft(null);
    setLocalOutgoing(prev => [...prev, localMessage]);
    void sendLocalMessage(localMessage);
  };

  function pushMessage(newMsg: any) {
    if (!newMsg) return;
    setAllMessages(prev => {
      const byId = new Map<string, any>();
      for (const m of prev) byId.set(String(m.id), m);
      byId.set(String(newMsg.id), newMsg);
      return Array.from(byId.values()).sort((a, b) => {
        const byDate = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return byDate !== 0 ? byDate : String(a.id).localeCompare(String(b.id));
      });
    });
    queryClient.invalidateQueries({ queryKey: liveKeys.messages(matchId) });
    queryClient.invalidateQueries({ queryKey: liveKeys.matches });
  }

  const handleTranslate = (msgId: string, target: string) => {
    const translationKey = `${msgId}:${target}`;
    if (translateInFlightRef.current.has(translationKey)) return;
    translateInFlightRef.current.add(translationKey);
    setTranslatingMsgs(prev => ({ ...prev, [translationKey]: true }));
    setFailedTranslatingMsgs(prev => ({ ...prev, [translationKey]: false }));

    const message = allMessages.find(item => item.id === msgId);
    if (!message?.content) {
      translateInFlightRef.current.delete(translationKey);
      setTranslatingMsgs(prev => ({ ...prev, [translationKey]: false }));
      return;
    }
    void translateText(
      message.content,
      target,
      message.sender_language || message.senderLanguage || undefined,
    ).then((translation) => {
        setAllMessages(prev => prev.map(message => {
          if (message.id !== msgId) return message;
          const translations = (message.translations || []).filter(
            (existing: any) => existing.targetLanguage !== target && !existing.isStoredTranslation,
          );
          return { ...message, translations: [...translations, {
            ...translation,
            translatedContent: translation.translatedContent,
          }] };
        }));
      }).catch(() => {
        setFailedTranslatingMsgs(prev => ({ ...prev, [translationKey]: true }));
      }).finally(() => {
        translateInFlightRef.current.delete(translationKey);
        setTranslatingMsgs(prev => ({ ...prev, [translationKey]: false }));
      });
  };

  const handlePreviewDraft = async () => {
    const content = text.trim();
    if (!content) return;

    const target = isGroup
      ? (conversation.translationEnabled ? conversation.translationLanguage : null)
      : conversation.recipientTranslationLanguage;
    if (!target) return;

    setIsPreviewTranslating(true);
    try {
      setPreviewDraft(await translateText(content, target, locale));
    } catch {
      toast({ title: t('conversation.translationUnavailable'), variant: 'destructive' });
    } finally {
      setIsPreviewTranslating(false);
    }
  };

  const handleToggleTranslation = () => {
    setTranslationEnabled(value => !value);
  };

  const handleSelectLanguage = (lang: string) => {
    setTranslationEnabled(true);
    setTranslationLanguage(lang);
    setShowLangMenu(false);
    requestAnimationFrame(() => languageButtonRef.current?.focus());
  };

  const handleReact = () => {};

  const handleCopyMessage = async (text: string) => {
    const value = (text ?? '').toString();
    if (!value) return;
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        ok = true;
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        ok = document.execCommand('copy');
        document.body.removeChild(textarea);
      }
    } catch {
      ok = false;
    }
    if (ok) {
      toast({ title: t('conversation.copied') });
    } else {
      toast({ title: t('conversation.copyError'), variant: 'destructive' });
    }
  };

  const handleStartVideoCall = async () => {
    if (!otherUser?.id || startingVideoCall) return;
    if (
      !navigator.mediaDevices?.getUserMedia
      || typeof RTCPeerConnection === 'undefined'
    ) {
      toast({ title: t('videoCall.unsupported'), variant: 'destructive' });
      return;
    }
    setStartingVideoCall(true);
    setShowLangMenu(false);
    setShowMoreMenu(false);
    try {
      const call = await createVideoCall(matchId, otherUser.id);
      setLocation(`/video-call/${call.id}`);
    } catch (error) {
      const description = error instanceof Error ? error.message : t('videoCall.failed');
      toast({
        title: t('videoCall.failed'),
        description,
        variant: 'destructive',
      });
      setStartingVideoCall(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-var(--mobile-nav-space))] md:h-[calc(100dvh-4rem)] bg-transparent relative">
      <Starfield />

      {/* Header */}
      <div className="sticky top-0 glass-strong border-b border-border z-20 flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 shadow-md backdrop-blur-3xl">
        <button
          type="button"
          aria-label={t('common.back')}
          className="w-10 h-10 rounded-full flex items-center justify-center text-foreground hover:bg-white/10 transition-colors shrink-0"
          onClick={() => setLocation('/messages')}
        >
          <ChevronLeft size={24} />
        </button>

        <Link href={isGroup ? '#' : `/profile/${otherUser?.id}`} className="flex items-center gap-3 flex-1 min-w-0 group">
          {isGroup ? (
            <div className="relative shrink-0 flex items-center justify-center w-11 h-11 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 border border-white/20">
              <span className="text-white font-bold">{conversation.title?.charAt(0) || 'G'}</span>
            </div>
          ) : (
            <div className="relative shrink-0">
              <img src={photo} alt={otherUser?.name} className="w-11 h-11 rounded-full object-cover border border-white/10" />
              <span className="w-3.5 h-3.5 bg-green-400 rounded-full border-2 border-[#080014] absolute bottom-0 end-0" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-foreground font-semibold text-base truncate">
              {isGroup ? conversation.title : otherUser?.name}
            </p>
            <p className="text-white/60 text-xs truncate">
              {isGroup
                ? t('conversation.groupMembers', { count: conversation.participants?.length || 0 })
                : realtimeStatus !== 'connected'
                  ? (realtimeStatus === 'error' ? 'Reconnecting…' : 'Connecting…')
                  : (otherUser?.primaryLanguage ? t('conversation.speaks', { language: t(`languageNames.${otherUser.primaryLanguage}` as any) || otherUser.primaryLanguage }) : t('common.online'))}
            </p>
          </div>
        </Link>

        {!isGroup && (
          <button
            type="button"
            onClick={() => void handleStartVideoCall()}
            disabled={startingVideoCall}
            aria-label={t('videoCall.start')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-50"
          >
            {startingVideoCall
              ? <Loader2 size={20} className="animate-spin" />
              : <Video size={20} />}
          </button>
        )}

        {/* Translation Toggle & Status */}
        <div ref={languageMenuRef} className="relative shrink-0 flex items-center gap-1">
          {conversation.translationEnabled && conversation.translationLanguage && (
            <div className="flex max-w-24 sm:max-w-56 items-center gap-1 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider glass bg-cyan-950/30 px-2 sm:px-3 py-1.5 rounded-full text-cyan-300 shrink-0 border-cyan-500/30 shadow-[0_0_15px_rgba(34,211,238,0.15)]">
              <Globe2 size={12} className="opacity-80 shrink-0" />
              <span className="truncate">{translationModeLabel}</span>
              <button type="button" onClick={handleToggleTranslation} className="hover:text-white ms-1 opacity-70 hover:opacity-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded-full" aria-label={`${t('common.close')} ${t('conversation.translate')}`}>
                <X size={12} strokeWidth={2.5} />
              </button>
            </div>
          )}

          <button
            ref={languageButtonRef}
            type="button"
            aria-label={`${t('conversation.translate')} — ${t('language.select')}`}
            aria-haspopup="menu"
            aria-expanded={showLangMenu}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${showLangMenu ? 'bg-cyan-500/20 text-cyan-400' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
            onClick={() => { setShowLangMenu(v => !v); setShowMoreMenu(false); }}
          >
            <Globe2 size={20} />
          </button>

          {showLangMenu && (
            <div role="menu" aria-label={t('language.select')} className="absolute end-0 top-full mt-2 w-48 glass-strong rounded-xl z-50 py-1.5 overflow-hidden shadow-2xl border-white/20 max-h-80 overflow-y-auto">
              {LOCALES.map(lang => (
                <button
                  key={lang}
                  type="button"
                  role="menuitemradio"
                  aria-checked={conversation.translationLanguage === lang}
                  className="w-full text-start px-4 py-2.5 text-sm text-foreground hover:text-white hover:bg-white/10 transition-colors flex items-center justify-between"
                  onClick={() => handleSelectLanguage(lang)}
                >
                  <span>{t(`languageNames.${lang}` as any)}</span>
                  {conversation.translationLanguage === lang && <Check size={14} className="text-cyan-400" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            aria-label={t('conversation.moreOptions')}
            aria-haspopup="menu"
            aria-expanded={showMoreMenu}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${showMoreMenu ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
            onClick={() => { setShowMoreMenu(v => !v); setShowLangMenu(false); }}
          >
            <MoreVertical size={20} />
          </button>

          {showMoreMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
              <div role="menu" className="absolute end-0 top-full mt-2 w-52 glass-strong rounded-xl z-50 py-1.5 overflow-hidden shadow-2xl border-white/20">
                <p className="px-4 py-2 text-[11px] leading-snug text-white/50" role="note">
                  {UUID_SIDECAR_UNAVAILABLE}
                </p>
                <button
                  role="menuitem"
                  className="w-full text-start px-4 py-2.5 text-sm text-foreground/40 cursor-not-allowed flex items-center gap-2"
                  disabled
                  title={UUID_SIDECAR_UNAVAILABLE}
                >
                  {conversation.isMuted ? <Bell size={16} /> : <BellOff size={16} />}
                  {conversation.isMuted ? t('conversation.unmuteConversation') : t('conversation.muteConversation')}
                </button>
                <button
                  role="menuitem"
                  className="w-full text-start px-4 py-2.5 text-sm text-foreground/40 cursor-not-allowed flex items-center gap-2"
                  disabled
                  title={UUID_SIDECAR_UNAVAILABLE}
                >
                  <Flag size={16} /> {t('conversation.report')}
                </button>
                {!isGroup && (
                  <button
                    role="menuitem"
                    className="w-full text-start px-4 py-2.5 text-sm text-foreground/40 cursor-not-allowed flex items-center gap-2"
                    disabled
                    title={UUID_SIDECAR_UNAVAILABLE}
                  >
                    <UserX size={16} /> {t('conversation.unmatch')}
                  </button>
                )}
                {!isGroup && (
                  <button
                    role="menuitem"
                    className="w-full text-start px-4 py-2.5 text-sm text-red-400/40 cursor-not-allowed flex items-center gap-2"
                    disabled
                    title={UUID_SIDECAR_UNAVAILABLE}
                  >
                    <Ban size={16} /> {t('conversation.block')}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div data-testid="conversation-messages" className="flex-1 overflow-y-auto py-4 px-4 space-y-2 z-10 scroll-smooth">
        {(messages?.length ?? 0) >= 50 && (
          <button
            onClick={() => { if (allMessages[0]) setCursor(`${new Date(allMessages[0].createdAt).toISOString()}|${allMessages[0].id}`); }}
            className="w-full text-center text-white/50 text-xs py-3 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded-lg"
          >
            {t('conversation.loadEarlier')}
          </button>
        )}

        {renderedMessages.map(msg => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            conversation={conversation}
            me={me}
            onReact={handleReact}
            onCopy={handleCopyMessage}
            onRetrySend={(clientId: string) => { const m = localOutgoing.find(x => x.clientId === clientId); if (m) sendLocalMessage(m); }}
            onDiscardSend={(clientId: string) => { setLocalOutgoing(prev => prev.filter(x => x.clientId !== clientId)); }}
            onTranslate={handleTranslate}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div className="z-20 p-3 glass-strong border-t border-border">
        {/* Draft Preview Card */}
        {previewDraft && (
          <div role="status" aria-live="polite" className="mb-3 p-3 rounded-xl bg-black/40 border border-white/10 backdrop-blur-md relative">
            <button
              onClick={() => setPreviewDraft(null)}
              className="absolute top-2 end-2 p-1 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              aria-label={t('conversation.closePreview')}
            >
              <X size={14} />
            </button>
            <div className="text-[10px] uppercase tracking-wider text-cyan-400 font-semibold mb-2 flex items-center gap-1">
              <Globe2 size={10} />
              {t('conversation.previewDraft')}
            </div>

            <div className="mb-2">
              <div className="text-[10px] text-white/40 uppercase mb-0.5">{t('conversation.previewOriginal')}</div>
              <div
                dir={RTL_LOCALES.includes(previewDraft.sourceLanguage) ? 'rtl' : 'ltr'}
                className="text-sm text-white/90 [overflow-wrap:anywhere]"
              >
                {previewDraft.originalContent}
              </div>
            </div>

            <div>
              <div className="text-[10px] text-white/40 uppercase mb-0.5">{t('conversation.previewTranslated')} ({t(`languageNames.${previewDraft.targetLanguage}` as any) || previewDraft.targetLanguage})</div>
              {previewDraft.status === 'done' ? (
                <div
                  dir={RTL_LOCALES.includes(previewDraft.targetLanguage) ? 'rtl' : 'ltr'}
                  className="text-sm text-cyan-100 [overflow-wrap:anywhere] font-medium"
                >
                  {previewDraft.translatedContent}
                </div>
              ) : previewDraft.status === 'same_language' ? (
                <div className="text-sm text-white/60 italic">{t('conversation.translationSameLanguage')}</div>
              ) : (
                <div className="text-sm text-red-400 italic">{t('conversation.translationUnavailable')}</div>
              )}
            </div>
          </div>
        )}

        <form onSubmit={handleSend} className="flex items-end gap-2 relative">
          <div className="flex bg-black/20 rounded-full border border-white/10 p-1">
            <button type="button" disabled title={UUID_SIDECAR_UNAVAILABLE} className="w-10 h-10 rounded-full flex items-center justify-center text-white/30 cursor-not-allowed shrink-0" aria-label={`${t('conversation.attachImage')}. ${UUID_SIDECAR_UNAVAILABLE}`}>
              <ImagePlus size={18} />
            </button>
            <button type="button" disabled title={UUID_SIDECAR_UNAVAILABLE} className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-white/30 cursor-not-allowed" aria-label={`${t('conversation.recordVoice')}. ${UUID_SIDECAR_UNAVAILABLE}`}>
              <Mic size={18} />
            </button>
          </div>

          <div className="flex-1 relative flex items-center">
            <input
              ref={inputRef}
              type="text"
              className="w-full glass-input rounded-full ps-5 pe-12 py-3 text-sm focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50"
              placeholder={t('conversation.typeMessage')}
              value={text}
              onChange={e => setText(e.target.value)}
            />
            <button
              type="button"
              className="absolute end-2 w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              onClick={() => setShowEmojiPicker(v => !v)}
              aria-label={t('conversation.emojiPicker')}
            >
              <Smile size={18} />
            </button>
          </div>

          <div className="flex flex-col gap-1 justify-end h-full">
            {text.trim() && (
              isGroup
                ? conversation.translationEnabled && conversation.translationLanguage
                : conversation.recipientTranslationLanguage
            ) && (
              <button
                type="button"
                onClick={handlePreviewDraft}
                disabled={isPreviewTranslating}
                className="w-12 h-6 rounded-full glass bg-cyan-950/50 text-[10px] text-cyan-400 hover:bg-cyan-900 flex items-center justify-center shadow-md border-cyan-500/30 font-semibold mb-1 absolute -top-8 end-16"
                aria-label={t('conversation.previewDraft')}
              >
                {isPreviewTranslating ? <Loader2 size={10} className="animate-spin" /> : 'A/あ'}
              </button>
            )}

            <button
              type="submit"
              disabled={!text.trim() || sendMessageMutation.isPending}
              className="w-12 h-12 rounded-full btn-glow flex items-center justify-center text-white shrink-0 disabled:opacity-50 disabled:bg-muted"
              aria-label={t('conversation.sendMessage')}
            >
              {sendMessageMutation.isPending ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} className="ms-1" />}
            </button>
          </div>
        </form>

        {showEmojiPicker && (
          <div className="absolute bottom-[4.5rem] end-4 glass-strong p-3 rounded-2xl border-white/20 shadow-2xl grid grid-cols-6 gap-2 animate-in slide-in-from-bottom-2 fade-in">
            {PICKER_EMOJIS.map(emoji => (
              <button key={emoji} type="button" onClick={() => { setText(p => p + emoji); setShowEmojiPicker(false); inputRef.current?.focus(); }} className="w-8 h-8 flex items-center justify-center text-xl hover:bg-white/10 rounded-full transition-colors" aria-label={t('conversation.insertEmojiName', { emoji })}>
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

import { useState } from 'react';
import { resolveMediaUrl } from '@/lib/media-url';
import { Loader2, Search, MessageCircle, Users } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useI18n } from '@/i18n';
import { useLiveMatches } from '@/hooks/use-supabase-surfaces';

const SUPABASE_GROUPS_UNAVAILABLE =
  'Group chat creation is unavailable for Supabase conversations until a safe group mapping exists.';

export default function Messages() {
  const { t } = useI18n();
  const { data: conversations, isLoading } = useLiveMatches();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState('');

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[100dvh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Filter by search
  const filtered = (conversations || []).filter(c => {
    const name = c.participants?.[0]?.name || '';
    const last = (c.lastMessage as any)?.content || '';
    return (name + last).toLowerCase().includes(search.toLowerCase());
  });

  const pinned = filtered.filter(c => c.isPinned);
  const unpinned = filtered.filter(c => !c.isPinned);

  const formatTime = (dateStr?: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return t('messages.yesterday');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const renderConversation = (conv: any) => {
    const otherUser = conv.participants?.[0];
    if (!otherUser) return null;

    const photo = resolveMediaUrl(otherUser.photos?.[0]?.url) || 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&q=80&w=150';
    const lastMsg = conv.lastMessage;
    const hasUnread = (conv.unreadCount ?? 0) > 0;

    return (
      <Link
        key={conv.id}
        href={`/messages/${conv.id}`}
        className={`glass rounded-2xl p-4 mb-3 flex items-center gap-3 cursor-pointer transition-all hover:glass-strong ${hasUnread ? 'glow-pink border-l-2 border-pink-500/60' : ''}`}
      >
        {/* Avatar */}
        <div className="relative shrink-0">
          <img src={photo} alt={otherUser.name} className="w-14 h-14 rounded-full object-cover" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className={`text-sm truncate ${hasUnread ? 'text-foreground font-semibold' : 'text-foreground font-medium'}`}>
              {otherUser.name}
            </span>
            <span className="text-muted-foreground text-xs whitespace-nowrap ml-2">
              {formatTime(lastMsg?.createdAt)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className={`text-xs truncate ${hasUnread ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>
              {lastMsg ? (lastMsg.content || t('messages.sentAttachment')) : t('messages.startConversation')}
            </p>
            {hasUnread && (
              <span className="min-w-[20px] h-5 rounded-full bg-gradient-to-r from-pink-500 to-purple-500 flex items-center justify-center text-[10px] text-brand-surface-foreground font-bold px-1 shrink-0">
                {conv.unreadCount}
              </span>
            )}
          </div>
        </div>
      </Link>
    );
  };

  const isEmpty = !conversations || conversations.length === 0;

  return (
    <div className="min-h-[100dvh] px-4 pt-[env(safe-area-inset-top)] pt-6 pb-24 max-w-[500px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-foreground text-2xl font-bold">{t('messages.title')}</h1>
        <div className="flex items-center gap-2">
          {!isEmpty && (conversations?.length ?? 0) > 0 && (
            <span className="glass px-2 py-0.5 rounded-full text-xs text-muted-foreground">
              {conversations?.length}
            </span>
          )}
          <button
            disabled
            title={SUPABASE_GROUPS_UNAVAILABLE}
            aria-describedby="supabase-groups-unavailable"
            aria-label={t('messages.newGroup')}
            className="w-9 h-9 rounded-full glass flex items-center justify-center text-foreground/40 cursor-not-allowed"
          >
            <Users size={18} />
          </button>
        </div>
        <p id="supabase-groups-unavailable" className="mt-1 text-right text-[11px] leading-snug text-muted-foreground" role="note">
          {SUPABASE_GROUPS_UNAVAILABLE}
        </p>
      </div>

      {/* Search */}
      <div className="mt-4 flex items-center gap-3 glass rounded-2xl px-4 py-3">
        <Search className="text-muted-foreground shrink-0" size={18} />
        <input
          type="text"
          placeholder={t('messages.searchPlaceholder')}
          className="bg-transparent border-none text-foreground placeholder:text-muted-foreground focus:outline-none flex-1 text-sm"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <MessageCircle className="text-primary" size={48} />
          <h3 className="font-serif text-foreground text-xl mt-4">{t('messages.noConversations')}</h3>
          <p className="text-muted-foreground text-sm mt-2">{t('messages.matchToChat')}</p>
          <button
            className="btn-glow mt-6 px-6 py-3 rounded-full text-white font-semibold"
            onClick={() => setLocation('/discover')}
          >
            {t('messages.startDiscovering')}
          </button>
        </div>
      )}

      {/* Pinned */}
      {pinned.length > 0 && (
        <div className="mt-6">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{t('messages.pinned')}</p>
          {pinned.map(renderConversation)}
        </div>
      )}

      {/* Recent / all unpinned */}
      {!isEmpty && (
        <div className="mt-4">
          {pinned.length > 0 && (
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{t('messages.recent')}</p>
          )}
          {unpinned.length > 0 ? (
            unpinned.map(renderConversation)
          ) : (
            search ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t('messages.noResults')}</p>
            ) : null
          )}
        </div>
      )}

    </div>
  );
}

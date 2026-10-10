import { useState } from 'react';
import { useGetSafetyTips, useGetBlockedUsers, useUnblockUser } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, Link } from 'wouter';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft, ChevronDown, ShieldAlert, Loader2,
  Globe, Users, AlertTriangle, Plane, Lock, Phone
} from 'lucide-react';
import { useI18n, type TranslationKey } from '@/i18n';

interface SafetyTopic {
  id: string;
  titleKey: TranslationKey;
  color: string;
  borderColor: string;
  Icon: typeof Globe;
  tipKeys: TranslationKey[];
}

const TOPICS: SafetyTopic[] = [
  {
    id: 'online',
    titleKey: 'safety.topics.online.title',
    color: '#8B5CF6',
    borderColor: 'border-violet-500',
    Icon: Globe,
    tipKeys: [
      'safety.topics.online.tip1',
      'safety.topics.online.tip2',
      'safety.topics.online.tip3',
      'safety.topics.online.tip4',
    ],
  },
  {
    id: 'meeting',
    titleKey: 'safety.topics.meeting.title',
    color: '#FF2D7A',
    borderColor: 'border-pink-500',
    Icon: Users,
    tipKeys: [
      'safety.topics.meeting.tip1',
      'safety.topics.meeting.tip2',
      'safety.topics.meeting.tip3',
      'safety.topics.meeting.tip4',
    ],
  },
  {
    id: 'scams',
    titleKey: 'safety.topics.scams.title',
    color: '#F97316',
    borderColor: 'border-orange-500',
    Icon: AlertTriangle,
    tipKeys: [
      'safety.topics.scams.tip1',
      'safety.topics.scams.tip2',
      'safety.topics.scams.tip3',
      'safety.topics.scams.tip4',
    ],
  },
  {
    id: 'travel',
    titleKey: 'safety.topics.travel.title',
    color: '#63E6FF',
    borderColor: 'border-cyan-500',
    Icon: Plane,
    tipKeys: [
      'safety.topics.travel.tip1',
      'safety.topics.travel.tip2',
      'safety.topics.travel.tip3',
      'safety.topics.travel.tip4',
    ],
  },
  {
    id: 'privacy',
    titleKey: 'safety.topics.privacy.title',
    color: '#3B82F6',
    borderColor: 'border-blue-500',
    Icon: Lock,
    tipKeys: [
      'safety.topics.privacy.tip1',
      'safety.topics.privacy.tip2',
      'safety.topics.privacy.tip3',
      'safety.topics.privacy.tip4',
    ],
  },
  {
    id: 'emergency',
    titleKey: 'safety.topics.emergency.title',
    color: '#EF4444',
    borderColor: 'border-red-500',
    Icon: Phone,
    tipKeys: [
      'safety.topics.emergency.tip1',
      'safety.topics.emergency.tip2',
      'safety.topics.emergency.tip3',
      'safety.topics.emergency.tip4',
    ],
  },
];

export default function Safety() {
  const { toast } = useToast();
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const { data: tips, isLoading: tipsLoading } = useGetSafetyTips();
  const { data: blocked, isLoading: blockLoading } = useGetBlockedUsers();
  const unblockMutation = useUnblockUser();

  const [openTopic, setOpenTopic] = useState<string | null>(null);

  const handleUnblock = (blockedUserId: number) => {
    unblockMutation.mutate(
      { blockedUserId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/safety/blocks'] });
          toast({ title: t('safety.userUnblocked') });
        },
        onError: (err: any) => {
          toast({ title: t('safety.unblockFailed'), description: err.message, variant: 'destructive' });
        },
      }
    );
  };

  // Merge API tips into the topics if available. Server-provided tips are
  // dynamic content and rendered as-is; the local fallback tips are translated.
  const topicsWithData = TOPICS.map(topic => {
    const apiTips = tips?.filter(tip => tip.category?.toLowerCase() === topic.id) ?? [];
    return {
      ...topic,
      tips: apiTips.length > 0 ? apiTips.map(tip => tip.body) : topic.tipKeys.map(key => t(key)),
    };
  });

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      {/* Header */}
      <header
        className="sticky top-0 z-40 flex items-center gap-3 px-4 py-3"
        style={{
          background: 'var(--nav-bg)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--nav-border)',
        }}
      >
        <Link href="/settings">
          <button className="w-9 h-9 rounded-full glass flex items-center justify-center">
            <ChevronLeft className="w-5 h-5 text-foreground" />
          </button>
        </Link>
        <h1 className="font-serif text-xl text-foreground flex-1">{t('safety.center')}</h1>
        <ShieldAlert className="w-5 h-5 text-primary" />
      </header>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Loading */}
        {(tipsLoading || blockLoading) && (
          <div className="flex justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}

        {/* Accordion topics */}
        <div className="space-y-3">
          {topicsWithData.map(topic => {
            const isOpen = openTopic === topic.id;
            return (
              <div
                key={topic.id}
                className={`glass rounded-2xl overflow-hidden cursor-pointer border-l-[3px] ${topic.borderColor}`}
                onClick={() => setOpenTopic(isOpen ? null : topic.id)}
              >
                <div className="flex items-center gap-3 p-4">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: `${topic.color}22` }}
                  >
                    <topic.Icon className="w-4 h-4" style={{ color: topic.color }} />
                  </div>
                  <span className="text-foreground font-medium flex-1">{t(topic.titleKey)}</span>
                  {isOpen ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground rotate-180 transition-transform" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform" />
                  )}
                </div>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <ul className="px-4 pb-4 space-y-2 border-t border-border pt-3">
                        {topic.tips.map((tip, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                            <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: topic.color }} />
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        {/* Blocked Users */}
        <div className="space-y-3 pt-2">
          <h2 className="font-serif text-xl text-foreground">{t('safety.blockedUsers')}</h2>

          {!blockLoading && (!blocked || blocked.length === 0) ? (
            <div className="glass rounded-2xl p-6 text-center">
              <div className="w-12 h-12 rounded-full glass flex items-center justify-center mx-auto mb-3">
                <ShieldAlert className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="font-serif text-muted-foreground">{t('safety.noBlockedUsers')}</p>
              <p className="text-muted-foreground text-sm mt-1">{t('safety.noBlockedUsersDesc')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {blocked?.map(b => (
                <div key={b.id} className="glass rounded-2xl p-4 flex items-center gap-3">
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full glass-strong flex items-center justify-center text-foreground font-semibold shrink-0">
                    {(b.blockedUser?.name || '?').charAt(0).toUpperCase()}
                  </div>
                  <span className="text-foreground flex-1 font-medium">{b.blockedUser?.name || t('safety.unknownUser')}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleUnblock(b.blockedUserId); }}
                    disabled={unblockMutation.isPending}
                    className="glass border border-red-500/40 text-red-400 rounded-full px-3 py-1.5 text-sm hover:bg-red-500/10 transition-all disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
                  >
                    {t('safety.unblock')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

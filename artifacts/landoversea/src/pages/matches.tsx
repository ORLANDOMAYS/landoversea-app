import { useRef, useState } from 'react';
import { resolveMediaUrl } from '@/lib/media-url';
import {
  getGetMatchStatsQueryKey,
  resolveSafetyUser,
  useGetMatchStats,
} from '@workspace/api-client-react';
import { MapPin, ShieldCheck, MoreHorizontal, MessageCircle, UserX, Flag, Loader2 } from 'lucide-react';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { useI18n } from '@/i18n';
import { liveKeys, useLiveMatches } from '@/hooks/use-supabase-surfaces';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ReportUserModal } from '@/components/report-user-modal';

const SUPABASE_UNMATCH_UNAVAILABLE =
  'Unmatch is unavailable for Supabase matches until a verified legacy match mapping exists.';
const SUPABASE_BLOCK_UNAVAILABLE =
  'Blocking is temporarily unavailable while accounts are being migrated. No block has been applied.';
const REPORT_IDENTITY_UNAVAILABLE =
  'Reporting is unavailable for this account because its safety identity has not finished migrating.';

interface ReportCandidate {
  supabaseUserId: string;
  name: string;
}

interface ReportTarget extends ReportCandidate {
  localUserId: number;
}

export default function Matches() {
  const { t } = useI18n();
  const { data: matches, isLoading } = useLiveMatches();
  const { data: stats } = useGetMatchStats();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const [reportCandidate, setReportCandidate] = useState<ReportCandidate | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const reportAttempt = useRef(0);
  const reportResolution = useMutation({
    mutationFn: ({ candidate }: { candidate: ReportCandidate; attempt: number }) =>
      resolveSafetyUser(candidate.supabaseUserId),
    onSuccess: (data, { candidate, attempt }) => {
      if (attempt !== reportAttempt.current) return;
      setReportTarget({
        ...candidate,
        localUserId: data.userId,
      });
      setReportCandidate(null);
      setActiveSheet(null);
    },
    onError: (_error, { attempt }) => {
      if (attempt !== reportAttempt.current) return;
      toast({
        title: t('report.submitFailed'),
        description: REPORT_IDENTITY_UNAVAILABLE,
        variant: 'destructive',
      });
      setReportCandidate(null);
    },
  });

  const handleReport = (candidate: ReportCandidate) => {
    const attempt = reportAttempt.current + 1;
    reportAttempt.current = attempt;
    setReportCandidate(candidate);
    reportResolution.mutate({ candidate, attempt });
  };

  const handleReportSuccess = () => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: liveKeys.matches }),
      queryClient.invalidateQueries({ queryKey: liveKeys.discovery }),
      queryClient.invalidateQueries({ queryKey: getGetMatchStatsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: ['/api/admin/reports'] }),
    ]);
  };

  // New Today: not in MatchStats, so derive from matches created today
  const todayCount = matches?.filter(m => {
    if (!m.createdAt) return false;
    const d = new Date(m.createdAt);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  }).length ?? 0;

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      {/* Sticky Header */}
      <div
        className="sticky top-0 z-40"
        style={{ background: 'var(--nav-bg)', backdropFilter: 'blur(20px)', borderBottom: '1px solid var(--nav-border)' }}
      >
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <h1 className="font-serif text-2xl text-foreground flex-1">{t('matches.title')}</h1>
          {matches && matches.length > 0 && (
            <span className="glass px-3 py-1 rounded-full text-sm font-semibold text-primary border border-border">
              {matches.length}
            </span>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Stats Row */}
        {stats && (
          <div className="flex gap-2">
            <div className="glass rounded-2xl px-3 py-2 flex-1 text-center border border-border">
              <div className="text-lg font-bold text-foreground">{stats.totalMatches}</div>
              <div className="text-muted-foreground text-xs">{t('matches.total')}</div>
            </div>
            <div className="glass rounded-2xl px-3 py-2 flex-1 text-center border border-border">
              <div className="text-lg font-bold text-foreground">{stats.newMatchesThisWeek}</div>
              <div className="text-muted-foreground text-xs">{t('matches.thisWeek')}</div>
            </div>
            <div className="glass rounded-2xl px-3 py-2 flex-1 text-center border border-border">
              <div className="text-lg font-bold text-foreground">{todayCount}</div>
              <div className="text-muted-foreground text-xs">{t('matches.newToday')}</div>
            </div>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="glass rounded-3xl overflow-hidden aspect-[3/4] animate-pulse border border-border" />
            ))}
          </div>
        )}

        {/* Empty */}
        {!isLoading && (!matches || matches.length === 0) && (
          <div className="glass rounded-3xl p-8 flex flex-col items-center gap-4 border border-border text-center">
            <div className="w-16 h-16 rounded-full glass flex items-center justify-center">
              <MessageCircle className="w-8 h-8 text-primary" />
            </div>
            <h2 className="font-serif text-xl text-foreground">{t('matches.noMatchesTitle')}</h2>
            <p className="text-muted-foreground text-sm">{t('matches.noMatchesDesc')}</p>
            <button
              onClick={() => setLocation('/discover')}
              className="btn-glow px-6 py-3 text-white font-semibold rounded-full"
            >
              {t('matches.goDiscover')}
            </button>
          </div>
        )}

        {/* Match Grid */}
        {!isLoading && matches && matches.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {matches.map(match => {
              const profile = match.otherUser;
              if (!profile) return null;
              const photo = resolveMediaUrl(profile.photos?.[0]?.url) || 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&q=80&w=400';
              const matchDate = match.createdAt
                ? new Date(match.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                : null;

              return (
                <div key={match.id} className="glass rounded-3xl overflow-hidden border border-border relative group">
                  {/* Photo */}
                  <div className="relative aspect-[3/4]">
                    <img src={photo} alt={profile.name} className="w-full h-full object-cover" />
                    {/* Gradient overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

                    {/* Verified badge */}
                    {profile.isVerified && (
                      <div className="absolute top-2 right-2">
                        <ShieldCheck className="w-5 h-5 text-cyan-400 drop-shadow" />
                      </div>
                    )}

                    {/* Bottom info */}
                    <div
                      className="absolute bottom-0 left-0 right-0 rounded-t-xl bg-black/75 p-3"
                      data-testid="match-card-metadata"
                    >
                      <h3
                        className="font-serif text-fixed-dark-foreground font-semibold text-base truncate"
                        data-testid="match-card-name"
                      >
                        {profile.name}{profile.age ? `, ${profile.age}` : ''}
                      </h3>
                      {(profile.city || profile.country) && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 text-fixed-dark-muted-foreground shrink-0" />
                          <span
                            className="text-fixed-dark-muted-foreground text-xs truncate"
                            data-testid="match-card-location"
                          >
                            {[profile.city, profile.country].filter(Boolean).join(', ')}
                          </span>
                        </div>
                      )}
                      {matchDate && (
                        <p className="text-fixed-dark-muted-foreground text-xs mt-0.5">{t('matches.matched', { date: matchDate })}</p>
                      )}
                    </div>
                  </div>

                  {/* Action bar */}
                  <div className="flex items-center gap-2 p-2">
                    <button
                      onClick={() => setLocation(`/messages/${match.conversationId || ''}`)}
                      className="btn-glow flex-1 py-1.5 px-4 text-sm text-white font-semibold rounded-full"
                    >
                      {t('matches.message')}
                    </button>
                    <button
                      onClick={() => setActiveSheet(activeSheet === match.id ? null : match.id)}
                      aria-label={`More actions for ${profile.name}`}
                      className="w-8 h-8 rounded-full glass border border-border flex items-center justify-center text-foreground hover:glass-strong transition-all"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Bottom sheet */}
                  <AnimatePresence>
                    {activeSheet === match.id && (
                      <>
                        <motion.div
                          className="fixed inset-0 z-40"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          onClick={() => setActiveSheet(null)}
                        />
                        <motion.div
                          className="fixed bottom-0 left-0 right-0 z-50 glass-strong rounded-t-3xl p-6 border-t border-border"
                          initial={{ y: '100%' }}
                          animate={{ y: 0 }}
                          exit={{ y: '100%' }}
                          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                          style={{ background: 'rgba(15,0,40,0.95)', backdropFilter: 'blur(30px)' }}
                        >
                          <div className="w-10 h-1 rounded-full bg-muted mx-auto mb-6" />
                          <p className="font-serif text-fixed-dark-foreground text-lg text-center mb-4">{profile.name}</p>
                          <div className="space-y-2">
                            <button
                              onClick={() => { setActiveSheet(null); setLocation(`/messages/${match.conversationId || ''}`); }}
                              className="w-full glass border border-border rounded-full px-4 py-3 text-foreground text-left flex items-center gap-3 hover:glass-strong transition-all"
                            >
                              <MessageCircle className="w-5 h-5 text-cyan-400" />
                              <span>{t('matches.sendMessage')}</span>
                            </button>
                            <button
                              onClick={() => handleReport({
                                supabaseUserId: profile.userId,
                                name: profile.name,
                              })}
                              disabled={reportCandidate?.supabaseUserId === profile.userId}
                              aria-busy={reportCandidate?.supabaseUserId === profile.userId}
                              className="w-full glass border border-border rounded-full px-4 py-3 text-foreground text-left flex items-center gap-3 hover:glass-strong transition-all"
                            >
                              {reportCandidate?.supabaseUserId === profile.userId
                                ? <Loader2 className="w-5 h-5 text-yellow-400 animate-spin" />
                                : <Flag className="w-5 h-5 text-yellow-400" />}
                              <span>{t('matches.report')}</span>
                            </button>
                            <button
                              disabled
                              title={SUPABASE_BLOCK_UNAVAILABLE}
                              aria-describedby={`block-unavailable-${match.id}`}
                              className="w-full glass border border-border rounded-full px-4 py-3 text-foreground/40 text-left flex items-center gap-3 cursor-not-allowed"
                            >
                              <UserX className="w-5 h-5 text-orange-400/50" />
                              <span>{t('matches.block')}</span>
                            </button>
                            <p id={`block-unavailable-${match.id}`} className="px-2 pb-1 text-xs leading-snug text-fixed-dark-muted-foreground" role="note">
                              {SUPABASE_BLOCK_UNAVAILABLE}
                            </p>
                            <button
                              disabled
                              title={SUPABASE_UNMATCH_UNAVAILABLE}
                              aria-describedby={`unmatch-unavailable-${match.id}`}
                              className="w-full glass border border-primary/20 rounded-full px-4 py-3 text-primary/40 text-left flex items-center gap-3 cursor-not-allowed"
                            >
                              <UserX className="w-5 h-5" />
                              <span>{t('matches.unmatch')}</span>
                            </button>
                            <span id={`unmatch-unavailable-${match.id}`} className="sr-only">
                              {SUPABASE_UNMATCH_UNAVAILABLE}
                            </span>
                            <p className="px-2 pt-1 text-xs leading-snug text-fixed-dark-muted-foreground" role="note">
                              {SUPABASE_UNMATCH_UNAVAILABLE}
                            </p>
                          </div>
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {reportTarget && (
        <ReportUserModal
          isOpen
          onClose={() => setReportTarget(null)}
          reportedUserId={reportTarget.localUserId}
          reportedUserName={reportTarget.name}
          onSuccess={handleReportSuccess}
        />
      )}
    </div>
  );
}

import { useState } from 'react';
import { resolveMediaUrl } from '@/lib/media-url';
import { useGetCulturalLeaderboard } from '@workspace/api-client-react';
import { ChevronLeft, Trophy } from 'lucide-react';
type FilterTab = 'Passport' | 'Engagement' | 'Total';

interface LeaderEntry {
  rank: number;
  name: string;
  country: string;
  flag: string;
  passportScore: number;
  engagementScore: number;
  totalScore: number;
  avatar: string;
  isCurrentUser?: boolean;
}

function getScore(entry: LeaderEntry, tab: FilterTab) {
  if (tab === 'Passport') return entry.passportScore;
  if (tab === 'Engagement') return entry.engagementScore;
  return entry.totalScore;
}

const PODIUM_MEDAL = ['👑', '🥈', '🥉'];
const PODIUM_COLORS = ['rgba(253,224,71,0.15)', 'rgba(156,163,175,0.12)', 'rgba(217,119,6,0.12)'];
const PODIUM_BORDER = ['border-yellow-400/40', 'border-border', 'border-orange-400/30'];

export default function Leaderboard() {
  const [tab, setTab] = useState<FilterTab>('Passport');
  const { data: leaders } = useGetCulturalLeaderboard();

  // Map the persisted leaderboard into the display shape. Avatars fall back to
  // the initial-letter tile the UI already renders.
  const allEntries: LeaderEntry[] = (leaders ?? []).map((row) => ({
    rank: row.rank,
    name: row.name || 'Explorer',
    country: row.country ?? '',
    flag: '🌍',
    passportScore: row.passportScore,
    engagementScore: row.engagementScore,
    totalScore: row.totalScore,
    avatar: '',
    isCurrentUser: row.isCurrentUser,
  }));

  // Sort by selected tab
  const sorted = [...allEntries].sort((a, b) => getScore(b, tab) - getScore(a, tab));
  // Re-rank
  sorted.forEach((e, i) => { e.rank = i + 1; });

  const top3 = sorted.slice(0, 3);
  const rest = sorted.slice(3);

  // Podium order: 2nd, 1st, 3rd
  const podiumOrder = [top3[1], top3[0], top3[2]].filter(Boolean);

  const tabs: FilterTab[] = ['Passport', 'Engagement', 'Total'];

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      {/* Sticky Header */}
      <div
        className="sticky top-0 z-40"
        style={{ background: 'var(--nav-bg)', backdropFilter: 'blur(20px)', borderBottom: '1px solid var(--nav-border)' }}
      >
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => window.history.back()}
            className="w-9 h-9 rounded-full glass flex items-center justify-center border border-border"
          >
            <ChevronLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="font-serif text-2xl text-foreground flex-1">Leaderboard</h1>
          <Trophy className="w-6 h-6 text-yellow-400" />
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-5">
        {/* Filter Tabs */}
        <div className="flex gap-2">
          {tabs.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-full text-sm font-medium transition-all border ${
                tab === t
                  ? 'bg-primary/20 text-primary border-primary/30'
                  : 'glass border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Top 3 Podium */}
        <div className="flex items-end justify-center gap-3">
          {podiumOrder.map((entry, pIdx) => {
            const originalRank = top3.findIndex(e => e === entry);
            const medal = PODIUM_MEDAL[originalRank];
            const bgColor = PODIUM_COLORS[originalRank];
            const borderClass = PODIUM_BORDER[originalRank];
            const isCenter = originalRank === 0;
            const score = getScore(entry, tab);

            return (
              <div
                key={entry.name}
                className={`flex-1 glass rounded-3xl p-3 flex flex-col items-center gap-2 border ${borderClass} ${isCenter ? 'pb-5' : ''}`}
                style={{ background: bgColor }}
              >
                <span className="text-xl">{medal}</span>
                <div className={`rounded-full overflow-hidden border-2 ${isCenter ? 'w-14 h-14 border-yellow-400/60' : 'w-12 h-12 border-border'}`}>
                  {entry.avatar ? (
                    <img src={resolveMediaUrl(entry.avatar)} alt={entry.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full glass flex items-center justify-center text-lg">
                      {entry.name.charAt(0)}
                    </div>
                  )}
                </div>
                <div className="text-foreground text-xs font-semibold text-center truncate w-full">{entry.name.split(' ')[0]}</div>
                <div className="text-primary text-xs font-bold">{score}</div>
              </div>
            );
          })}
        </div>

        {/* Ranked list */}
        <div className="space-y-2">
          {rest.map(entry => {
            const score = getScore(entry, tab);
            return (
              <div
                key={`${entry.name}-${entry.rank}`}
                className={`rounded-2xl p-3 flex items-center gap-3 border transition-all ${
                  entry.isCurrentUser
                    ? 'glass-strong border-primary/40 glow-pink'
                    : 'glass border-border'
                }`}
              >
                {/* Rank */}
                <div className="w-7 text-center text-muted-foreground text-sm font-bold">
                  {entry.rank}
                </div>

                {/* Avatar */}
                <div className="w-10 h-10 rounded-full overflow-hidden border border-border shrink-0">
                  {entry.avatar ? (
                    <img src={resolveMediaUrl(entry.avatar)} alt={entry.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full glass flex items-center justify-center text-foreground text-sm font-bold">
                      {entry.name.charAt(0)}
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground text-sm font-semibold truncate">{entry.name}</span>
                    {entry.isCurrentUser && (
                      <span className="text-primary text-xs font-bold glass px-1.5 py-0.5 rounded-full border border-primary/30">You</span>
                    )}
                  </div>
                  <div className="text-muted-foreground text-xs">{entry.flag} {entry.country}</div>
                </div>

                {/* Score */}
                <div className="glass border border-border px-2 py-1 rounded-full text-primary text-xs font-bold">
                  {score}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer note */}
        <p className="text-muted-foreground text-xs text-center pb-2">Rankings updated weekly</p>
      </div>
    </div>
  );
}

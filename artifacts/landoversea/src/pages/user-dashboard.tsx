import {
  useGetCurrentUser,
  useGetMatchStats,
  useGetProfileCompletion,
  useGetLanguageStreak,
  useGetMySubscription,
  useGetCulturalPassport,
  useGetMatches,
} from '@workspace/api-client-react';
import { resolveMediaUrl } from '@/lib/media-url';
import {
  Heart,
  MessageCircle,
  Eye,
  Flame,
  Globe,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { Link } from 'wouter';

export default function UserDashboard() {
  const { data: user, isLoading: userLoading } = useGetCurrentUser();
  const { data: stats } = useGetMatchStats();
  const { data: completion } = useGetProfileCompletion();
  const { data: streak } = useGetLanguageStreak();
  const { data: subscription } = useGetMySubscription();
  const { data: passport } = useGetCulturalPassport();
  const { data: matches } = useGetMatches();

  const isPremium = user?.isPremium || subscription?.status === 'active';

  const recentMatches = (matches ?? []).slice(0, 5);

  if (userLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const completionPct = completion?.percent ?? 0;

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-5">
        {/* Greeting */}
        <div>
          <h1 className="font-serif text-2xl text-foreground">
            Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Let's find your cultural match.</p>
        </div>

        {/* Profile Completion */}
        {completion && (
          <div className="glass rounded-2xl p-4 border border-border space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-foreground font-semibold text-sm">Profile Strength</span>
              <span className="text-xs font-bold text-primary glass px-2 py-0.5 rounded-full border border-primary/30">
                {completionPct}%
              </span>
            </div>
            {/* Progress bar */}
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${completionPct}%`,
                  background: 'linear-gradient(90deg, #FF2D7A, #8B5CF6)',
                  transition: 'width 0.6s ease',
                }}
              />
            </div>
            {completionPct < 80 && completion.missedSteps.length > 0 && (
              <p className="text-muted-foreground text-xs">
                Tip: Add your {completion.missedSteps[0].replace(/_/g, ' ')} to boost visibility.
              </p>
            )}
          </div>
        )}

        {/* Stats 2×2 grid */}
        {stats && (
          <div className="grid grid-cols-2 gap-3">
            <div className="glass rounded-2xl p-4 border border-border flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,45,122,0.15)' }}>
                <Heart className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="text-foreground font-bold text-lg leading-none">{stats.totalMatches}</div>
                <div className="text-muted-foreground text-xs mt-0.5">Matches</div>
              </div>
            </div>
            <div className="glass rounded-2xl p-4 border border-border flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(99,230,255,0.12)' }}>
                <MessageCircle className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <div className="text-foreground font-bold text-lg leading-none">{stats.activeConversations}</div>
                <div className="text-muted-foreground text-xs mt-0.5">Messages</div>
              </div>
            </div>
            <div className="glass rounded-2xl p-4 border border-border flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.15)' }}>
                <Eye className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <div className="text-foreground font-bold text-lg leading-none">{stats.newMatchesThisWeek}</div>
                <div className="text-muted-foreground text-xs mt-0.5">Profile Views</div>
              </div>
            </div>
            <div className="glass rounded-2xl p-4 border border-border flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(249,115,22,0.15)' }}>
                <Flame className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <div className="text-foreground font-bold text-lg leading-none">{streak?.currentStreak ?? 0}</div>
                <div className="text-muted-foreground text-xs mt-0.5">Days Active</div>
              </div>
            </div>
          </div>
        )}

        {/* Recent Connections */}
        {recentMatches.length > 0 && (
          <div className="glass rounded-2xl p-4 border border-border space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-foreground text-lg">Recent Connections</h2>
              <Link href="/matches" className="text-muted-foreground text-xs hover:text-primary transition-colors">
                View all →
              </Link>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {recentMatches.map(match => {
                const profile = match.otherUser;
                if (!profile) return null;
                const photo = resolveMediaUrl(profile.photos?.[0]?.url) || 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&q=80&w=200';
                return (
                  <Link key={match.id} href={`/messages/${match.conversationId || ''}`} className="shrink-0 flex flex-col items-center gap-1">
                    <div className="w-14 h-14 rounded-full border-2 border-primary/60 overflow-hidden glow-pink">
                      <img src={photo} alt={profile.name} className="w-full h-full object-cover" />
                    </div>
                    <span className="text-muted-foreground text-xs truncate max-w-[56px] text-center">{profile.name.split(' ')[0]}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Premium Card */}
        {!isPremium ? (
          <div className="glass rounded-2xl p-5 border border-primary/40 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(253,224,71,0.15)' }}>
                <Sparkles className="w-5 h-5 text-yellow-400" />
              </div>
              <div>
                <h3 className="font-serif text-foreground text-base">Upgrade Premium</h3>
                <p className="text-muted-foreground text-xs">Unlock all features</p>
              </div>
            </div>
            <ul className="space-y-1.5">
              {['See who likes you', 'Unlimited swipes', 'Priority in discovery'].map(f => (
                <li key={f} className="flex items-center gap-2 text-foreground text-sm">
                  <span className="text-primary text-xs">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <Link href="/premium">
              <button className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full">
                Go Premium
              </button>
            </Link>
          </div>
        ) : (
          <div className="rounded-2xl p-4 border border-emerald-400/30 flex items-center gap-3" style={{ background: 'rgba(16,185,129,0.08)' }}>
            <span className="text-emerald-400 text-lg">✓</span>
            <span className="text-emerald-400 font-semibold text-sm">Premium Active</span>
          </div>
        )}

        {/* Language Streak */}
        {streak && (
          <Link href="/learn" className="block">
            <div className="glass rounded-2xl p-4 border border-border flex items-center gap-4 hover:glass-strong transition-all">
              <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(249,115,22,0.15)' }}>
                <Flame className="w-6 h-6 text-orange-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-foreground font-semibold text-sm">
                  {streak.currentStreak} <span className="text-muted-foreground font-normal">Day streak</span>
                </div>
                <div className="text-muted-foreground text-xs mt-0.5">Level {streak.level} · {streak.xpTotal} XP total</div>
              </div>
              <span className="text-muted-foreground text-xs">→</span>
            </div>
          </Link>
        )}

        {/* Cultural Passport */}
        {passport && (
          <Link href="/cultural" className="block">
            <div className="glass rounded-2xl p-4 border border-border flex items-center gap-4 hover:glass-strong transition-all">
              <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(99,230,255,0.12)' }}>
                <Globe className="w-6 h-6 text-cyan-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-foreground font-semibold text-sm">
                  {passport.stampCount} <span className="text-muted-foreground font-normal">stamps</span>
                </div>
                <div className="text-muted-foreground text-xs mt-0.5">
                  Level {passport.level} · {passport.countriesVisited.length} countries
                </div>
              </div>
              <span className="text-muted-foreground text-xs">→</span>
            </div>
          </Link>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Discover', href: '/discover', emoji: '🔍' },
            { label: 'Coaches', href: '/coaches', emoji: '🎓' },
            { label: 'Events', href: '/events', emoji: '🎉' },
            { label: 'Ranks', href: '/leaderboard', emoji: '🏆' },
          ].map(({ label, href, emoji }) => (
            <Link key={href} href={href}>
              <div className="glass border border-border rounded-2xl p-3 text-center hover:glass-strong transition-all cursor-pointer">
                <div className="text-xl mb-1">{emoji}</div>
                <div className="text-muted-foreground text-xs">{label}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

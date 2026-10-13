import { useState } from 'react';
import { resolveMediaUrl } from '@/lib/media-url';
import { Link } from 'wouter';
import {
  useGetMyCoachProfile,
} from '@workspace/api-client-react';
import {
  Loader2,
  Bot,
  MessageSquare,
  UserCheck,
  ShieldCheck,
  Search,
  Star,
  BarChart2,
} from 'lucide-react';
import { useApprovedCoaches } from '@/hooks/use-supabase-surfaces';

export default function Coaches() {
  const [search, setSearch] = useState('');
  const { data: coaches, isLoading, isError } = useApprovedCoaches();
  const { data: myCoachProfile } = useGetMyCoachProfile();

  const filtered = coaches?.filter(c =>
    !search ||
    c.displayName.toLowerCase().includes(search.toLowerCase()) ||
    c.specialties?.some((s: string) => s.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      {/* Sticky Header */}
      <div
        className="sticky top-0 z-40 px-4 py-3 flex items-center justify-between"
        style={{
          background: 'var(--nav-bg)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--nav-border)',
        }}
      >
        <span
          className="font-script text-[22px] bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent"
        >
          Coaching
        </span>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Feature Shortcut Grid */}
        <div className="grid grid-cols-2 gap-3">
          <Link href="/coaches/ai">
            <div className="rounded-2xl border border-violet-300/20 bg-gradient-to-br from-violet-800/95 to-[#14082b]/95 p-5 shadow-lg shadow-violet-950/20 cursor-pointer hover:scale-[1.02] transition-transform">
              <Bot className="w-8 h-8 text-violet-300 mb-3" />
              <h3 className="font-serif text-lg text-fixed-dark-foreground">AI Coach</h3>
              <p className="text-fixed-dark-muted-foreground text-sm mt-1">Chat with Luna 24/7</p>
            </div>
          </Link>
          <Link href="/coaches/conversation">
            <div className="rounded-2xl border border-pink-300/20 bg-gradient-to-br from-pink-800/95 to-[#14082b]/95 p-5 shadow-lg shadow-pink-950/20 cursor-pointer hover:scale-[1.02] transition-transform">
              <MessageSquare className="w-8 h-8 text-pink-300 mb-3" />
              <h3 className="font-serif text-lg text-fixed-dark-foreground">Conversation Coach</h3>
              <p className="text-fixed-dark-muted-foreground text-sm mt-1">Get reply suggestions</p>
            </div>
          </Link>
          <Link href="/coaches/profile-coach">
            <div className="rounded-2xl border border-cyan-300/20 bg-gradient-to-br from-cyan-900/95 to-[#14082b]/95 p-5 shadow-lg shadow-cyan-950/20 cursor-pointer hover:scale-[1.02] transition-transform">
              <UserCheck className="w-8 h-8 text-cyan-300 mb-3" />
              <h3 className="font-serif text-lg text-fixed-dark-foreground">Profile Coach</h3>
              <p className="text-fixed-dark-muted-foreground text-sm mt-1">Optimize your profile</p>
            </div>
          </Link>
          <Link href="/coaches/safety-advice">
            <div className="rounded-2xl border border-orange-300/20 bg-gradient-to-br from-orange-900/95 to-[#14082b]/95 p-5 shadow-lg shadow-orange-950/20 cursor-pointer hover:scale-[1.02] transition-transform">
              <ShieldCheck className="w-8 h-8 text-orange-300 mb-3" />
              <h3 className="font-serif text-lg text-fixed-dark-foreground">Safety Advice</h3>
              <p className="text-fixed-dark-muted-foreground text-sm mt-1">Stay safe across cultures</p>
            </div>
          </Link>
        </div>

        {/* Context Card */}
        {myCoachProfile ? (
          <Link href="/coach-dashboard">
            <div className="rounded-2xl border border-white/15 bg-[#170a31]/90 p-4 flex items-center gap-3 cursor-pointer hover:bg-[#211043] transition-colors backdrop-blur-xl">
              <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center">
                <BarChart2 className="w-5 h-5 text-cyan-400" />
              </div>
              <div className="flex-1">
                <p className="font-serif text-fixed-dark-foreground text-base">Coach Dashboard</p>
                <p className="text-fixed-dark-muted-foreground text-sm">View your coaching stats</p>
              </div>
              <span className="text-fixed-dark-muted-foreground text-sm">→</span>
            </div>
          </Link>
        ) : (
          <Link href="/coaches/apply">
            <div className="rounded-2xl border border-white/15 bg-[#170a31]/90 p-4 flex items-center gap-3 cursor-pointer hover:bg-[#211043] transition-colors backdrop-blur-xl">
              <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
                <Star className="w-5 h-5 text-yellow-400" />
              </div>
              <div className="flex-1">
                <p className="font-serif text-fixed-dark-foreground text-base">Become a Coach</p>
                <p className="text-fixed-dark-muted-foreground text-sm">Share your cultural expertise</p>
              </div>
              <span className="text-fixed-dark-muted-foreground text-sm">→</span>
            </div>
          </Link>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fixed-dark-muted-foreground" />
          <input
            type="text"
            placeholder="Search coaches..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="rounded-full border border-white/15 bg-[#16092f]/90 px-4 py-2 pl-9 w-full text-fixed-dark-foreground outline-none placeholder:text-fixed-dark-muted-foreground placeholder:opacity-100 text-sm focus:border-primary/70 focus:ring-2 focus:ring-primary/25"
          />
        </div>

        {/* Coach List */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : isError ? (
          <div className="rounded-2xl border border-white/15 bg-[#170a31]/90 p-8 text-center" role="alert">
            <div className="w-12 h-12 rounded-full glass flex items-center justify-center mx-auto mb-3">
              <Search className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="font-serif text-fixed-dark-foreground text-lg mb-1">Coaches are unavailable</h3>
            <p className="text-fixed-dark-muted-foreground text-sm">Please try again in a moment. The coaching tools above are still available.</p>
          </div>
        ) : filtered?.length === 0 ? (
          <div className="rounded-2xl border border-white/15 bg-[#170a31]/90 p-8 text-center">
            <div className="w-12 h-12 rounded-full glass flex items-center justify-center mx-auto mb-3">
              <Search className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="font-serif text-fixed-dark-foreground text-lg mb-1">
              {search ? 'No coaches found' : 'Human coaches coming soon'}
            </h3>
            <p className="text-fixed-dark-muted-foreground text-sm">
              {search ? 'Try a different search term' : 'Explore the coaching tools above while our expert network grows.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered?.map(coach => (
              <div key={coach.id} className="rounded-2xl border border-white/15 bg-[#170a31]/90 p-4 flex gap-3 backdrop-blur-xl">
                <img
                  src={resolveMediaUrl(coach.photoUrl) || `https://ui-avatars.com/api/?name=${encodeURIComponent(coach.displayName)}&background=8B5CF6&color=fff`}
                  alt={coach.displayName}
                  className="w-16 h-16 rounded-full border-2 border-primary/40 object-cover shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="font-serif text-fixed-dark-foreground text-base leading-tight">{coach.displayName}</h3>
                    <div className="flex items-center gap-1 shrink-0">
                      <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                      <span className="text-yellow-400 text-sm font-medium">{coach.rating?.toFixed(1) || 'New'}</span>
                      {coach.reviewCount ? (
                        <span className="text-fixed-dark-muted-foreground text-xs">({coach.reviewCount})</span>
                      ) : null}
                    </div>
                  </div>

                  {/* Specialty pill */}
                  {coach.specialties?.[0] && (
                    <span className="inline-block px-2 py-0.5 rounded-full bg-muted text-xs text-foreground border border-border mb-2">
                      {coach.specialties[0]}
                    </span>
                  )}

                  {/* Languages */}
                  {coach.languages && coach.languages.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {coach.languages.slice(0, 3).map((lang: string) => (
                        <span key={lang} className="px-1.5 py-0.5 rounded-full bg-white/[0.07] text-xs text-fixed-dark-foreground border border-white/15">
                          {lang}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    {coach.ratesPerHour && (
                      <span className="text-fixed-dark-muted-foreground text-xs">${coach.ratesPerHour}/hr</span>
                    )}
                    <Link href={`/coaches/${coach.id}`} className="btn-glow px-4 py-1.5 text-white text-xs font-semibold rounded-full inline-flex items-center">
                      View Profile
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

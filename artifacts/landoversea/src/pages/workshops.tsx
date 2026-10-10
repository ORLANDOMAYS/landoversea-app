import { useState } from 'react';
import { useGetWorkshops, useEnrollWorkshop } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Users, CalendarDays, ChevronLeft, CheckCircle2, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Link, useLocation } from 'wouter';

const FILTER_PILLS = ['All', 'This Week', 'Beginner', 'Intermediate', 'Advanced', 'Language', 'Culture'];

function matchesFilter(workshop: any, filter: string, search: string): boolean {
  const title = (workshop.title || '').toLowerCase();
  const desc = (workshop.description || '').toLowerCase();
  const q = search.toLowerCase();

  if (search && !title.includes(q) && !desc.includes(q)) return false;

  if (filter === 'All') return true;
  if (filter === 'This Week') {
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + 7);
    const d = new Date(workshop.scheduledAt);
    return d >= now && d <= end;
  }
  return title.includes(filter.toLowerCase()) || desc.includes(filter.toLowerCase());
}

export default function Workshops() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { data: workshops, isLoading } = useGetWorkshops({ limit: 50 });
  const enrollMutation = useEnrollWorkshop();
  const [enrollingId, setEnrollingId] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState('All');
  const [search, setSearch] = useState('');

  const handleEnroll = (e: React.MouseEvent, workshopId: number) => {
    e.stopPropagation();
    setEnrollingId(workshopId);
    enrollMutation.mutate(
      { workshopId },
      {
        onSuccess: () => {
          toast({ title: 'Enrolled! 🎉' });
          queryClient.invalidateQueries({ queryKey: ['/api/workshops'] });
          setEnrollingId(null);
        },
        onError: (err: any) => {
          const message = err?.response?.data?.error || err?.message || 'Failed to enroll';
          toast({ title: 'Error', description: message, variant: 'destructive' });
          setEnrollingId(null);
        },
      }
    );
  };

  const filtered = (workshops || []).filter((w) => matchesFilter(w, activeFilter, search));

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-40 px-4 py-3 flex items-center gap-3"
        style={{ background: 'var(--nav-bg)', backdropFilter: 'blur(20px)', borderBottom: '1px solid var(--nav-border)' }}
      >
        <button onClick={() => navigate('/')} className="w-9 h-9 rounded-full glass flex items-center justify-center shrink-0">
          <ChevronLeft className="w-5 h-5 text-foreground" />
        </button>
        <h1 className="font-serif text-xl text-foreground flex-1">Group Workshops</h1>
        <Users className="w-5 h-5 text-[#8B5CF6]" />
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search workshops..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="glass-input w-full rounded-full px-4 py-2 pl-9 text-sm placeholder:text-muted-foreground outline-none"
          />
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {FILTER_PILLS.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-all font-medium ${
                activeFilter === f
                  ? 'bg-[#8B5CF6]/20 border-[#8B5CF6] text-[#8B5CF6]'
                  : 'glass border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-[#FF2D7A]" />
          </div>
        )}

        {/* Empty */}
        {!isLoading && filtered.length === 0 && (
          <div className="glass rounded-2xl p-8 text-center">
            <div className="w-14 h-14 rounded-full glass flex items-center justify-center mx-auto mb-4">
              <Users className="w-7 h-7 text-[#8B5CF6]" />
            </div>
            <h2 className="font-serif text-foreground text-lg mb-2">No Workshops Found</h2>
            <p className="text-muted-foreground text-sm">Check back soon for upcoming sessions.</p>
          </div>
        )}

        {/* Workshop cards */}
        {!isLoading && filtered.map((workshop) => {
          const enrolled = workshop.isEnrolled;
          const current = workshop.currentParticipants ?? 0;
          const max = workshop.maxParticipants;
          const isFull = current >= max;
          const fillPct = Math.min(100, Math.round((current / max) * 100));
          const barColor = fillPct > 80 ? 'bg-red-500' : 'bg-[#FF2D7A]';

          return (
            <div
              key={workshop.id}
              onClick={() => navigate(`/workshops/${workshop.id}`)}
              className="glass rounded-2xl overflow-hidden cursor-pointer hover:glass-strong transition-all"
            >
              {/* Gradient placeholder hero */}
              <div
                className="h-40 flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(88,28,135,0.2))' }}
              >
                <Users className="w-10 h-10 text-[#8B5CF6]" />
              </div>

              <div className="p-4">
                {/* Badges row */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="glass px-2 py-0.5 rounded-full text-xs text-[#8B5CF6] border border-[#8B5CF6]/30">
                    Workshop
                  </span>
                  <span className="glass px-2 py-0.5 rounded-full text-xs text-[#63E6FF] border border-[#63E6FF]/30">
                    {workshop.price ? `$${workshop.price}` : 'Free'}
                  </span>
                </div>

                <h2 className="font-serif text-lg text-foreground mb-2 leading-snug">{workshop.title}</h2>

                <div className="flex items-center gap-1.5 mb-1">
                  <CalendarDays className="w-4 h-4 text-[#63E6FF]" />
                  <span className="text-muted-foreground text-sm">
                    {new Date(workshop.scheduledAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                {workshop.coach && (
                  <p className="text-muted-foreground text-sm mb-3">with {workshop.coach.displayName}</p>
                )}

                {/* Capacity bar */}
                <div className="mb-3">
                  <div className="flex justify-between mb-1">
                    <span className="text-muted-foreground text-xs">{current}/{max} enrolled</span>
                    <span className="text-muted-foreground text-xs">{fillPct}% full</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${fillPct}%` }} />
                  </div>
                </div>

                {/* CTA */}
                <div className="flex items-center gap-2">
                  {enrolled ? (
                    <>
                      <span className="glass border border-green-500/30 text-green-400 text-xs px-3 py-1.5 rounded-full font-medium">
                        Enrolled ✓
                      </span>
                      <Link
                        href={`/workshops/${workshop.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        View →
                      </Link>
                    </>
                  ) : isFull ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleEnroll(e, workshop.id); }}
                      disabled={enrollingId === workshop.id}
                      className="glass border border-border rounded-full px-3 py-1.5 text-muted-foreground text-xs opacity-70"
                    >
                      Waitlist
                    </button>
                  ) : (
                    <button
                      onClick={(e) => handleEnroll(e, workshop.id)}
                      disabled={enrollingId === workshop.id}
                      className="btn-glow px-4 py-1.5 text-white text-xs font-semibold rounded-full flex items-center gap-1"
                    >
                      {enrollingId === workshop.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        'Join'
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { useParams, useLocation } from 'wouter';
import { resolveMediaUrl } from '@/lib/media-url';
import { useGetWorkshop, useEnrollWorkshop } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  ChevronLeft,
  CalendarDays,
  Clock,
  BarChart2,
  Users,
  CheckCircle,
  Star,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function WorkshopDetail() {
  const { workshopId } = useParams<{ workshopId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const id = Number(workshopId);
  const { data: workshop, isLoading, refetch } = useGetWorkshop(id);
  const enrollMutation = useEnrollWorkshop();

  const handleEnroll = () => {
    enrollMutation.mutate(
      { workshopId: id },
      {
        onSuccess: () => {
          toast({ title: 'Enrolled! 🎉', description: 'You have joined this workshop.' });
          queryClient.invalidateQueries({ queryKey: [`/api/workshops/${id}`] });
          queryClient.invalidateQueries({ queryKey: ['/api/workshops'] });
          refetch();
        },
        onError: (err: any) => {
          const message = err?.response?.data?.error || err?.message || 'Failed to enroll';
          toast({ title: 'Error', description: message, variant: 'destructive' });
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#FF2D7A]" />
      </div>
    );
  }

  if (!workshop) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center px-4">
        <div className="glass rounded-2xl p-8 text-center max-w-sm w-full">
          <div className="w-14 h-14 rounded-full glass flex items-center justify-center mx-auto mb-4">
            <Users className="w-7 h-7 text-muted-foreground" />
          </div>
          <h2 className="font-serif text-foreground text-lg mb-2">Workshop Not Found</h2>
          <p className="text-muted-foreground text-sm mb-4">This workshop may no longer be available.</p>
          <button onClick={() => navigate('/workshops')} className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full">
            Back to Workshops
          </button>
        </div>
      </div>
    );
  }

  const current = workshop.currentParticipants ?? 0;
  const max = workshop.maxParticipants;
  const isFull = current >= max;
  const fillPct = Math.min(100, Math.round((current / max) * 100));
  const barColor = fillPct > 80 ? 'bg-red-500' : 'bg-[#FF2D7A]';
  const enrolled = workshop.isEnrolled;

  const scheduledDate = new Date(workshop.scheduledAt);

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      {/* Hero */}
      <div className="relative">
        <div
          className="h-56 w-full flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.3), rgba(88,28,135,0.3), rgba(255,45,122,0.15))' }}
        >
          <Users className="w-16 h-16 text-[#8B5CF6]" />
        </div>
        {/* Back button over hero */}
        <button
          onClick={() => navigate('/workshops')}
          className="absolute top-4 left-4 w-9 h-9 rounded-full glass flex items-center justify-center"
        >
          <ChevronLeft className="w-5 h-5 text-foreground" />
        </button>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Badges + Title */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="glass px-2 py-0.5 rounded-full text-xs text-[#8B5CF6] border border-[#8B5CF6]/30">
              Workshop
            </span>
            <span className="glass px-2 py-0.5 rounded-full text-xs text-[#63E6FF] border border-[#63E6FF]/30">
              {workshop.price ? `$${workshop.price}` : 'Free'}
            </span>
          </div>
          <h1 className="font-serif text-2xl text-foreground">{workshop.title}</h1>
        </div>

        {/* Coach card */}
        {workshop.coach && (
          <div className="glass rounded-2xl p-4 flex items-center gap-3">
            {workshop.coach.photoUrl ? (
              <img src={resolveMediaUrl(workshop.coach.photoUrl)} alt={workshop.coach.displayName} className="w-10 h-10 rounded-full object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-full glass flex items-center justify-center text-muted-foreground">
                <Users className="w-5 h-5" />
              </div>
            )}
            <div className="flex-1">
              <p className="text-foreground font-semibold text-sm">Led by {workshop.coach.displayName}</p>
              {workshop.coach.rating && (
                <div className="flex items-center gap-1 mt-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`w-3 h-3 ${i < Math.round(workshop.coach!.rating!) ? 'text-yellow-400 fill-yellow-400' : 'text-muted-foreground'}`}
                    />
                  ))}
                  <span className="text-muted-foreground text-xs ml-1">{workshop.coach.rating.toFixed(1)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="glass rounded-2xl p-3">
            <div className="flex items-center gap-2 mb-1">
              <CalendarDays className="w-4 h-4 text-[#63E6FF]" />
              <span className="text-muted-foreground text-xs">Date</span>
            </div>
            <p className="text-foreground text-sm font-medium">
              {scheduledDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
            <p className="text-muted-foreground text-xs">{scheduledDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
          </div>
          <div className="glass rounded-2xl p-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-[#8B5CF6]" />
              <span className="text-muted-foreground text-xs">Duration</span>
            </div>
            <p className="text-foreground text-sm font-medium">
              {workshop.durationMinutes ? `${workshop.durationMinutes} min` : 'TBD'}
            </p>
          </div>
          <div className="glass rounded-2xl p-3">
            <div className="flex items-center gap-2 mb-1">
              <BarChart2 className="w-4 h-4 text-[#FF2D7A]" />
              <span className="text-muted-foreground text-xs">Level</span>
            </div>
            <p className="text-foreground text-sm font-medium">All Levels</p>
          </div>
          <div className="glass rounded-2xl p-3">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-yellow-400" />
              <span className="text-muted-foreground text-xs">Capacity</span>
            </div>
            <p className="text-foreground text-sm font-medium">{current}/{max}</p>
          </div>
        </div>

        {/* Capacity bar */}
        <div className="glass rounded-2xl p-4">
          <div className="flex justify-between mb-2">
            <span className="text-muted-foreground text-xs">{current} enrolled of {max} spots</span>
            <span className="text-muted-foreground text-xs">{fillPct}% full</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${fillPct}%` }} />
          </div>
        </div>

        {/* About */}
        {workshop.description && (
          <div>
            <h3 className="font-serif text-foreground text-lg mb-2">About This Workshop</h3>
            <p className="text-foreground text-sm leading-relaxed">{workshop.description}</p>
          </div>
        )}

        {/* What You'll Learn */}
        <div>
          <h3 className="font-serif text-foreground text-lg mb-3">What You'll Learn</h3>
          <div className="space-y-2">
            {['Cross-cultural communication strategies', 'Building authentic connections across borders', 'Understanding cultural nuances in dating', 'Practical conversation techniques'].map((topic) => (
              <div key={topic} className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-[#63E6FF] shrink-0 mt-0.5" />
                <span className="text-foreground text-sm">{topic}</span>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="pt-2 pb-4">
          {enrolled ? (
            <div className="space-y-3">
              <div className="glass-strong rounded-2xl p-3 flex items-center justify-center gap-2 border border-green-500/30">
                <CheckCircle className="w-5 h-5 text-green-400" />
                <span className="text-green-400 font-semibold">Enrolled!</span>
              </div>
              {workshop.zoomLink ? (
                <a
                  href={workshop.zoomLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full inline-flex items-center justify-center"
                >
                  Join Workshop Session
                </a>
              ) : (
                <div className="space-y-1">
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="glass border border-border rounded-full px-6 py-3 w-full text-muted-foreground font-semibold cursor-not-allowed"
                  >
                    Workshop Session
                  </button>
                  <p className="text-muted-foreground text-xs text-center">
                    The session link isn't available yet — it will appear here before the workshop begins.
                  </p>
                </div>
              )}
            </div>
          ) : isFull ? (
            <div className="space-y-2">
              <button
                onClick={handleEnroll}
                disabled={enrollMutation.isPending}
                className="glass border border-border rounded-full px-6 py-3 w-full hover:glass-strong transition-all text-foreground font-semibold flex items-center justify-center gap-2"
              >
                {enrollMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Join Waitlist'}
              </button>
              <p className="text-muted-foreground text-xs text-center">Workshop is full — join the waitlist</p>
            </div>
          ) : (
            <button
              onClick={handleEnroll}
              disabled={enrollMutation.isPending}
              className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full flex items-center justify-center gap-2"
            >
              {enrollMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Join This Workshop'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useLocation, Link } from 'wouter';
import {
  useGetClientSubscriptions,
  useGetMyBookings,
  useGetCoachingPlans,
} from '@workspace/api-client-react';
import {
  ChevronLeft,
  TrendingUp,
  CheckCircle,
  Clock,
  Flame,
  Calendar,
  Loader2,
} from 'lucide-react';

const DEFAULT_GOALS = [
  'Complete 5 coaching sessions',
  'Practice a new language greeting',
  'Learn 3 cultural etiquette tips',
  'Write an improved bio',
  'Send 10 thoughtful messages',
];

export default function ClientProgress() {
  const [, navigate] = useLocation();
  const [goalsDone, setGoalsDone] = useState<Record<number, boolean>>(() => {
    try {
      const stored = localStorage.getItem('clientProgressGoals');
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });

  const { data: subscriptions, isLoading: subsLoading } = useGetClientSubscriptions();
  const { data: bookings, isLoading: bookingsLoading } = useGetMyBookings();
  const { data: plans, isLoading: plansLoading } = useGetCoachingPlans();

  const isLoading = subsLoading || bookingsLoading || plansLoading;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[100dvh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const activePlan = plans?.[0];
  const activeSub = subscriptions?.find(s => s.status === 'active');
  const completedSessions = bookings?.filter(b => b.status === 'completed') || [];
  const totalHours = completedSessions.reduce((sum, b) => sum + b.durationMinutes, 0) / 60;

  const firstBookingDate = bookings && bookings.length > 0
    ? new Date(bookings.reduce((earliest, b) =>
        new Date(b.scheduledAt) < new Date(earliest.scheduledAt) ? b : earliest
      ).scheduledAt)
    : null;

  const daysActive = firstBookingDate
    ? Math.ceil((Date.now() - firstBookingDate.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const toggleGoal = (i: number) => {
    setGoalsDone(prev => {
      const next = { ...prev, [i]: !prev[i] };
      localStorage.setItem('clientProgressGoals', JSON.stringify(next));
      return next;
    });
  };

  const goals = activePlan?.goals && activePlan.goals.length > 0
    ? activePlan.goals
    : DEFAULT_GOALS;

  const noData = !activePlan && !activeSub && completedSessions.length === 0;

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      {/* Header */}
      <div
        className="sticky top-0 z-40 px-4 py-3 flex items-center gap-3"
        style={{
          background: 'var(--nav-bg)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--nav-border)',
        }}
      >
        <button onClick={() => navigate('/coaches')} className="w-9 h-9 rounded-full glass flex items-center justify-center">
          <ChevronLeft className="w-5 h-5 text-foreground" />
        </button>
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          <h1 className="font-serif text-xl text-foreground">My Progress</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {noData ? (
          /* Empty state */
          <div className="glass rounded-2xl p-8 text-center">
            <div className="w-12 h-12 rounded-full glass flex items-center justify-center mx-auto mb-3">
              <TrendingUp className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="font-serif text-foreground text-lg mb-1">No coaching yet</h3>
            <p className="text-muted-foreground text-sm mb-4">Book your first session to start tracking progress.</p>
            <Link href="/coaches">
              <button className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full">
                Find a Coach
              </button>
            </Link>
          </div>
        ) : (
          <>
            {/* Active Plan */}
            {(activePlan || activeSub) && (
              <div className="glass-strong rounded-3xl p-5 border border-primary/30 glow-pink">
                <p className="text-primary text-xs font-medium mb-1">Active Coaching Plan</p>
                <h2 className="font-serif text-foreground text-xl mb-1">
                  {activePlan?.title || activeSub?.planName || 'Coaching Plan'}
                </h2>
                {activeSub?.coach && (
                  <p className="text-muted-foreground text-sm mb-3">
                    with {activeSub.coach.displayName}
                  </p>
                )}

                {activePlan && (
                  <>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-muted-foreground text-xs">Progress</span>
                      <span className="text-foreground text-xs">{activePlan.currentProgressPercent || 0}%</span>
                    </div>
                    <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden mb-2">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${activePlan.currentProgressPercent || 0}%`,
                          background: 'linear-gradient(90deg, #FF2D7A, #8B5CF6)',
                        }}
                      />
                    </div>
                    {activeSub?.sessionsPerMonth && (
                      <p className="text-muted-foreground text-xs">
                        {activeSub.sessionsPerMonth - completedSessions.length} sessions remaining this month
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Stats Row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="glass rounded-2xl p-3 text-center">
                <CheckCircle className="w-5 h-5 text-cyan-400 mx-auto mb-1" />
                <p className="font-serif text-foreground text-xl">{completedSessions.length}</p>
                <p className="text-muted-foreground text-xs">Sessions</p>
              </div>
              <div className="glass rounded-2xl p-3 text-center">
                <Clock className="w-5 h-5 text-violet-400 mx-auto mb-1" />
                <p className="font-serif text-foreground text-xl">{totalHours.toFixed(1)}</p>
                <p className="text-muted-foreground text-xs">Hours</p>
              </div>
              <div className="glass rounded-2xl p-3 text-center">
                <Flame className="w-5 h-5 text-orange-400 mx-auto mb-1" />
                <p className="font-serif text-foreground text-xl">{daysActive}</p>
                <p className="text-muted-foreground text-xs">Days Active</p>
              </div>
            </div>

            {/* Goals */}
            <div className="glass rounded-2xl p-4">
              <h3 className="font-serif text-foreground text-lg mb-3">Your Goals</h3>
              <div className="space-y-2">
                {goals.map((goal, i) => (
                  <button
                    key={i}
                    onClick={() => toggleGoal(i)}
                    className="w-full flex items-center gap-3 text-left p-2 rounded-xl hover:bg-muted transition-colors"
                  >
                    <CheckCircle
                      className={`w-5 h-5 shrink-0 transition-colors ${
                        goalsDone[i] ? 'text-cyan-400' : 'text-muted-foreground'
                      }`}
                    />
                    <span className={`text-sm transition-all ${
                      goalsDone[i] ? 'line-through text-muted-foreground' : 'text-foreground'
                    }`}>
                      {goal}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Past Sessions */}
            {completedSessions.length > 0 && (
              <div>
                <h3 className="font-serif text-foreground text-lg mb-3">Past Sessions</h3>
                <div className="space-y-2">
                  {completedSessions.slice(0, 5).map(b => (
                    <div key={b.id} className="glass rounded-2xl px-4 py-3 flex items-center gap-3">
                      <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-foreground text-sm">
                          {(b.coach as any)?.displayName || 'Session'}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {new Date(b.scheduledAt).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </p>
                      </div>
                      <span className="text-muted-foreground text-xs shrink-0">{b.durationMinutes}m</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* CTA */}
            <Link href="/coaches">
              <button className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full">
                Book Another Session
              </button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

import { Link, useLocation } from 'wouter';
import {
  useGetCoachDashboard,
  useGetMyCoachBookings,
  useGetMyCoachProfile,
} from '@workspace/api-client-react';
import {
  Loader2,
  Users,
  DollarSign,
  Calendar,
  Star,
  ChevronLeft,
  ShieldCheck,
  Clock,
  BarChart2,
} from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'bg-green-500/20 text-green-400',
  pending: 'bg-yellow-500/20 text-yellow-400',
  cancelled: 'bg-red-500/20 text-red-400',
  completed: 'bg-cyan-500/20 text-cyan-400',
};

export default function CoachDashboard() {
  const [, navigate] = useLocation();
  const { data: dash, isLoading: dashLoading } = useGetCoachDashboard();
  const { data: bookings, isLoading: bookingsLoading } = useGetMyCoachBookings({ status: 'confirmed' });
  const { data: coachProfile } = useGetMyCoachProfile();

  if (dashLoading || bookingsLoading) {
    return (
      <div className="flex justify-center items-center min-h-[100dvh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const verificationStatus = coachProfile?.verificationStatus;

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
        <h1 className="font-serif text-xl text-foreground">Coach Dashboard</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="glass rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-cyan-400" />
              <span className="text-muted-foreground text-xs">Total Clients</span>
            </div>
            <p className="font-serif text-foreground text-2xl">{dash?.totalClients ?? '—'}</p>
          </div>
          <div className="glass rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4 text-violet-400" />
              <span className="text-muted-foreground text-xs">Total Sessions</span>
            </div>
            <p className="font-serif text-foreground text-2xl">{dash?.totalBookings ?? '—'}</p>
          </div>
          <div className="glass rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-green-400" />
              <span className="text-muted-foreground text-xs">Revenue</span>
            </div>
            <p className="font-serif text-foreground text-2xl">
              {dash?.totalRevenue != null ? `$${dash.totalRevenue}` : '—'}
            </p>
          </div>
          <div className="glass rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Star className="w-4 h-4 text-yellow-400" />
              <span className="text-muted-foreground text-xs">Rating</span>
            </div>
            <p className="font-serif text-foreground text-2xl">
              {dash?.avgRating != null ? dash.avgRating.toFixed(1) : '—'}
            </p>
          </div>
        </div>

        {/* Upcoming Sessions */}
        <div>
          <h2 className="font-serif text-foreground text-xl mb-3">Upcoming Sessions</h2>
          {!dash?.upcomingBookings || dash.upcomingBookings.length === 0 ? (
            <div className="glass rounded-2xl p-6 text-center">
              <p className="text-muted-foreground text-sm">No upcoming sessions.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {dash.upcomingBookings.map(b => (
                <div key={b.id} className="glass rounded-2xl p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <BarChart2 className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-foreground text-sm font-medium">Client #{b.clientId}</p>
                    <p className="text-muted-foreground text-xs">
                      {new Date(b.scheduledAt).toLocaleString([], {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })} · {b.durationMinutes}m
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${STATUS_COLORS[b.status] || 'bg-muted text-muted-foreground'}`}>
                    {b.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-3 gap-3">
          <Link href="/coaches/apply">
            <div className="glass rounded-2xl p-3 text-center cursor-pointer hover:glass-strong transition-all">
              <p className="text-foreground text-xs">Update Profile</p>
            </div>
          </Link>
          <Link href="/coaches">
            <div className="glass rounded-2xl p-3 text-center cursor-pointer hover:glass-strong transition-all">
              <p className="text-foreground text-xs">My Reviews</p>
            </div>
          </Link>
          <Link href="/settings">
            <div className="glass rounded-2xl p-3 text-center cursor-pointer hover:glass-strong transition-all">
              <p className="text-foreground text-xs">Settings</p>
            </div>
          </Link>
        </div>

        {/* Profile Status */}
        <div className="glass rounded-2xl p-4">
          <h3 className="font-serif text-foreground text-lg mb-3">Profile Status</h3>
          {verificationStatus === 'approved' ? (
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-6 h-6 text-cyan-400" />
              <div>
                <p className="text-foreground text-sm font-medium">Verified Coach</p>
                <p className="text-muted-foreground text-xs">Your profile is verified</p>
              </div>
            </div>
          ) : verificationStatus === 'pending' ? (
            <div className="flex items-center gap-3">
              <Clock className="w-6 h-6 text-yellow-400" />
              <div>
                <p className="text-foreground text-sm font-medium">Verification Pending</p>
                <p className="text-muted-foreground text-xs">We'll notify you within 3-5 business days</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-6 h-6 text-muted-foreground" />
                <div>
                  <p className="text-foreground text-sm font-medium">Not Verified</p>
                  <p className="text-muted-foreground text-xs">Apply to get the verified badge</p>
                </div>
              </div>
              <Link href="/coaches/apply">
                <button className="glass border border-border rounded-full px-3 py-1.5 text-primary text-xs hover:glass-strong transition-all">
                  Apply
                </button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

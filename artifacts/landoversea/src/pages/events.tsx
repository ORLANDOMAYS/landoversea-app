import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetCulturalEvents,
  useRsvpEvent,
  useCancelEventRsvp,
  getGetCulturalEventsQueryKey,
} from '@workspace/api-client-react';
import {
  Calendar, CalendarDays, MapPin, Globe, Users, RefreshCw, Loader2,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { normalizeApiError } from '@/lib/api-error';

const FILTERS = ['All', 'This Week'];

function isThisWeek(dateStr: string) {
  const now = new Date();
  const date = new Date(dateStr);
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return date >= now && date <= weekFromNow;
}

export default function EventsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [mutationError, setMutationError] = useState<{ eventId: number; next: boolean; message: string } | null>(null);

  const { data: events, isLoading, isError, error, refetch } = useGetCulturalEvents();

  const rsvpMutation = useRsvpEvent();
  const cancelMutation = useCancelEventRsvp();

  const updateRsvpInCaches = (eventId: number, next: boolean) => {
    queryClient.setQueriesData({ queryKey: ['/api/cultural/events'] }, (current: unknown) => (
      Array.isArray(current)
        ? current.map(item => item && typeof item === 'object' && 'id' in item && item.id === eventId
          ? { ...item, hasRsvp: next, isRsvped: next }
          : item)
        : current
    ));
  };

  const changeRsvp = async (eventId: number, next: boolean) => {
    setMutationError(null);
    updateRsvpInCaches(eventId, next);
    try {
      if (next) await rsvpMutation.mutateAsync({ eventId });
      else await cancelMutation.mutateAsync({ eventId });
      toast(next
        ? { title: "You're going! 🎉", description: 'Event added to your calendar.' }
        : { title: 'RSVP cancelled', description: 'You are no longer attending this event.' });
    } catch (err) {
      updateRsvpInCaches(eventId, !next);
      const message = normalizeApiError(err, next ? 'Could not save your RSVP.' : 'Could not cancel your RSVP.').message;
      setMutationError({ eventId, next, message });
      toast({ title: next ? 'RSVP failed' : 'Cancellation failed', description: message, variant: 'destructive' });
    } finally {
      await queryClient.invalidateQueries({ queryKey: getGetCulturalEventsQueryKey() });
    }
  };

  const eventsArray = Array.isArray(events) ? events : [];

  const filtered = eventsArray.filter((e) => {
    const matchesSearch =
      !search ||
      e.title.toLowerCase().includes(search.toLowerCase()) ||
      (e.description ?? '').toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (activeFilter === 'All') return true;
    if (activeFilter === 'This Week') return isThisWeek(e.date);
    return true;
  });

  const getEventType = () => 'Cultural Event';

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      {/* Sticky Header */}
      <header
        className="sticky top-0 z-40 px-4 py-3 flex items-center gap-3"
        style={{
          background: 'var(--nav-bg)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--nav-border)',
        }}
      >
        <Calendar className="w-5 h-5 text-accent" />
        <h1 className="font-serif text-xl text-foreground flex-1">Cultural Events</h1>
        <button
          type="button"
          aria-label="Refresh events"
          className="glass border border-border rounded-full px-3 py-1.5 hover:glass-strong transition-all"
          onClick={() => refetch()}
        >
          <RefreshCw className="w-4 h-4 text-foreground" />
        </button>
      </header>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Search */}
        <div className="relative">
          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            aria-label="Search events"
            type="text"
            placeholder="Search events..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="glass-input rounded-full px-4 py-2 pl-9 w-full outline-none placeholder:text-muted-foreground text-sm"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {FILTERS.map((f) => (
            <button
              type="button"
              aria-pressed={activeFilter === f}
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`flex-shrink-0 rounded-full px-4 py-1.5 text-sm border transition-all ${
                activeFilter === f
                  ? 'bg-primary/20 border-primary text-primary font-semibold'
                  : 'glass border-border text-muted-foreground hover:glass-strong'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Loading Skeletons */}
        {isLoading && (
          <div className="space-y-4" role="status" aria-label="Loading events">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass rounded-2xl overflow-hidden animate-pulse">
                <div className="h-44 bg-muted" />
                <div className="p-4 space-y-2">
                  <div className="h-5 bg-muted rounded-full w-3/4" />
                  <div className="h-4 bg-muted rounded-full w-1/2" />
                  <div className="h-4 bg-muted rounded-full w-2/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {isError && (
          <div className="glass rounded-2xl p-8 text-center" role="alert">
            <h3 className="font-serif text-lg text-foreground mb-2">Events unavailable</h3>
            <p className="text-muted-foreground text-sm mb-4">{normalizeApiError(error, 'Could not load events.').message}</p>
            <button type="button" className="btn-glow rounded-full px-5 py-2.5" onClick={() => refetch()}>Retry</button>
          </div>
        )}

        {/* Empty */}
        {!isLoading && !isError && filtered.length === 0 && (
          <div className="glass rounded-2xl p-8 text-center">
            <div className="w-14 h-14 glass rounded-full flex items-center justify-center mx-auto mb-4">
              <Calendar className="w-7 h-7 text-muted-foreground" />
            </div>
            <h3 className="font-serif text-lg text-foreground mb-2">No events found</h3>
            <p className="text-muted-foreground text-sm">Try adjusting your filters or check back soon.</p>
          </div>
        )}

        {/* Event Cards */}
        {!isLoading && !isError && filtered.length > 0 && (
          <div className="space-y-4">
            {filtered.map((event) => {
              const hasRsvp = event.isRsvped ?? false;
              const isPending = (rsvpMutation.isPending && rsvpMutation.variables?.eventId === event.id)
                || (cancelMutation.isPending && cancelMutation.variables?.eventId === event.id);
              const eventType = getEventType();

              return (
                <div
                  key={event.id}
                  className="glass rounded-2xl overflow-hidden cursor-pointer hover:glass-strong transition-all"
                  onClick={() => navigate(`/events/${event.id}`)}
                >
                  {/* Image / Placeholder */}
                  <div className="relative h-44 w-full">
                    {event.imageUrl ? (
                      <img src={event.imageUrl} alt={event.title} className="h-44 w-full object-cover" />
                    ) : (
                      <div className="h-44 w-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(255,45,122,0.2), rgba(139,92,246,0.2))' }}>
                        <Calendar className="w-14 h-14 text-muted-foreground" />
                      </div>
                    )}
                    {/* Type Badge */}
                    <span
                      className={`absolute top-3 left-3 glass rounded-full px-3 py-1 text-xs font-semibold border border-border ${
                        eventType === 'Virtual'
                          ? 'text-accent'
                          : eventType === 'In-Person'
                          ? 'text-primary'
                          : 'text-secondary'
                      }`}
                    >
                      {eventType}
                    </span>
                  </div>

                  {/* Content */}
                  <div className="p-4">
                    <h3 className="font-serif text-lg text-foreground leading-tight mb-2">{event.title}</h3>
                    <div className="flex items-center gap-1 mb-1">
                      <CalendarDays className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                      <span className="text-accent text-sm">
                        {new Date(event.date).toLocaleDateString(undefined, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mb-1">
                      {eventType === 'Virtual' ? (
                        <Globe className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      ) : (
                        <MapPin className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      )}
                      <span className="text-muted-foreground text-sm">{event.country}</span>
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-muted-foreground text-xs">
                        🌍 {event.country}
                      </span>
                      <button
                        type="button"
                         aria-label={hasRsvp ? `Cancel RSVP for ${event.title}` : `RSVP to ${event.title}`}
                        className={`${
                          hasRsvp
                            ? 'glass border border-green-400/40 text-green-400'
                            : 'btn-glow'
                        } rounded-full px-4 py-1.5 text-sm font-semibold`}
                        onClick={(e) => {
                          e.stopPropagation();
                           void changeRsvp(event.id, !hasRsvp);
                        }}
                         disabled={isPending}
                      >
                        {isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : hasRsvp ? (
                           '✓ Going — Cancel'
                        ) : (
                          'RSVP'
                        )}
                      </button>
                    </div>
                     {mutationError?.eventId === event.id && (
                       <div role="alert" className="mt-3 flex items-center gap-3 text-sm text-red-200">
                         <span className="flex-1">{mutationError.message}</span>
                         <button
                           type="button"
                           className="underline"
                           disabled={isPending}
                           onClick={(e) => {
                             e.stopPropagation();
                             void changeRsvp(event.id, mutationError.next);
                           }}
                         >
                           Retry
                         </button>
                       </div>
                     )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

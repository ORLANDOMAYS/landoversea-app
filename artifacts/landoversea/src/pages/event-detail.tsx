import { useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetCulturalEvents,
  useRsvpEvent,
  useCancelEventRsvp,
  getGetCulturalEventsQueryKey,
} from '@workspace/api-client-react';
import {
  ChevronLeft, Calendar, CalendarDays, MapPin, Globe, Users, Loader2,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { normalizeApiError } from '@/lib/api-error';

export default function EventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mutationError, setMutationError] = useState<string | null>(null);

  const { data: events, isLoading, isError, error, refetch } = useGetCulturalEvents();
  const eventsArray = Array.isArray(events) ? events : [];
  const event = eventsArray.find((e) => String(e.id) === eventId);

  const rsvpMutation = useRsvpEvent();
  const cancelMutation = useCancelEventRsvp();

  const updateRsvpInCaches = (next: boolean) => {
    queryClient.setQueriesData({ queryKey: ['/api/cultural/events'] }, (current: unknown) => (
      Array.isArray(current)
        ? current.map(item => item && typeof item === 'object' && 'id' in item && item.id === Number(eventId)
          ? { ...item, hasRsvp: next, isRsvped: next }
          : item)
        : current
    ));
  };

  const changeRsvp = async (next: boolean) => {
    setMutationError(null);
    updateRsvpInCaches(next);
    try {
      if (next) await rsvpMutation.mutateAsync({ eventId: Number(eventId) });
      else await cancelMutation.mutateAsync({ eventId: Number(eventId) });
      toast(next
        ? { title: "You're going! 🎉", description: 'RSVP confirmed.' }
        : { title: 'RSVP cancelled', description: 'You are no longer attending this event.' });
    } catch (err) {
      updateRsvpInCaches(!next);
      const message = normalizeApiError(err, next ? 'Could not save your RSVP.' : 'Could not cancel your RSVP.').message;
      setMutationError(message);
      toast({ title: next ? 'RSVP failed' : 'Cancellation failed', description: message, variant: 'destructive' });
    } finally {
      await queryClient.invalidateQueries({ queryKey: getGetCulturalEventsQueryKey() });
    }
  };

  const isVirtual = event
    ? event.title.toLowerCase().includes('virtual') || event.title.toLowerCase().includes('online')
    : false;

  const hasRsvp = event?.isRsvped ?? false;
  const isRsvpPending = rsvpMutation.isPending || cancelMutation.isPending;

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 px-4" role="alert">
        <h2 className="font-serif text-xl text-foreground">Event unavailable</h2>
        <p className="text-muted-foreground text-sm">{normalizeApiError(error, 'Could not load this event.').message}</p>
        <button type="button" className="btn-glow px-6 py-3 rounded-full" onClick={() => refetch()}>Retry</button>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 px-4">
        <div className="glass rounded-2xl p-8 text-center max-w-sm w-full">
          <div className="w-14 h-14 glass rounded-full flex items-center justify-center mx-auto mb-4">
            <Calendar className="w-7 h-7 text-muted-foreground" />
          </div>
          <h3 className="font-serif text-xl text-foreground mb-2">Event not found</h3>
          <p className="text-muted-foreground text-sm mb-4">This event may have ended or been removed.</p>
          <button className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full" onClick={() => navigate('/events')}>
            Browse Events
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      {/* Hero */}
      <div className="relative h-56 w-full">
        {event.imageUrl ? (
          <img src={event.imageUrl} alt={event.title} className="h-56 w-full object-cover" />
        ) : (
          <div
            className="h-56 w-full flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, rgba(255,45,122,0.25), rgba(139,92,246,0.25))' }}
          >
            <Calendar className="w-20 h-20 text-muted-foreground" />
          </div>
        )}
        {/* Gradient overlay */}
        <div
          className="absolute inset-x-0 bottom-0 h-24 pointer-events-none"
          style={{ background: 'linear-gradient(to top, var(--color-background), transparent)' }}
        />
        {/* Back button */}
        <button
          type="button"
          aria-label="Back to events"
          className="w-9 h-9 rounded-full glass flex items-center justify-center absolute top-4 left-4 z-10"
          onClick={() => {
            if (window.history.length > 1) window.history.back();
            else navigate('/events');
          }}
        >
          <ChevronLeft className="w-5 h-5 text-foreground" />
        </button>
      </div>

      {/* Content */}
      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Type badge + title */}
        <div>
          <span className="glass rounded-full px-3 py-1 text-xs font-semibold border border-border text-accent inline-block mb-2">
            {isVirtual ? '🌐 Virtual' : '📍 In-Person'}
          </span>
          <h1 className="font-serif text-2xl text-foreground leading-tight">{event.title}</h1>
        </div>

        {/* Date/Time */}
        <div className="glass rounded-2xl p-4 flex items-center gap-3">
          <CalendarDays className="w-5 h-5 text-primary flex-shrink-0" />
          <div>
            <p className="text-foreground font-medium">
              {new Date(event.date).toLocaleDateString(undefined, {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
            <p className="text-muted-foreground text-sm">
              {new Date(event.date).toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
        </div>

        {/* Location */}
        <div className="glass rounded-2xl p-4 flex items-center gap-3">
          {isVirtual ? (
            <Globe className="w-5 h-5 text-accent flex-shrink-0" />
          ) : (
            <MapPin className="w-5 h-5 text-accent flex-shrink-0" />
          )}
          <p className="text-foreground">
            {isVirtual ? 'Virtual Event' : event.country}
          </p>
        </div>

        {/* Attendees */}
        <div className="glass rounded-2xl p-4 flex items-center gap-3">
          <Users className="w-5 h-5 text-muted-foreground flex-shrink-0" />
          <div className="flex items-center gap-2 flex-1">
            {/* Avatar circles placeholder */}
            <div className="flex -space-x-2">
              {['🧑', '👩', '👨', '🧕'].map((emoji, i) => (
                <div
                  key={i}
                  className="w-7 h-7 rounded-full glass border border-border flex items-center justify-center text-sm"
                >
                  {emoji}
                </div>
              ))}
              <div className="w-7 h-7 rounded-full glass border border-border flex items-center justify-center text-xs text-muted-foreground">
                +
              </div>
            </div>
            <p className="text-muted-foreground text-sm">People attending</p>
          </div>
        </div>

        {/* Description */}
        {event.description && (
          <div>
            <h3 className="font-serif text-xl text-foreground mb-2">About</h3>
            <p className="text-foreground text-sm leading-relaxed">{event.description}</p>
          </div>
        )}

        {/* RSVP */}
        {hasRsvp ? (
          <div className="space-y-3">
            <div className="glass-strong rounded-2xl p-4 flex items-center justify-center gap-2 border border-green-400/30">
              <span className="text-green-400 font-semibold">✓ You're Going!</span>
            </div>
            <button
              type="button"
              aria-label={`Cancel RSVP for ${event.title}`}
              className="w-full text-center text-foreground text-sm disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
              disabled={isRsvpPending}
              onClick={() => void changeRsvp(false)}
            >
              {cancelMutation.isPending ? 'Cancelling...' : "Can't make it — Cancel RSVP"}
            </button>
          </div>
        ) : (
          <button
            className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full"
            aria-label={`RSVP to ${event.title}`}
            disabled={isRsvpPending}
            onClick={() => void changeRsvp(true)}
          >
            {rsvpMutation.isPending ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Confirming...
              </span>
            ) : (
              'RSVP to Attend'
            )}
          </button>
        )}
        {mutationError && (
          <div role="alert" className="glass rounded-xl p-3 border border-red-400/30 flex items-center gap-3">
            <p className="text-red-200 text-sm flex-1">{mutationError}</p>
            <button
              type="button"
              className="underline text-sm"
              disabled={isRsvpPending}
              onClick={() => void changeRsvp(hasRsvp ? false : true)}
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

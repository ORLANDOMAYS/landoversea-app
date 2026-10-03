import { useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { useGetCoachAvailability, getGetCoachAvailabilityQueryKey, useCreateBooking } from '@workspace/api-client-react';
import type { TimeSlot } from '@workspace/api-client-react';
import { Loader2, ChevronLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { resolveMediaUrl } from '@/lib/media-url';
import {
  CoachBridgeError,
  useApprovedCoach,
  useResolvedLocalCoachId,
} from '@/hooks/use-supabase-surfaces';

type SessionType = 'video' | 'phone' | 'in_person';

function groupSlots(slots: TimeSlot[]) {
  const morning: TimeSlot[] = [];
  const afternoon: TimeSlot[] = [];
  const evening: TimeSlot[] = [];

  for (const slot of slots) {
    const hour = new Date(slot.startAt).getHours();
    if (hour < 12) morning.push(slot);
    else if (hour < 17) afternoon.push(slot);
    else evening.push(slot);
  }

  return { morning, afternoon, evening };
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface SlotGroupProps {
  label: string;
  slots: TimeSlot[];
  selected: TimeSlot | null;
  onSelect: (slot: TimeSlot) => void;
}

function SlotGroup({ label, slots, selected, onSelect }: SlotGroupProps) {
  if (slots.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        {slots.map((slot) => {
          const isSelected = selected?.startAt === slot.startAt;
          const isAvailable = slot.available;

          let cls =
            'glass rounded-xl px-2 py-2 text-xs text-center transition-all duration-200 border ';

          if (!isAvailable) {
            cls += 'border-border bg-disabled text-disabled-foreground cursor-not-allowed';
          } else if (isSelected) {
            cls += 'border-primary bg-primary text-primary-foreground cursor-pointer';
          } else {
            cls += 'border-border text-foreground cursor-pointer hover:border-border hover:text-foreground';
          }

          return (
            <button
              key={slot.startAt}
              type="button"
              className={cls}
              disabled={!isAvailable}
              onClick={() => isAvailable && onSelect(slot)}
            >
              {formatTime(slot.startAt)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function BookCoach() {
  const { coachId } = useParams<{ coachId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [sessionType, setSessionType] = useState<SessionType>('video');
  const [notes, setNotes] = useState('');
  const viewerTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const hasCompleteDate = /^\d{4}-\d{2}-\d{2}$/.test(selectedDate) && selectedDate >= today;

  const { data: coach, isLoading: coachLoading } = useApprovedCoach(coachId);
  const {
    data: localCoachId,
    error: bridgeError,
    isLoading: bridgeLoading,
  } = useResolvedLocalCoachId(coachId);
  const isUnlinked =
    bridgeError instanceof CoachBridgeError && bridgeError.code === 'coach_not_linked';

  const { data: slots, isLoading: slotsLoading } = useGetCoachAvailability(
    localCoachId ?? 0,
    { date: selectedDate, timeZone: viewerTimeZone },
    {
      query: {
        enabled: Boolean(localCoachId) && hasCompleteDate,
        queryKey: getGetCoachAvailabilityQueryKey(localCoachId ?? 0, {
          date: selectedDate,
          timeZone: viewerTimeZone,
        }),
      },
    }
  );

  const createBookingMutation = useCreateBooking();

  if (coachLoading || bridgeLoading || !coach) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const grouped = slots ? groupSlots(slots) : null;
  const hasSlots = grouped
    ? grouped.morning.length + grouped.afternoon.length + grouped.evening.length > 0
    : false;

  const scheduledAt = selectedSlot?.startAt ?? null;
  const durationMinutes = selectedSlot
    ? Math.round(
        (new Date(selectedSlot.endAt).getTime() - new Date(selectedSlot.startAt).getTime()) / 60000
      )
    : 60;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!localCoachId || !selectedSlot || !scheduledAt) {
      toast({ title: 'Please select a time slot', variant: 'destructive' });
      return;
    }
    createBookingMutation.mutate(
      {
        data: {
          coachId: localCoachId,
          scheduledAt,
          durationMinutes,
          notes: notes || undefined,
        },
      },
      {
        onSuccess: () => {
          toast({ title: 'Booking requested!' });
          setLocation('/coaching');
        },
        onError: (err: any) => {
          const message = err?.response?.data?.error || err?.message || 'Failed to request booking';
          toast({ title: 'Error', description: message, variant: 'destructive' });
        },
      }
    );
  };

  const sessionTypes: { value: SessionType; label: string }[] = [
    { value: 'video', label: 'Video Call' },
    { value: 'phone', label: 'Phone Call' },
    { value: 'in_person', label: 'In Person' },
  ];

  return (
    <div className="min-h-screen">
      {/* Sticky Header */}
      <div
        className="sticky top-0 z-50 flex items-center gap-3 px-4 py-3"
        style={{
          background: 'var(--nav-bg)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--nav-border)',
        }}
      >
        <button
          type="button"
          onClick={() => setLocation(`/coaches/${coachId}`)}
          className="glass w-9 h-9 rounded-full flex items-center justify-center border border-border text-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="font-serif text-xl text-foreground">Book a Session</h1>
      </div>

      <form onSubmit={handleSubmit} className="max-w-lg mx-auto px-4 space-y-4 pt-4 pb-12">
        {/* Coach Card */}
        <div className="glass rounded-2xl p-4 flex items-center gap-4">
          <img
            src={
              resolveMediaUrl(coach.photoUrl) ||
              'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=200'
            }
            alt={coach.displayName}
            className="w-14 h-14 rounded-xl object-cover flex-shrink-0"
          />
          <div>
            <p className="font-semibold text-foreground">{coach.displayName}</p>
            <p className="text-sm text-muted-foreground">
              {coach.ratesPerHour ? `$${coach.ratesPerHour}/hr` : 'Rate on request'}
            </p>
          </div>
        </div>

        {isUnlinked && (
          <div className="glass rounded-2xl p-5 border border-border text-center">
            <h2 className="font-serif text-foreground text-lg">Booking is not available yet</h2>
            <p className="text-muted-foreground text-sm mt-2">
              This coach has not linked their booking profile. No booking was created and you can
              safely return to their profile.
            </p>
          </div>
        )}

        {/* Date Card */}
        {!isUnlinked && <div className="glass rounded-2xl p-4 space-y-3">
          <div>
            <h2 className="font-serif text-foreground text-lg">Select Date</h2>
            <p className="text-muted-foreground text-xs mt-1">
              Times shown in {viewerTimeZone.replaceAll('_', ' ')}
            </p>
          </div>
          <input
            type="date"
            min={today}
            value={selectedDate}
            onChange={(e) => {
              setSelectedDate(e.target.value);
              setSelectedSlot(null);
            }}
            className="glass-input w-full rounded-2xl px-3 py-2.5 outline-none text-foreground placeholder:text-muted-foreground"
          />
        </div>}

        {/* Slots Card */}
        {!isUnlinked && (hasCompleteDate ? (
          <div className="glass rounded-2xl p-4 space-y-4">
            <h2 className="font-serif text-foreground text-lg">Available Slots</h2>
            {slotsLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : !hasSlots ? (
              <div className="glass rounded-xl p-4 text-center text-muted-foreground text-sm">
                No available slots for this date — try another day
              </div>
            ) : (
              <div className="space-y-4">
                <SlotGroup
                  label="Morning"
                  slots={grouped!.morning}
                  selected={selectedSlot}
                  onSelect={setSelectedSlot}
                />
                <SlotGroup
                  label="Afternoon"
                  slots={grouped!.afternoon}
                  selected={selectedSlot}
                  onSelect={setSelectedSlot}
                />
                <SlotGroup
                  label="Evening"
                  slots={grouped!.evening}
                  selected={selectedSlot}
                  onSelect={setSelectedSlot}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="glass rounded-2xl p-4 text-center text-muted-foreground text-sm py-6">
            Select a date to see available slots
          </div>
        ))}

        {/* Session Type Card */}
        {!isUnlinked && <div className="glass rounded-2xl p-4 space-y-3">
          <h2 className="font-serif text-foreground text-lg">Session Type</h2>
          <div className="flex gap-2">
            {sessionTypes.map(({ value, label }) => {
              const isActive = sessionType === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSessionType(value)}
                  className={
                    'flex-1 rounded-xl py-2 px-2 text-sm border transition-all duration-200 ' +
                    (isActive
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'glass border-border text-muted-foreground hover:text-foreground hover:border-border')
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>}

        {/* Notes Card */}
        {!isUnlinked && <div className="glass rounded-2xl p-4 space-y-3">
          <label className="font-serif text-foreground text-lg block">Notes (optional)</label>
          <textarea
            rows={3}
            placeholder="Any topics you'd like to cover, questions, or context..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="glass-input w-full rounded-2xl px-3 py-2.5 outline-none text-foreground placeholder:text-muted-foreground resize-none"
          />
        </div>}

        {/* Submit */}
        <button
          type="submit"
          className="btn-glow w-full rounded-2xl py-3 font-semibold text-white disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none disabled:cursor-not-allowed flex items-center justify-center gap-2"
          disabled={!localCoachId || !selectedSlot || createBookingMutation.isPending}
        >
          {createBookingMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Requesting...
            </>
          ) : (
            isUnlinked ? 'Booking unavailable' : 'Request Booking'
          )}
        </button>
      </form>
    </div>
  );
}

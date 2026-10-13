import { useState, useEffect } from 'react';
import { resolveMediaUrl } from '@/lib/media-url';
import { Link, useLocation } from 'wouter';
import {
  useGetMyBookings,
  getGetMyBookingsQueryKey,
  useCancelBooking,
  useSubmitBookingReview,
  createBookingCheckout,
  getBookingPayment,
  refundBookingPayment,
} from '@workspace/api-client-react';
import type { BookingPaymentStatus } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Calendar, Star, ChevronLeft, CreditCard, AlertCircle, CheckCircle2, RotateCcw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(
    (minor ?? 0) / 100,
  );
}

type Tab = 'upcoming' | 'past';

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'bg-green-500/20 text-green-400 border border-green-500/30',
  pending: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  cancelled: 'bg-red-500/20 text-red-400 border border-red-500/30',
  completed: 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30',
};

// Truthful payment/refund/payout status + initiate-payment action for a booking.
function BookingPayment({ bookingId, status }: { bookingId: number; status: string }) {
  const { toast } = useToast();
  const [payment, setPayment] = useState<BookingPaymentStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setPayment(await getBookingPayment(bookingId));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('payment');
    if (!result) return;

    toast({
      title: result === 'success' ? 'Payment submitted' : 'Payment cancelled',
      description:
        result === 'success'
          ? 'We are confirming the payment securely.'
          : 'No charge was completed.',
      variant: result === 'success' ? undefined : 'destructive',
    });
    window.history.replaceState({}, '', window.location.pathname);

    if (result !== 'success') return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      void load();
      if (attempts >= 10) window.clearInterval(timer);
    }, 2_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pay = async () => {
    setActing(true);
    try {
      const data = await createBookingCheckout(bookingId, {
        returnPath: `${import.meta.env.BASE_URL}coaching`,
      });
      if (!data.checkoutUrl.startsWith('https://')) {
        throw new Error('Payment provider did not return a valid checkout URL');
      }
      window.location.assign(data.checkoutUrl);
    } catch (error) {
      const unavailable =
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        error.status === 503;
      toast({
        title: unavailable ? 'Payments unavailable' : 'Payment could not start',
        description:
          unavailable
            ? 'Payment processing is not yet configured. Please try again later.'
            : error instanceof Error
              ? error.message
              : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setActing(false);
    }
  };

  const requestRefund = async () => {
    if (!window.confirm('Request a refund for this booking?')) return;
    setActing(true);
    try {
      await refundBookingPayment(bookingId);
      toast({ title: 'Refund requested' });
      await load();
    } catch (error) {
      toast({
        title: 'Refund failed',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setActing(false);
    }
  };

  if (loading && !payment) {
    return <div className="mt-3 pt-3 border-t border-border text-muted-foreground text-xs">Loading payment…</div>;
  }
  if (!payment || payment.amount <= 0) return null;

  const paid = payment.status === 'succeeded';
  const refunded = payment.status === 'refunded' || payment.status === 'partially_refunded';
  const failed = payment.status === 'failed';
  const canPay = ['none', 'requires_payment', 'failed'].includes(payment.status) && status !== 'completed';

  return (
    <div className="mt-3 pt-3 border-t border-border space-y-2" data-testid="payment-status">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">Payment · {formatMoney(payment.amount, payment.currency)}</span>
        {paid && (
          <span className="flex items-center gap-1 text-green-400 text-xs">
            <CheckCircle2 className="w-3.5 h-3.5" /> Paid
          </span>
        )}
        {refunded && (
          <span className="flex items-center gap-1 text-cyan-400 text-xs">
            <RotateCcw className="w-3.5 h-3.5" /> Refunded
          </span>
        )}
        {failed && (
          <span className="flex items-center gap-1 text-red-400 text-xs">
            <AlertCircle className="w-3.5 h-3.5" /> Failed
          </span>
        )}
      </div>

      {!payment.configured && (
        <p className="text-yellow-400/80 text-xs">Payments are not yet available on this platform.</p>
      )}
      {payment.lastError && failed && (
        <p className="text-red-400/80 text-xs">{payment.lastError}</p>
      )}
      {payment.payout && (
        <p className="text-muted-foreground text-xs">
          Coach payout: {payment.payout.status}
          {payment.payout.payoutStatus ? ` (${payment.payout.payoutStatus})` : ''}
        </p>
      )}

      <div className="flex gap-2">
        {canPay && (
          <button
            data-testid="button-pay-booking"
            onClick={pay}
            disabled={acting || !payment.configured}
            className="btn-glow px-4 py-2 text-white text-xs font-semibold rounded-full disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none inline-flex items-center gap-1.5"
          >
            {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5" />}
            {payment.status === 'failed' ? 'Retry Payment' : 'Pay Now'}
          </button>
        )}
        {paid && !refunded && (
          <button
            onClick={requestRefund}
            disabled={acting}
            className="glass border border-border rounded-full px-4 py-2 hover:glass-strong transition-all text-foreground text-xs disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
          >
            Request Refund
          </button>
        )}
      </div>
    </div>
  );
}

export default function CoachingHub() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<Tab>('upcoming');

  const { data: bookings, isLoading } = useGetMyBookings();
  const cancelMutation = useCancelBooking();
  const reviewMutation = useSubmitBookingReview();

  const [reviewOpen, setReviewOpen] = useState<Record<number, boolean>>({});
  const [reviewRatings, setReviewRatings] = useState<Record<number, number>>({});
  const [reviewComments, setReviewComments] = useState<Record<number, string>>({});

  const now = new Date();

  const upcoming = bookings?.filter(b =>
    (b.status === 'pending' || b.status === 'confirmed') && new Date(b.scheduledAt) > now
  ) || [];

  const past = bookings?.filter(b =>
    b.status === 'completed' || b.status === 'cancelled' || new Date(b.scheduledAt) <= now
  ) || [];

  const handleCancel = (bookingId: number) => {
    if (!window.confirm('Cancel this booking?')) return;
    cancelMutation.mutate(
      { bookingId },
      {
        onSuccess: () => {
          toast({ title: 'Booking cancelled' });
          queryClient.invalidateQueries({ queryKey: getGetMyBookingsQueryKey() });
        },
        onError: (err: any) => {
          toast({ title: 'Error', description: err?.message || 'Failed to cancel', variant: 'destructive' });
        },
      }
    );
  };

  const handleSubmitReview = (bookingId: number) => {
    const rating = reviewRatings[bookingId];
    if (!rating) {
      toast({ title: 'Please select a rating', variant: 'destructive' });
      return;
    }
    reviewMutation.mutate(
      { bookingId, data: { rating, comment: reviewComments[bookingId] || undefined } },
      {
        onSuccess: () => {
          toast({ title: 'Review submitted!' });
          setReviewOpen(prev => ({ ...prev, [bookingId]: false }));
          setReviewRatings(prev => { const n = { ...prev }; delete n[bookingId]; return n; });
          setReviewComments(prev => { const n = { ...prev }; delete n[bookingId]; return n; });
          queryClient.invalidateQueries({ queryKey: getGetMyBookingsQueryKey() });
        },
        onError: (err: any) => {
          toast({ title: 'Error', description: err?.message || 'Failed to submit review', variant: 'destructive' });
        },
      }
    );
  };

  const displayList = tab === 'upcoming' ? upcoming : past;

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
        <h1 className="font-serif text-xl text-foreground">My Sessions</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Tabs */}
        <div className="flex gap-2">
          {(['upcoming', 'past'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all capitalize ${
                tab === t
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'glass text-muted-foreground border border-border'
              }`}
            >
              {t} {t === 'upcoming' ? `(${upcoming.length})` : `(${past.length})`}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : displayList.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center">
            <div className="w-12 h-12 rounded-full glass flex items-center justify-center mx-auto mb-3">
              <Calendar className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="font-serif text-foreground text-lg mb-1">No sessions yet</h3>
            <p className="text-muted-foreground text-sm mb-4">
              {tab === 'upcoming' ? "You have no upcoming sessions." : "No past sessions found."}
            </p>
            <Link href="/coaches" className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full inline-flex items-center justify-center">
              Find a Coach
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {displayList.map(booking => (
              <div key={booking.id} className="glass rounded-2xl p-4">
                <div className="flex items-center gap-3">
                  <img
                    src={
                      resolveMediaUrl((booking.coach as any)?.photoUrl) ||
                      `https://ui-avatars.com/api/?name=${encodeURIComponent((booking.coach as any)?.displayName || 'C')}&background=8B5CF6&color=fff`
                    }
                    alt="coach"
                    className="w-12 h-12 rounded-full object-cover border border-primary/30 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-serif text-foreground text-base leading-tight">
                      {(booking.coach as any)?.displayName || 'Session'}
                    </p>
                    {(booking.coach as any)?.specialties?.[0] && (
                      <p className="text-muted-foreground text-xs">{(booking.coach as any).specialties[0]}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <div className="flex items-center gap-1 text-muted-foreground text-xs">
                        <Calendar className="w-3 h-3" />
                        {new Date(booking.scheduledAt).toLocaleString([], {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                      <span className="text-muted-foreground text-xs">·</span>
                      <span className="text-muted-foreground text-xs">{booking.durationMinutes}m</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${STATUS_COLORS[booking.status] || 'bg-muted text-muted-foreground'}`}>
                        {booking.status}
                      </span>
                    </div>
                  </div>

                  {tab === 'upcoming' && (() => {
                    const startsAt = new Date(booking.scheduledAt);
                    const cancellable =
                      (booking.status === 'pending' || booking.status === 'confirmed') &&
                      startsAt.getTime() > now.getTime();
                    return (
                      <button
                        onClick={() => handleCancel(booking.id)}
                        disabled={cancelMutation.isPending || !cancellable}
                        title={cancellable ? undefined : 'This session can no longer be cancelled'}
                        className="glass border border-border rounded-full px-4 py-2 hover:glass-strong transition-all text-red-400 text-xs disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none disabled:cursor-not-allowed"
                      >
                        Cancel
                      </button>
                    );
                  })()}
                  {tab === 'past' && booking.status === 'completed' && !reviewOpen[booking.id] && (
                    <button
                      onClick={() => setReviewOpen(prev => ({ ...prev, [booking.id]: true }))}
                      className="glass border border-border rounded-full px-4 py-2 hover:glass-strong transition-all text-foreground text-xs"
                    >
                      Review
                    </button>
                  )}
                </div>

                {tab === 'upcoming' && <BookingPayment bookingId={booking.id} status={booking.status} />}

                {/* Inline Review Form */}
                <AnimatePresence>
                  {tab === 'past' && booking.status === 'completed' && reviewOpen[booking.id] && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-4 pt-4 border-t border-border space-y-3 overflow-hidden"
                    >
                      <p className="text-foreground text-sm font-medium">Rate your session</p>
                      <div className="flex gap-2">
                        {[1, 2, 3, 4, 5].map(star => (
                          <button
                            key={star}
                            onClick={() => setReviewRatings(prev => ({ ...prev, [booking.id]: star }))}
                          >
                            <Star
                              className={`w-7 h-7 transition-colors ${
                                star <= (reviewRatings[booking.id] || 0)
                                  ? 'fill-yellow-400 text-yellow-400'
                                  : 'text-muted-foreground'
                              }`}
                            />
                          </button>
                        ))}
                      </div>
                      <textarea
                        rows={3}
                        placeholder="Share your experience (optional)..."
                        value={reviewComments[booking.id] || ''}
                        onChange={e => setReviewComments(prev => ({ ...prev, [booking.id]: e.target.value }))}
                        className="glass-input rounded-2xl p-3 w-full resize-none outline-none placeholder:text-muted-foreground text-sm"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSubmitReview(booking.id)}
                          disabled={reviewMutation.isPending || !reviewRatings[booking.id]}
                          className="btn-glow px-4 py-2 text-white text-sm font-semibold rounded-full disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
                        >
                          {reviewMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : 'Submit Review'}
                        </button>
                        <button
                          onClick={() => setReviewOpen(prev => ({ ...prev, [booking.id]: false }))}
                          className="glass border border-border rounded-full px-4 py-2 hover:glass-strong transition-all text-muted-foreground text-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

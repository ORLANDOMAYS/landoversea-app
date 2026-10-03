import { useState } from 'react';
import { resolveMediaUrl } from '@/lib/media-url';
import { useParams, Link, useLocation } from 'wouter';
import { useGetCoachReviews } from '@workspace/api-client-react';
import {
  Loader2,
  ChevronLeft,
  MessageCircle,
  Star,
  CheckCircle,
} from 'lucide-react';
import {
  CoachBridgeError,
  useApprovedCoach,
  useResolvedLocalCoachId,
} from '@/hooks/use-supabase-surfaces';

const SESSION_TYPES = [
  { minutes: 30, label: '30 min', price: 0.5 },
  { minutes: 60, label: '60 min', price: 1 },
  { minutes: 90, label: '90 min', price: 1.4 },
];

export default function CoachProfile() {
  const { coachId } = useParams<{ coachId: string }>();
  const [, navigate] = useLocation();
  const [selectedSession, setSelectedSession] = useState(60);

  const { data: coach, isLoading } = useApprovedCoach(coachId);
  const {
    data: localCoachId,
    error: bridgeError,
    isLoading: bridgeLoading,
  } = useResolvedLocalCoachId(coachId);
  const isUnlinked =
    bridgeError instanceof CoachBridgeError && bridgeError.code === 'coach_not_linked';
  const { data: reviews } = useGetCoachReviews(localCoachId ?? 0, {
    query: { enabled: Boolean(localCoachId), queryKey: ['coachReviews', localCoachId] },
  });

  if (!coachId) return <div className="p-8 text-foreground text-center">Invalid coach ID</div>;
  if (isLoading || bridgeLoading || !coach) {
    return (
      <div className="flex justify-center items-center min-h-[100dvh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const baseRate = coach.ratesPerHour || 60;

  return (
    <div className="min-h-[100dvh] pb-24">
      {/* Hero */}
      <div className="relative h-64 w-full">
        <img
          src={resolveMediaUrl(coach.photoUrl) || `https://ui-avatars.com/api/?name=${encodeURIComponent(coach.displayName)}&background=8B5CF6&color=fff&size=400`}
          alt={coach.displayName}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#080014] via-[#080014]/40 to-transparent" />

        {/* Back button */}
        <button
          onClick={() => navigate('/coaches')}
          className="absolute top-4 left-4 w-9 h-9 rounded-full glass flex items-center justify-center"
        >
          <ChevronLeft className="w-5 h-5 text-foreground" />
        </button>

        {/* Messages */}
        <Link href="/messages">
          <button className="absolute top-4 right-4 w-9 h-9 rounded-full glass flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-foreground" />
          </button>
        </Link>
      </div>

      {/* Floating avatar */}
      <div className="relative z-10 -mt-16 ml-6 mb-2">
        <img
          src={resolveMediaUrl(coach.photoUrl) || `https://ui-avatars.com/api/?name=${encodeURIComponent(coach.displayName)}&background=8B5CF6&color=fff&size=200`}
          alt={coach.displayName}
          className="w-32 h-32 rounded-full border-4 border-primary/60 glow-pink object-cover"
        />
      </div>

      <div className="max-w-lg mx-auto px-4 space-y-4">
        {/* Info */}
        <div>
          <h1 className="font-serif text-2xl text-foreground">{coach.displayName}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
            <span className="text-yellow-400 font-medium">{coach.rating?.toFixed(1) || 'New'}</span>
            {coach.reviewCount ? (
              <span className="text-muted-foreground text-sm">({coach.reviewCount} reviews)</span>
            ) : null}
          </div>
          {coach.ratesPerHour && (
            <span className="inline-block mt-2 px-3 py-1 glass rounded-full text-primary text-sm border border-primary/30">
              From ${Math.round(baseRate * 0.5)}/session
            </span>
          )}
        </div>

        {/* Languages */}
        {coach.languages && coach.languages.length > 0 && (
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wider mb-2">Languages</p>
            <div className="flex flex-wrap gap-2">
              {coach.languages.map((lang: string) => (
                <span key={lang} className="px-3 py-1 glass rounded-full text-foreground text-sm border border-border">
                  {lang}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Specialties */}
        {coach.specialties && coach.specialties.length > 0 && (
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wider mb-2">Specialties</p>
            <div className="flex flex-wrap gap-2">
              {coach.specialties.map((s: string) => (
                <span key={s} className="px-3 py-1 rounded-full text-secondary text-sm bg-secondary/20 border border-secondary/40">
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Bio */}
        {coach.bio && (
          <div className="glass rounded-2xl p-4">
            <h3 className="font-serif text-foreground text-lg mb-2">About</h3>
            <p className="text-foreground text-sm leading-relaxed">{coach.bio}</p>
          </div>
        )}

        {/* Included benefits */}
        <div className="glass rounded-2xl p-4">
          <h3 className="font-serif text-foreground text-lg mb-3">What's Included</h3>
          <div className="space-y-2">
            {[
              'Cultural Coaching',
              'Language Practice',
              'Dating Strategy',
              'Message Review',
              'Video or Audio Session',
            ].map(benefit => (
              <div key={benefit} className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-cyan-400 shrink-0" />
                <span className="text-foreground text-sm">{benefit}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Session types */}
        <div>
          <h3 className="font-serif text-foreground text-lg mb-3">Session Length</h3>
          <div className="grid grid-cols-3 gap-3">
            {SESSION_TYPES.map(session => {
              const price = Math.round(baseRate * session.price);
              const isSelected = selectedSession === session.minutes;
              return (
                <button
                  key={session.minutes}
                  onClick={() => setSelectedSession(session.minutes)}
                  className={`glass rounded-2xl p-4 text-center transition-all ${
                    isSelected
                      ? 'border-primary/60 glow-pink bg-primary/10'
                      : 'border border-border'
                  }`}
                >
                  <p className="font-serif text-foreground text-base">{session.label}</p>
                  <p className="text-muted-foreground text-sm mt-1">${price}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Reviews */}
        <div>
          <h3 className="font-serif text-foreground text-lg mb-3">Reviews</h3>
          {isUnlinked ? (
            <div className="glass rounded-2xl p-6 text-center">
              <p className="text-muted-foreground text-sm">
                Reviews and booking will be available after this coach links their booking profile.
                Their coach profile is still safe to browse.
              </p>
            </div>
          ) : !reviews || reviews.length === 0 ? (
            <div className="glass rounded-2xl p-6 text-center">
              <p className="text-muted-foreground text-sm">No reviews yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reviews.map(review => (
                <div key={review.id} className="glass rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">
                      {review.clientName?.[0] || 'A'}
                    </div>
                    <span className="text-foreground text-sm font-medium">{review.clientName || 'Anonymous'}</span>
                    <div className="flex ml-auto">
                      {[1, 2, 3, 4, 5].map(i => (
                        <Star
                          key={i}
                          className={`w-3 h-3 ${i <= review.rating ? 'text-yellow-400 fill-yellow-400' : 'text-muted-foreground'}`}
                        />
                      ))}
                    </div>
                  </div>
                  {review.comment && (
                    <p className="text-foreground text-sm">{review.comment}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Sticky bottom bar */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 px-4 py-3 flex items-center justify-between"
        style={{
          background: 'var(--nav-bg)',
          backdropFilter: 'blur(20px)',
          borderTop: '1px solid var(--nav-border)',
        }}
      >
        <div>
          <p className="text-muted-foreground text-xs">Selected</p>
          <p className="text-foreground font-medium text-sm">
            {selectedSession} min · ${Math.round(baseRate * (SESSION_TYPES.find(s => s.minutes === selectedSession)?.price ?? 1))}
          </p>
        </div>
        {localCoachId ? (
          <Link href={`/coaches/${coachId}/book`}>
            <button className="btn-glow px-6 py-2.5 text-white font-semibold rounded-full">
              Book a Session
            </button>
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className="px-6 py-2.5 font-semibold rounded-full bg-muted text-muted-foreground cursor-not-allowed"
          >
            Booking unavailable
          </button>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Star,
  Shield,
  Globe,
  Clock,
  Calendar,
  MessageCircle,
  Crown,
  Check,
} from "lucide-react";
import {
  getCoach,
  getCoachReviews,
  getCurrentUser,
  getProfile,
  bookCoachSession,
} from "../../../../lib/api";
import type { Coach, CoachReview } from "../../../../lib/types";
import { LANGUAGES } from "../../../../lib/types";

export default function CoachProfilePage() {
  const params = useParams();
  const router = useRouter();
  const coachId = params.id as string;

  const [coach, setCoach] = useState<Coach | null>(null);
  const [reviews, setReviews] = useState<CoachReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [selectedDuration, setSelectedDuration] = useState(60);

  useEffect(() => {
    Promise.all([
      getCoach(coachId),
      getCoachReviews(coachId),
      getCurrentUser(),
    ]).then(async ([c, r, user]) => {
      setCoach(c);
      setReviews(r);
      if (user) setUserId(user.id);
      setLoading(false);
    });
  }, [coachId]);

  async function handleBook() {
    if (!userId || !coach || !selectedDate || !selectedTime) return;
    setBooking(true);

    const scheduledAt = new Date(`${selectedDate}T${selectedTime}`).toISOString();
    const amount = (coach.hourly_rate * selectedDuration) / 60;

    const session = await bookCoachSession(
      coach.id,
      userId,
      scheduledAt,
      selectedDuration,
      amount,
      coach.platform_fee_percent
    );

    if (session) {
      setBookingSuccess(true);
    }
    setBooking(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <div className="animate-pulse text-rose-600">Loading coach profile...</div>
      </div>
    );
  }

  if (!coach) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <p className="text-gray-500">Coach not found</p>
      </div>
    );
  }

  const coachFeatures = [
    "AI-generated profile photos",
    "Personality-matched bios",
    "Psychology-based openers",
    "Real-time coaching sessions",
    "Voice coaching & feedback",
    "Success tracking & analytics",
  ];

  return (
    <div className="max-w-lg mx-auto px-4 py-4 pb-8">
      {/* Back */}
      <button
        onClick={() => router.push("/app/coaches")}
        className="flex items-center gap-1 text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to coaches
      </button>

      {/* Profile Header */}
      <div className="bg-white rounded-2xl p-5 border border-gray-100 mb-4">
        <div className="flex items-start gap-4">
          <img
            src={
              coach.avatar_url ??
              `https://ui-avatars.com/api/?name=${encodeURIComponent(coach.display_name)}&size=120&background=f43f5e&color=fff`
            }
            alt={coach.display_name}
            className="w-20 h-20 rounded-full object-cover flex-shrink-0"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{coach.display_name}</h1>
              {coach.verified && (
                <Shield className="w-5 h-5 text-blue-500" fill="currentColor" />
              )}
            </div>

            <div className="flex items-center gap-1 mt-1">
              <Star className="w-4 h-4 text-amber-500" fill="currentColor" />
              <span className="font-medium">
                {coach.rating > 0 ? coach.rating.toFixed(1) : "New"}
              </span>
              <span className="text-sm text-gray-400">
                ({coach.total_reviews} reviews)
              </span>
            </div>

            <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {coach.total_sessions} sessions
              </span>
              <span className="flex items-center gap-1">
                <Globe className="w-3.5 h-3.5" />
                {coach.languages.map((l) => LANGUAGES[l] ?? l).join(", ")}
              </span>
            </div>
          </div>
        </div>

        {coach.bio && (
          <p className="text-sm text-gray-600 mt-4 leading-relaxed">{coach.bio}</p>
        )}

        {/* Specialties */}
        <div className="flex flex-wrap gap-2 mt-4">
          {coach.specialties.map((spec) => (
            <span
              key={spec}
              className="text-xs px-3 py-1 bg-rose-50 text-rose-600 rounded-full font-medium"
            >
              {spec}
            </span>
          ))}
        </div>
      </div>

      {/* Coach Features */}
      <div className="bg-gradient-to-br from-amber-50 to-rose-50 rounded-2xl p-5 border border-amber-200 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Crown className="w-5 h-5 text-amber-500" />
          <h2 className="font-semibold">What You Get</h2>
        </div>
        <div className="grid grid-cols-1 gap-2">
          {coachFeatures.map((feature) => (
            <div key={feature} className="flex items-center gap-2 text-sm text-gray-700">
              <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
              {feature}
            </div>
          ))}
        </div>
      </div>

      {/* Pricing */}
      <div className="bg-white rounded-2xl p-5 border border-gray-100 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Crown className="w-5 h-5 text-amber-500" />
          <h2 className="font-semibold">Pricing</h2>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold text-gray-900">${coach.hourly_rate}</span>
          <span className="text-gray-500">/hour</span>
        </div>
        <p className="text-xs text-gray-400 mt-1">
          Platform fee: {coach.platform_fee_percent}% &middot; Secure payments
        </p>
      </div>

      {/* Book Session */}
      {bookingSuccess ? (
        <div className="bg-green-50 rounded-2xl p-5 border border-green-200 text-center">
          <Check className="w-12 h-12 text-green-500 mx-auto mb-2" />
          <h3 className="font-bold text-green-700 mb-1">Session Booked!</h3>
          <p className="text-sm text-green-600">
            Your coach will confirm the session shortly.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl p-5 border border-gray-100 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-5 h-5 text-rose-600" />
            <h2 className="font-semibold">Book a Session</h2>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-700">Date</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                className="mt-1 w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">Time</label>
              <input
                type="time"
                value={selectedTime}
                onChange={(e) => setSelectedTime(e.target.value)}
                className="mt-1 w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">Duration</label>
              <select
                value={selectedDuration}
                onChange={(e) => setSelectedDuration(Number(e.target.value))}
                className="mt-1 w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 bg-white"
              >
                <option value={30}>30 minutes — ${(coach.hourly_rate * 0.5).toFixed(2)}</option>
                <option value={60}>1 hour — ${coach.hourly_rate.toFixed(2)}</option>
                <option value={90}>1.5 hours — ${(coach.hourly_rate * 1.5).toFixed(2)}</option>
                <option value={120}>2 hours — ${(coach.hourly_rate * 2).toFixed(2)}</option>
              </select>
            </div>
          </div>

          <button
            onClick={handleBook}
            disabled={booking || !selectedDate || !selectedTime}
            className="w-full mt-4 py-3 bg-rose-600 text-white rounded-xl font-semibold hover:bg-rose-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Calendar className="w-5 h-5" />
            {booking
              ? "Booking..."
              : `Book Session — $${((coach.hourly_rate * selectedDuration) / 60).toFixed(2)}`}
          </button>
        </div>
      )}

      {/* Reviews */}
      <div className="bg-white rounded-2xl p-5 border border-gray-100">
        <div className="flex items-center gap-2 mb-4">
          <MessageCircle className="w-5 h-5 text-rose-600" />
          <h2 className="font-semibold">Reviews ({reviews.length})</h2>
        </div>

        {reviews.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">No reviews yet</p>
        ) : (
          <div className="space-y-3">
            {reviews.map((review) => (
              <div key={review.id} className="border-b border-gray-100 pb-3 last:border-0">
                <div className="flex items-center gap-1 mb-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`w-3.5 h-3.5 ${
                        i < review.rating ? "text-amber-500" : "text-gray-200"
                      }`}
                      fill="currentColor"
                    />
                  ))}
                  <span className="text-xs text-gray-400 ml-2">
                    {new Date(review.created_at).toLocaleDateString()}
                  </span>
                </div>
                {review.review && (
                  <p className="text-sm text-gray-600">{review.review}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

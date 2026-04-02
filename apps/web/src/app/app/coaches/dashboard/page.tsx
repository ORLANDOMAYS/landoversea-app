"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  Clock,
  DollarSign,
  Star,
  Users,
  Check,
  X as XIcon,
  Crown,
  TrendingUp,
  Edit,
  Save,
} from "lucide-react";
import {
  getCurrentUser,
  getCoachByUserId,
  getCoachSessions,
  getCoachReviews,
  updateCoachProfile,
  updateSessionStatus,
} from "../../../../lib/api";
import type { Coach, CoachSession, CoachReview } from "../../../../lib/types";
import { COACH_SPECIALTIES } from "../../../../lib/types";

export default function CoachDashboardPage() {
  const router = useRouter();
  const [coach, setCoach] = useState<Coach | null>(null);
  const [sessions, setSessions] = useState<CoachSession[]>([]);
  const [reviews, setReviews] = useState<CoachReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"sessions" | "reviews" | "settings">("sessions");
  const [editingBio, setEditingBio] = useState(false);
  const [bio, setBio] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getCurrentUser().then(async (user) => {
      if (!user) return;
      const coachProfile = await getCoachByUserId(user.id);
      if (!coachProfile) {
        router.replace("/app/coaches/apply");
        return;
      }
      setCoach(coachProfile);
      setBio(coachProfile.bio ?? "");
      setHourlyRate(coachProfile.hourly_rate.toString());

      const [s, r] = await Promise.all([
        getCoachSessions(coachProfile.id),
        getCoachReviews(coachProfile.id),
      ]);
      setSessions(s);
      setReviews(r);
      setLoading(false);
    });
  }, [router]);

  async function handleSessionAction(sessionId: string, status: "confirmed" | "canceled") {
    await updateSessionStatus(sessionId, status);
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, status } : s))
    );
  }

  async function handleSaveProfile() {
    if (!coach) return;
    setSaving(true);
    await updateCoachProfile(coach.id, {
      bio,
      hourly_rate: parseFloat(hourlyRate) || coach.hourly_rate,
    });
    setSaving(false);
    setEditingBio(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <div className="animate-pulse text-rose-600">Loading dashboard...</div>
      </div>
    );
  }

  if (!coach) return null;

  const totalEarnings = sessions
    .filter((s) => s.status === "completed")
    .reduce((sum, s) => sum + s.coach_payout, 0);

  const pendingSessions = sessions.filter((s) => s.status === "pending");
  const upcomingSessions = sessions.filter((s) => s.status === "confirmed");
  const completedSessions = sessions.filter((s) => s.status === "completed");

  return (
    <div className="max-w-lg mx-auto px-4 py-4 pb-8">
      {/* Back */}
      <button
        onClick={() => router.push("/app/coaches")}
        className="flex items-center gap-1 text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to coaches
      </button>

      <h1 className="text-xl font-bold mb-4">Coach Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white rounded-xl p-3 border border-gray-100 text-center">
          <DollarSign className="w-5 h-5 text-green-500 mx-auto mb-1" />
          <div className="text-lg font-bold">${totalEarnings.toFixed(0)}</div>
          <div className="text-xs text-gray-400">Earnings</div>
        </div>
        <div className="bg-white rounded-xl p-3 border border-gray-100 text-center">
          <Users className="w-5 h-5 text-blue-500 mx-auto mb-1" />
          <div className="text-lg font-bold">{coach.total_sessions}</div>
          <div className="text-xs text-gray-400">Sessions</div>
        </div>
        <div className="bg-white rounded-xl p-3 border border-gray-100 text-center">
          <Star className="w-5 h-5 text-amber-500 mx-auto mb-1" />
          <div className="text-lg font-bold">
            {coach.rating > 0 ? coach.rating.toFixed(1) : "—"}
          </div>
          <div className="text-xs text-gray-400">Rating</div>
        </div>
      </div>

      {/* Monthly Fee Status */}
      <div className={`rounded-xl p-3 mb-4 flex items-center gap-3 ${
        coach.monthly_fee_paid
          ? "bg-green-50 border border-green-200"
          : "bg-amber-50 border border-amber-200"
      }`}>
        <Crown className={`w-5 h-5 ${coach.monthly_fee_paid ? "text-green-500" : "text-amber-500"}`} />
        <div className="flex-1">
          <p className="text-sm font-medium">
            {coach.monthly_fee_paid ? "Monthly Fee Paid" : "Monthly Fee Due"}
          </p>
          <p className="text-xs text-gray-500">${coach.monthly_fee_amount}/month platform fee</p>
        </div>
        {!coach.monthly_fee_paid && (
          <button className="text-xs px-3 py-1.5 bg-amber-500 text-white rounded-full font-medium">
            Pay Now
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-4">
        {(["sessions", "reviews", "settings"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition ${
              activeTab === tab
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Sessions Tab */}
      {activeTab === "sessions" && (
        <div className="space-y-3">
          {/* Pending */}
          {pendingSessions.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-amber-600 flex items-center gap-1">
                <Clock className="w-4 h-4" /> Pending ({pendingSessions.length})
              </h3>
              {pendingSessions.map((session) => (
                <div key={session.id} className="bg-amber-50 rounded-xl p-4 border border-amber-200">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-sm font-medium">
                        {new Date(session.scheduled_at).toLocaleDateString()} at{" "}
                        {new Date(session.scheduled_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                      <p className="text-xs text-gray-500">{session.duration_minutes} min</p>
                    </div>
                    <span className="text-sm font-bold text-green-600">
                      +${session.coach_payout.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSessionAction(session.id, "confirmed")}
                      className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" /> Confirm
                    </button>
                    <button
                      onClick={() => handleSessionAction(session.id, "canceled")}
                      className="flex-1 py-2 bg-white text-gray-600 rounded-lg text-sm font-medium border border-gray-200 flex items-center justify-center gap-1"
                    >
                      <XIcon className="w-3.5 h-3.5" /> Decline
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Upcoming */}
          {upcomingSessions.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-blue-600 flex items-center gap-1">
                <Calendar className="w-4 h-4" /> Upcoming ({upcomingSessions.length})
              </h3>
              {upcomingSessions.map((session) => (
                <div key={session.id} className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {new Date(session.scheduled_at).toLocaleDateString()} at{" "}
                        {new Date(session.scheduled_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                      <p className="text-xs text-gray-500">{session.duration_minutes} min</p>
                    </div>
                    <span className="text-sm font-bold text-green-600">
                      +${session.coach_payout.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Completed */}
          {completedSessions.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-green-600 flex items-center gap-1">
                <TrendingUp className="w-4 h-4" /> Completed ({completedSessions.length})
              </h3>
              {completedSessions.map((session) => (
                <div key={session.id} className="bg-white rounded-xl p-4 border border-gray-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {new Date(session.scheduled_at).toLocaleDateString()}
                      </p>
                      <p className="text-xs text-gray-500">{session.duration_minutes} min</p>
                    </div>
                    <span className="text-sm font-bold text-green-600">
                      +${session.coach_payout.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}

          {sessions.length === 0 && (
            <div className="text-center py-8">
              <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No sessions yet</p>
              <p className="text-sm text-gray-400 mt-1">
                Sessions will appear here once clients book with you
              </p>
            </div>
          )}
        </div>
      )}

      {/* Reviews Tab */}
      {activeTab === "reviews" && (
        <div className="space-y-3">
          {reviews.length === 0 ? (
            <div className="text-center py-8">
              <Star className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No reviews yet</p>
            </div>
          ) : (
            reviews.map((review) => (
              <div key={review.id} className="bg-white rounded-xl p-4 border border-gray-100">
                <div className="flex items-center gap-1 mb-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`w-4 h-4 ${
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
            ))
          )}
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === "settings" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Edit className="w-4 h-4 text-gray-500" /> Profile
              </h3>
              {!editingBio ? (
                <button
                  onClick={() => setEditingBio(true)}
                  className="text-xs text-rose-600 font-medium"
                >
                  Edit
                </button>
              ) : (
                <button
                  onClick={handleSaveProfile}
                  disabled={saving}
                  className="text-xs px-3 py-1 bg-rose-600 text-white rounded-full font-medium flex items-center gap-1"
                >
                  <Save className="w-3 h-3" />
                  {saving ? "Saving..." : "Save"}
                </button>
              )}
            </div>

            {editingBio ? (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-gray-700">Bio</label>
                  <textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    rows={4}
                    className="mt-1 w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Hourly Rate ($)</label>
                  <input
                    type="number"
                    value={hourlyRate}
                    onChange={(e) => setHourlyRate(e.target.value)}
                    className="mt-1 w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 text-sm"
                  />
                </div>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-600 mb-2">{coach.bio || "No bio set"}</p>
                <p className="text-sm font-medium">${coach.hourly_rate}/hour</p>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <h3 className="font-semibold mb-2">Specialties</h3>
            <div className="flex flex-wrap gap-2">
              {coach.specialties.map((spec) => (
                <span
                  key={spec}
                  className="text-xs px-3 py-1 bg-rose-50 text-rose-600 rounded-full"
                >
                  {spec}
                </span>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <h3 className="font-semibold mb-2">Platform Fee Breakdown</h3>
            <div className="space-y-1 text-sm text-gray-600">
              <div className="flex justify-between">
                <span>Monthly subscription</span>
                <span className="font-medium">${coach.monthly_fee_amount}/mo</span>
              </div>
              <div className="flex justify-between">
                <span>Per-session fee</span>
                <span className="font-medium">{coach.platform_fee_percent}%</span>
              </div>
              <div className="flex justify-between border-t border-gray-100 pt-1 mt-1">
                <span>Your take-home</span>
                <span className="font-bold text-green-600">{100 - coach.platform_fee_percent}%</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

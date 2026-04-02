"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Crown,
  Check,
  DollarSign,
  Users,
  Star,
  Shield,
} from "lucide-react";
import { getCurrentUser, applyAsCoach } from "../../../../lib/api";
import { COACH_SPECIALTIES } from "../../../../lib/types";

export default function ApplyCoachPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [hourlyRate, setHourlyRate] = useState("50");
  const [selectedSpecialties, setSelectedSpecialties] = useState<string[]>([]);

  useEffect(() => {
    getCurrentUser().then((user) => {
      if (user) setUserId(user.id);
      setLoading(false);
    });
  }, []);

  function toggleSpecialty(spec: string) {
    setSelectedSpecialties((prev) =>
      prev.includes(spec)
        ? prev.filter((s) => s !== spec)
        : prev.length < 5
          ? [...prev, spec]
          : prev
    );
  }

  async function handleSubmit() {
    if (!userId || !displayName || selectedSpecialties.length === 0) return;
    setSubmitting(true);

    const coach = await applyAsCoach(userId, {
      display_name: displayName,
      bio: bio || "",
      specialties: selectedSpecialties,
      hourly_rate: parseFloat(hourlyRate) || 50,
      languages: ["en"],
    });

    if (coach) {
      setSuccess(true);
    }
    setSubmitting(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <div className="animate-pulse text-rose-600">Loading...</div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="max-w-lg mx-auto px-4 py-8">
        <div className="bg-green-50 rounded-2xl p-8 border border-green-200 text-center">
          <Check className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-green-700 mb-2">Application Submitted!</h2>
          <p className="text-green-600 mb-6">
            Welcome to the LandOverSea coaching team. Your dashboard is ready.
          </p>
          <button
            onClick={() => router.push("/app/coaches/dashboard")}
            className="px-6 py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-4 pb-8">
      {/* Back */}
      <button
        onClick={() => router.push("/app/coaches")}
        className="flex items-center gap-1 text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to coaches
      </button>

      <h1 className="text-xl font-bold mb-2">Become a Dating Coach</h1>
      <p className="text-sm text-gray-500 mb-6">
        Help singles find love and earn money doing what you love.
      </p>

      {/* Benefits */}
      <div className="bg-gradient-to-br from-amber-50 to-rose-50 rounded-2xl p-5 border border-amber-200 mb-6">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <Crown className="w-5 h-5 text-amber-500" /> Why Coach on LandOverSea?
        </h2>
        <div className="space-y-2">
          {[
            { icon: DollarSign, text: "Set your own rates and keep 80% of earnings" },
            { icon: Users, text: "Access to a global community of singles" },
            { icon: Star, text: "Build your reputation with verified reviews" },
            { icon: Shield, text: "Secure payments and session tracking" },
          ].map((item) => (
            <div key={item.text} className="flex items-center gap-2 text-sm text-gray-700">
              <item.icon className="w-4 h-4 text-amber-600 flex-shrink-0" />
              {item.text}
            </div>
          ))}
        </div>
        <div className="mt-3 p-3 bg-white/60 rounded-xl">
          <p className="text-xs text-gray-600">
            <strong>Platform Fee:</strong> 20% of session earnings + $50/month subscription.
            You keep 80% of every session.
          </p>
        </div>
      </div>

      {/* Application Form */}
      <div className="bg-white rounded-2xl p-5 border border-gray-100">
        <h2 className="font-semibold mb-4">Your Coach Profile</h2>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700">Display Name *</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="How clients will see you"
              className="mt-1 w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Bio</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell clients about your experience, approach, and what makes you unique..."
              rows={4}
              className="mt-1 w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Hourly Rate ($)</label>
            <input
              type="number"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              min="10"
              max="500"
              className="mt-1 w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              You earn ${((parseFloat(hourlyRate) || 50) * 0.8).toFixed(2)}/hr after 20% platform fee
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">
              Specialties * (select up to 5)
            </label>
            <div className="flex flex-wrap gap-2 mt-2">
              {COACH_SPECIALTIES.map((spec) => (
                <button
                  key={spec}
                  onClick={() => toggleSpecialty(spec)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition ${
                    selectedSpecialties.includes(spec)
                      ? "bg-rose-600 text-white border-rose-600"
                      : "bg-white text-gray-600 border-gray-200 hover:border-rose-300"
                  }`}
                >
                  {selectedSpecialties.includes(spec) && (
                    <Check className="w-3 h-3 inline mr-1" />
                  )}
                  {spec}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={submitting || !displayName || selectedSpecialties.length === 0}
          className="w-full mt-6 py-3 bg-gradient-to-r from-amber-500 to-rose-500 text-white rounded-xl font-semibold hover:from-amber-600 hover:to-rose-600 transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Crown className="w-5 h-5" />
          {submitting ? "Submitting..." : "Apply as Coach — $50/month"}
        </button>
      </div>
    </div>
  );
}

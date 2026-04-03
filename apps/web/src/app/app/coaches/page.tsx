"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Star,
  Shield,
  Globe,
  MessageCircle,
  Search,
  Crown,
  Users,
} from "lucide-react";
import { getCoaches, getCurrentUser, getCoachByUserId } from "../../../lib/api";
import type { Coach } from "../../../lib/types";
import { LANGUAGES } from "../../../lib/types";

export default function CoachesPage() {
  const router = useRouter();
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [isCoach, setIsCoach] = useState(false);

  useEffect(() => {
    Promise.all([getCoaches(), getCurrentUser()]).then(async ([c, user]) => {
      setCoaches(c);
      if (user) {
        const coachProfile = await getCoachByUserId(user.id);
        setIsCoach(!!coachProfile);
      }
      setLoading(false);
    });
  }, []);

  const filteredCoaches = coaches.filter(
    (c) =>
      c.display_name.toLowerCase().includes(search.toLowerCase()) ||
      c.specialties.some((s) => s.toLowerCase().includes(search.toLowerCase()))
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <div className="animate-pulse text-rose-600">Loading coaches...</div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-4 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Dating Coaches</h1>
        {isCoach ? (
          <button
            onClick={() => router.push("/app/coaches/dashboard")}
            className="text-sm px-4 py-2 bg-rose-600 text-white rounded-full font-medium hover:bg-rose-700 transition"
          >
            Dashboard
          </button>
        ) : (
          <button
            onClick={() => router.push("/app/coaches/apply")}
            className="text-sm px-4 py-2 bg-gradient-to-r from-amber-500 to-rose-500 text-white rounded-full font-medium hover:from-amber-600 hover:to-rose-600 transition"
          >
            Become a Coach
          </button>
        )}
      </div>

      {/* Info banner */}
      <div className="bg-gradient-to-r from-rose-50 to-pink-50 rounded-2xl p-4 mb-4 border border-rose-100">
        <div className="flex items-start gap-3">
          <Users className="w-8 h-8 text-rose-500 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-gray-900 mb-1">Expert Dating Coaches</h3>
            <p className="text-sm text-gray-600">
              Get personalized help from verified dating experts. Profile optimization,
              conversation skills, first date coaching, and more.
            </p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search coaches by name or specialty..."
          className="w-full pl-11 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
        />
      </div>

      {/* Coach List */}
      {filteredCoaches.length === 0 ? (
        <div className="text-center py-10">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No coaches available yet.</p>
          <p className="text-sm text-gray-400 mt-1">Be the first to join as a dating coach!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredCoaches.map((coach) => (
            <button
              key={coach.id}
              onClick={() => router.push(`/app/coaches/${coach.id}`)}
              className="w-full bg-white rounded-2xl p-4 border border-gray-100 hover:border-rose-200 hover:shadow-md transition text-left"
            >
              <div className="flex items-start gap-3">
                <img
                  src={
                    coach.avatar_url ??
                    `https://ui-avatars.com/api/?name=${encodeURIComponent(coach.display_name)}&background=f43f5e&color=fff`
                  }
                  alt={coach.display_name}
                  className="w-14 h-14 rounded-full object-cover flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900 truncate">{coach.display_name}</h3>
                    {coach.verified && (
                      <Shield className="w-4 h-4 text-blue-500 flex-shrink-0" fill="currentColor" />
                    )}
                  </div>

                  {/* Rating */}
                  <div className="flex items-center gap-1 mt-0.5">
                    <Star className="w-3.5 h-3.5 text-amber-500" fill="currentColor" />
                    <span className="text-sm font-medium text-gray-700">
                      {coach.rating > 0 ? coach.rating.toFixed(1) : "New"}
                    </span>
                    <span className="text-xs text-gray-400">
                      ({coach.total_reviews} reviews)
                    </span>
                    <span className="text-xs text-gray-400 mx-1">&middot;</span>
                    <span className="text-xs text-gray-400">
                      {coach.total_sessions} sessions
                    </span>
                  </div>

                  {/* Specialties */}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {coach.specialties.slice(0, 3).map((spec) => (
                      <span
                        key={spec}
                        className="text-[10px] px-2 py-0.5 bg-rose-50 text-rose-600 rounded-full"
                      >
                        {spec}
                      </span>
                    ))}
                    {coach.specialties.length > 3 && (
                      <span className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">
                        +{coach.specialties.length - 3}
                      </span>
                    )}
                  </div>

                  {/* Languages & Rate */}
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                      <Globe className="w-3 h-3" />
                      {coach.languages.map((l) => LANGUAGES[l] ?? l).join(", ")}
                    </div>
                    <div className="flex items-center gap-1">
                      <Crown className="w-3 h-3 text-amber-500" />
                      <span className="text-sm font-bold text-gray-900">
                        ${coach.hourly_rate}/hr
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Platform Info */}
      <div className="mt-6 p-4 bg-gray-50 rounded-xl">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Coach Premium Features
        </h3>
        <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
          <div className="flex items-center gap-1.5">
            <MessageCircle className="w-3 h-3 text-rose-500" />
            AI-powered openers
          </div>
          <div className="flex items-center gap-1.5">
            <Star className="w-3 h-3 text-rose-500" />
            Profile optimization
          </div>
          <div className="flex items-center gap-1.5">
            <Shield className="w-3 h-3 text-rose-500" />
            Voice coaching
          </div>
          <div className="flex items-center gap-1.5">
            <Globe className="w-3 h-3 text-rose-500" />
            Cultural dating tips
          </div>
        </div>
      </div>
    </div>
  );
}

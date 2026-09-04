"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, X, Star, MapPin, Shield, SlidersHorizontal } from "lucide-react";
import { getCurrentUser, getDiscoverProfiles, recordSwipe, checkNewMatch } from "../../lib/api";
import type { ProfileWithPhotos } from "../../lib/types";
import { nextSwipeState } from "../../lib/dating-state";

export default function SwipePage() {
  const [profiles, setProfiles] = useState<ProfileWithPhotos[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [matchPopup, setMatchPopup] = useState<string | null>(null);
  const [swipeDirection, setSwipeDirection] = useState<"left" | "right" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({ minAge: "18", maxAge: "120", gender: "", location: "" });
  const [appliedFilters, setAppliedFilters] = useState(filters);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const user = await getCurrentUser();
      if (user) {
        setUserId(user.id);
        const p = await getDiscoverProfiles(user.id, {
          minAge: appliedFilters.minAge ? Number(appliedFilters.minAge) : undefined,
          maxAge: appliedFilters.maxAge ? Number(appliedFilters.maxAge) : undefined,
          gender: appliedFilters.gender || undefined,
          location: appliedFilters.location || undefined,
        });
        setProfiles(p);
        setCurrentIndex(0);
      } else {
        setError("Please sign in to discover people.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load profiles.");
    } finally {
      setLoading(false);
    }
  }, [appliedFilters]);

  useEffect(() => { void loadProfiles(); }, [loadProfiles]);

  const handleSwipe = useCallback(
    async (direction: "like" | "pass" | "superlike") => {
      if (!userId || currentIndex >= profiles.length || swipeDirection !== null) return;
      const profile = profiles[currentIndex];

      setError(null);
      try {
        await recordSwipe(userId, profile.id, direction);
        if (direction !== "pass") {
          const match = await checkNewMatch(userId, profile.id);
          if (match) {
            setMatchPopup(profile.display_name ?? "Someone");
            setTimeout(() => setMatchPopup(null), 3000);
          }
        }
        setSwipeDirection(direction === "pass" ? "left" : "right");
        setTimeout(() => {
          setSwipeDirection(null);
          setCurrentIndex((prev) => nextSwipeState(prev, true));
        }, 300);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Swipe could not be saved. Please retry.");
      }
    },
    [userId, currentIndex, profiles, swipeDirection]
  );

  const currentProfile = profiles[currentIndex];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <div className="text-center">
          <Heart className="w-12 h-12 text-rose-600 animate-pulse mx-auto mb-4" />
          <p className="text-gray-500">Finding people near you...</p>
        </div>
      </div>
    );
  }

  if (error && !currentProfile) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <div className="text-center px-6" role="alert">
          <p className="text-red-700 mb-4">{error}</p>
          <button onClick={() => void loadProfiles()} className="rounded-xl bg-rose-600 px-4 py-2 text-white">Retry</button>
        </div>
      </div>
    );
  }

  if (!currentProfile) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <div className="text-center px-6">
          <Heart className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-700 mb-2">No More Profiles</h2>
          <p className="text-gray-500 mb-4">
            {"You've seen everyone nearby. Check back later for new people!"}
          </p>
          <button onClick={() => void loadProfiles()} className="rounded-xl border border-rose-600 px-4 py-2 text-rose-600">Refresh</button>
        </div>
      </div>
    );
  }

  const photoUrl =
    currentProfile.photos[0]?.url ??
    currentProfile.avatar_url ??
    `https://ui-avatars.com/api/?name=${encodeURIComponent(currentProfile.display_name ?? "?")}&size=400&background=f43f5e&color=fff`;

  return (
    <div className="flex flex-col items-center px-4 py-4 max-w-md mx-auto">
      <div className="w-full mb-3">
        <button aria-expanded={filtersOpen} aria-controls="discover-filters" onClick={() => setFiltersOpen((open) => !open)} className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm">
          <SlidersHorizontal className="h-4 w-4" /> Filters
        </button>
        {filtersOpen && (
          <div id="discover-filters" className="mt-2 grid grid-cols-2 gap-2 rounded-xl border bg-white p-3">
            <label className="text-xs">Minimum age<input aria-label="Minimum age" type="number" min="18" max="120" value={filters.minAge} onChange={(e) => setFilters({ ...filters, minAge: e.target.value })} className="mt-1 w-full rounded border p-2" /></label>
            <label className="text-xs">Maximum age<input aria-label="Maximum age" type="number" min="18" max="120" value={filters.maxAge} onChange={(e) => setFilters({ ...filters, maxAge: e.target.value })} className="mt-1 w-full rounded border p-2" /></label>
            <label className="text-xs">Gender<select aria-label="Gender filter" value={filters.gender} onChange={(e) => setFilters({ ...filters, gender: e.target.value })} className="mt-1 w-full rounded border p-2"><option value="">Everyone</option><option value="male">Men</option><option value="female">Women</option><option value="non-binary">Non-binary</option><option value="other">Other</option></select></label>
            <label className="text-xs">Location<input aria-label="Location filter" value={filters.location} onChange={(e) => setFilters({ ...filters, location: e.target.value })} className="mt-1 w-full rounded border p-2" placeholder="City or country" /></label>
            <button onClick={() => { const reset = { minAge: "18", maxAge: "120", gender: "", location: "" }; setFilters(reset); setAppliedFilters(reset); }} className="rounded border p-2 text-sm">Reset filters</button>
            <button onClick={() => { setFiltersOpen(false); setAppliedFilters(filters); }} className="rounded bg-rose-600 p-2 text-sm text-white">Apply filters</button>
          </div>
        )}
      </div>
      {error && <p role="alert" className="w-full mb-2 text-sm text-red-700">{error} Retry the action.</p>}
      {/* Match Popup */}
      <AnimatePresence>
        {matchPopup && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          >
            <div className="bg-white rounded-3xl p-8 text-center shadow-2xl">
              <Heart className="w-16 h-16 text-rose-600 mx-auto mb-4" fill="currentColor" />
              <h2 className="text-3xl font-bold mb-2">{"It's a Match!"}</h2>
              <p className="text-gray-500">You and {matchPopup} liked each other</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentProfile.id}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{
            scale: 1,
            opacity: 1,
            x: swipeDirection === "left" ? -300 : swipeDirection === "right" ? 300 : 0,
            rotate: swipeDirection === "left" ? -15 : swipeDirection === "right" ? 15 : 0,
          }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full aspect-[3/4] rounded-2xl overflow-hidden relative shadow-xl bg-white"
        >
          <img
            src={photoUrl}
            alt={currentProfile.display_name ?? "Profile"}
            className="w-full h-full object-cover"
          />

          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />

          {/* Info */}
          <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-2xl font-bold">
                {currentProfile.display_name}
                {currentProfile.age ? `, ${currentProfile.age}` : ""}
              </h2>
              {currentProfile.verified && (
                <Shield className="w-5 h-5 text-blue-400" fill="currentColor" />
              )}
            </div>
            {currentProfile.city && (
              <div className="flex items-center gap-1 text-white/80 text-sm mb-2">
                <MapPin className="w-4 h-4" />
                {currentProfile.city}
                {currentProfile.country ? `, ${currentProfile.country}` : ""}
              </div>
            )}
            {currentProfile.bio && (
              <p className="text-white/90 text-sm line-clamp-2">{currentProfile.bio}</p>
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Action buttons */}
      <div className="flex items-center gap-6 mt-6">
        <button
          aria-label="Pass on this profile"
          onClick={() => handleSwipe("pass")}
          disabled={swipeDirection !== null}
          className="w-14 h-14 rounded-full bg-white shadow-lg flex items-center justify-center border border-gray-200 hover:scale-110 transition disabled:opacity-50"
        >
          <X className="w-7 h-7 text-gray-500" />
        </button>
        <button
          aria-label="Super like this profile"
          onClick={() => handleSwipe("superlike")}
          disabled={swipeDirection !== null}
          className="w-12 h-12 rounded-full bg-white shadow-lg flex items-center justify-center border border-gray-200 hover:scale-110 transition disabled:opacity-50"
        >
          <Star className="w-6 h-6 text-amber-500" fill="currentColor" />
        </button>
        <button
          aria-label="Like this profile"
          onClick={() => handleSwipe("like")}
          disabled={swipeDirection !== null}
          className="w-14 h-14 rounded-full bg-rose-600 shadow-lg flex items-center justify-center hover:scale-110 transition disabled:opacity-50"
        >
          <Heart className="w-7 h-7 text-white" fill="currentColor" />
        </button>
      </div>

      {/* Counter */}
      <p className="text-sm text-gray-400 mt-4">
        {currentIndex + 1} of {profiles.length}
      </p>
    </div>
  );
}

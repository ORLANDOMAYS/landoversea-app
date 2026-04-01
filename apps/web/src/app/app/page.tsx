"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, X, Star, MapPin, Shield } from "lucide-react";
import { getCurrentUser, getDiscoverProfiles, recordSwipe, checkNewMatch } from "../../lib/api";
import type { ProfileWithPhotos } from "../../lib/types";

export default function SwipePage() {
  const [profiles, setProfiles] = useState<ProfileWithPhotos[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [matchPopup, setMatchPopup] = useState<string | null>(null);
  const [swipeDirection, setSwipeDirection] = useState<"left" | "right" | null>(null);

  useEffect(() => {
    getCurrentUser().then((user) => {
      if (user) {
        setUserId(user.id);
        getDiscoverProfiles(user.id).then((p) => {
          setProfiles(p);
          setLoading(false);
        });
      }
    });
  }, []);

  const handleSwipe = useCallback(
    async (direction: "like" | "pass" | "superlike") => {
      if (!userId || currentIndex >= profiles.length || swipeDirection !== null) return;
      const profile = profiles[currentIndex];

      setSwipeDirection(direction === "pass" ? "left" : "right");

      setTimeout(async () => {
        await recordSwipe(userId, profile.id, direction);

        if (direction !== "pass") {
          const match = await checkNewMatch(userId, profile.id);
          if (match) {
            setMatchPopup(profile.display_name ?? "Someone");
            setTimeout(() => setMatchPopup(null), 3000);
          }
        }

        setSwipeDirection(null);
        setCurrentIndex((prev) => prev + 1);
      }, 300);
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

  if (!currentProfile) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <div className="text-center px-6">
          <Heart className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-700 mb-2">No More Profiles</h2>
          <p className="text-gray-500">
            {"You've seen everyone nearby. Check back later for new people!"}
          </p>
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
          onClick={() => handleSwipe("pass")}
          disabled={swipeDirection !== null}
          className="w-14 h-14 rounded-full bg-white shadow-lg flex items-center justify-center border border-gray-200 hover:scale-110 transition disabled:opacity-50"
        >
          <X className="w-7 h-7 text-gray-500" />
        </button>
        <button
          onClick={() => handleSwipe("superlike")}
          disabled={swipeDirection !== null}
          className="w-12 h-12 rounded-full bg-white shadow-lg flex items-center justify-center border border-gray-200 hover:scale-110 transition disabled:opacity-50"
        >
          <Star className="w-6 h-6 text-amber-500" fill="currentColor" />
        </button>
        <button
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

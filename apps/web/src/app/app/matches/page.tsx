"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, MessageCircle } from "lucide-react";
import { getCurrentUser, getMatches } from "../../../lib/api";
import type { MatchWithProfile } from "../../../lib/types";
import { LANGUAGES } from "../../../lib/types";

export default function MatchesPage() {
  const router = useRouter();
  const [matches, setMatches] = useState<MatchWithProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentUser().then((user) => {
      if (user) {
        getMatches(user.id).then((m) => {
          setMatches(m);
          setLoading(false);
        });
      }
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <Heart className="w-10 h-10 text-rose-600 animate-pulse" />
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <div className="text-center px-6">
          <MessageCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-700 mb-2">No Matches Yet</h2>
          <p className="text-gray-500">
            Start swiping to find your matches!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-4">
      <h1 className="text-xl font-bold mb-4">Your Matches</h1>

      <div className="space-y-2">
        {matches.map((match) => {
          const p = match.profile;
          const avatarUrl =
            p?.avatar_url ??
            `https://ui-avatars.com/api/?name=${encodeURIComponent(p?.display_name ?? "?")}&background=f43f5e&color=fff`;

          return (
            <button
              key={match.id}
              onClick={() => router.push(`/app/chat?matchId=${match.id}`)}
              className="w-full flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-100 hover:shadow-md transition text-left"
            >
              <img
                src={avatarUrl}
                alt={p?.display_name ?? "Match"}
                className="w-14 h-14 rounded-full object-cover"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900 truncate">
                    {p?.display_name ?? "Unknown"}
                  </span>
                  {p?.language && p.language !== "en" && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                      {LANGUAGES[p.language] ?? p.language}
                    </span>
                  )}
                </div>
                {match.lastMessage ? (
                  <p className="text-sm text-gray-500 truncate">
                    {match.lastMessage.body}
                  </p>
                ) : (
                  <p className="text-sm text-rose-500 italic">Say hello!</p>
                )}
              </div>
              <MessageCircle className="w-5 h-5 text-gray-400 shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

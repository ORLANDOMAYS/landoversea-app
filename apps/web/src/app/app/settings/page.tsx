"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LogOut,
  Globe,
  MapPin,
  Crown,
  Plus,
  Trash2,
  Save,
} from "lucide-react";
import { supabase } from "../../../lib/supabase";
import {
  getCurrentUser,
  getProfile,
  upsertProfile,
  getUserLocations,
  addUserLocation,
  removeUserLocation,
} from "../../../lib/api";
import { LANGUAGES } from "../../../lib/types";
import type { Profile, UserLocation } from "../../../lib/types";

export default function SettingsPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState("en");
  const [premium, setPremium] = useState(false);
  const [locations, setLocations] = useState<UserLocation[]>([]);
  const [newCity, setNewCity] = useState("");
  const [newCountry, setNewCountry] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getCurrentUser().then(async (user) => {
      if (!user) return;
      setUserId(user.id);

      const [profile, locs] = await Promise.all([
        getProfile(user.id),
        getUserLocations(user.id),
      ]);

      if (profile) {
        setLanguage(profile.language ?? "en");
        setPremium(profile.premium);
      }
      setLocations(locs);
      setLoading(false);
    });
  }, []);

  async function handleSaveLanguage() {
    if (!userId) return;
    setSaving(true);
    await upsertProfile(userId, { language } as Partial<Profile>);
    setSaving(false);
  }

  async function handleAddLocation() {
    if (!userId || !newCity || !newCountry) return;
    if (!premium) return;
    if (locations.length >= 3) return;

    const loc = await addUserLocation(userId, newCity, newCountry);
    if (loc) {
      setLocations((prev) => [...prev, loc]);
      setNewCity("");
      setNewCountry("");
    }
  }

  async function handleRemoveLocation(id: string) {
    await removeUserLocation(id);
    setLocations((prev) => prev.filter((l) => l.id !== id));
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <div className="animate-pulse text-rose-600">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-4 pb-8">
      <h1 className="text-xl font-bold mb-6">Settings</h1>

      {/* Language */}
      <div className="bg-white rounded-2xl p-5 border border-gray-100 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Globe className="w-5 h-5 text-rose-600" />
          <h2 className="font-semibold">Language</h2>
        </div>
        <p className="text-sm text-gray-500 mb-3">
          Messages you send will be translated from this language.
        </p>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 bg-white"
        >
          {Object.entries(LANGUAGES).map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
        <button
          onClick={handleSaveLanguage}
          disabled={saving}
          className="mt-3 w-full py-2.5 bg-rose-600 text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-rose-700 transition disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? "Saving..." : "Save Language"}
        </button>
      </div>

      {/* Multi-Location (Premium) */}
      <div className="bg-white rounded-2xl p-5 border border-gray-100 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <MapPin className="w-5 h-5 text-rose-600" />
          <h2 className="font-semibold">Multi-Location</h2>
          {premium && (
            <span className="ml-auto flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
              <Crown className="w-3 h-3" /> Premium
            </span>
          )}
        </div>

        {!premium ? (
          <div className="text-center py-6">
            <Crown className="w-12 h-12 text-amber-500 mx-auto mb-3" />
            <h3 className="font-semibold mb-1">Upgrade to Premium</h3>
            <p className="text-sm text-gray-500 mb-4">
              Show your profile in up to 3 cities worldwide.
              <br />
              Tokyo, Bangkok, New York — you choose.
            </p>
            <button className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 text-white rounded-full font-medium hover:from-amber-600 hover:to-amber-700 transition">
              Upgrade — $9.99/month
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-3">
              Your profile appears in these locations ({locations.length}/3):
            </p>

            {/* Current locations */}
            <div className="space-y-2 mb-4">
              {locations.map((loc) => (
                <div
                  key={loc.id}
                  className="flex items-center justify-between px-4 py-2.5 bg-gray-50 rounded-xl"
                >
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-rose-600" />
                    <span className="text-sm font-medium">
                      {loc.city}, {loc.country}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRemoveLocation(loc.id)}
                    className="text-gray-400 hover:text-red-500 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add location */}
            {locations.length < 3 && (
              <div className="flex gap-2">
                <input
                  value={newCity}
                  onChange={(e) => setNewCity(e.target.value)}
                  placeholder="City"
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
                <input
                  value={newCountry}
                  onChange={(e) => setNewCountry(e.target.value)}
                  placeholder="Country"
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
                <button
                  onClick={handleAddLocation}
                  className="px-3 py-2 bg-rose-600 text-white rounded-xl hover:bg-rose-700 transition"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-gray-200 transition mt-6"
      >
        <LogOut className="w-5 h-5" /> Log Out
      </button>
    </div>
  );
}

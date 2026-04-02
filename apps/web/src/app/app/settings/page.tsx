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
  Zap,
  Star,
  Eye,
  Undo2,
  Shield,
  MessageCircle,
  Check,
} from "lucide-react";
import { supabase } from "../../../lib/supabase";
import {
  getCurrentUser,
  getProfile,
  upsertProfile,
  getUserLocations,
  addUserLocation,
  removeUserLocation,
  getActiveSubscription,
  createSubscription,
} from "../../../lib/api";
import { LANGUAGES, SUBSCRIPTION_TIERS } from "../../../lib/types";
import type { Profile, UserLocation, Subscription } from "../../../lib/types";

export default function SettingsPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState("en");
  const [premium, setPremium] = useState(false);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [locations, setLocations] = useState<UserLocation[]>([]);
  const [newCity, setNewCity] = useState("");
  const [newCountry, setNewCountry] = useState("");
  const [saving, setSaving] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [selectedTier, setSelectedTier] = useState<"weekly" | "monthly" | "yearly">("monthly");

  useEffect(() => {
    getCurrentUser().then(async (user) => {
      if (!user) return;
      setUserId(user.id);

      const [profile, locs, sub] = await Promise.all([
        getProfile(user.id),
        getUserLocations(user.id),
        getActiveSubscription(user.id),
      ]);

      if (profile) {
        setLanguage(profile.language ?? "en");
        setPremium(profile.premium || !!sub);
      }
      setLocations(locs);
      setSubscription(sub);
      setLoading(false);
    });
  }, []);

  async function handleSaveLanguage() {
    if (!userId) return;
    setSaving(true);
    await upsertProfile(userId, { language } as Partial<Profile>);
    setSaving(false);
  }

  async function handleSubscribe() {
    if (!userId) return;
    setSubscribing(true);
    const tier = SUBSCRIPTION_TIERS[selectedTier];
    const sub = await createSubscription(userId, selectedTier, tier.price);
    if (sub) {
      setSubscription(sub);
      setPremium(true);
    }
    setSubscribing(false);
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

  const premiumFeatures = [
    { icon: Zap, label: "Unlimited Likes & Swipes", desc: "No daily limits" },
    { icon: Star, label: "Super Likes", desc: "Stand out from the crowd" },
    { icon: Undo2, label: "Undo / Rewind", desc: "Take back accidental swipes" },
    { icon: Eye, label: "See Who Liked You", desc: "View all your admirers" },
    { icon: Zap, label: "Profile Boosts", desc: "Get seen by more people" },
    { icon: MapPin, label: "Multi-Location (3 Cities)", desc: "Be discovered worldwide" },
    { icon: Shield, label: "Ad-Free Experience", desc: "Browse without interruptions" },
    { icon: MessageCircle, label: "Priority Messaging", desc: "Your messages seen first" },
  ];

  return (
    <div className="max-w-lg mx-auto px-4 py-4 pb-8">
      <h1 className="text-xl font-bold mb-6">Settings</h1>

      {/* Premium Subscription */}
      {!premium ? (
        <div className="bg-gradient-to-br from-amber-50 to-rose-50 rounded-2xl p-5 border border-amber-200 mb-4">
          <div className="text-center mb-4">
            <Crown className="w-12 h-12 text-amber-500 mx-auto mb-2" />
            <h2 className="text-xl font-bold bg-gradient-to-r from-amber-600 to-rose-600 bg-clip-text text-transparent">
              Upgrade to Premium
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Unlock all features and find your match faster
            </p>
          </div>

          {/* Premium Features List */}
          <div className="grid grid-cols-1 gap-2 mb-5">
            {premiumFeatures.map((f) => (
              <div key={f.label} className="flex items-center gap-3 px-3 py-2 bg-white/60 rounded-xl">
                <f.icon className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <div>
                  <span className="text-sm font-medium">{f.label}</span>
                  <span className="text-xs text-gray-500 ml-2">{f.desc}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Tier Selection */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            {(Object.entries(SUBSCRIPTION_TIERS) as [
              "weekly" | "monthly" | "yearly",
              (typeof SUBSCRIPTION_TIERS)[keyof typeof SUBSCRIPTION_TIERS]
            ][]).map(([key, tier]) => (
              <button
                key={key}
                onClick={() => setSelectedTier(key)}
                className={`relative p-3 rounded-xl border-2 transition text-center ${
                  selectedTier === key
                    ? "border-amber-500 bg-amber-50"
                    : "border-gray-200 bg-white hover:border-amber-300"
                }`}
              >
                {key === "yearly" && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[10px] bg-green-500 text-white px-2 py-0.5 rounded-full font-medium">
                    BEST VALUE
                  </span>
                )}
                <div className="text-lg font-bold text-gray-900">${tier.price}</div>
                <div className="text-xs text-gray-500">per {tier.period}</div>
              </button>
            ))}
          </div>

          <button
            onClick={handleSubscribe}
            disabled={subscribing}
            className="w-full py-3 bg-gradient-to-r from-amber-500 to-rose-500 text-white rounded-xl font-semibold hover:from-amber-600 hover:to-rose-600 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Crown className="w-5 h-5" />
            {subscribing ? "Processing..." : `Subscribe — $${SUBSCRIPTION_TIERS[selectedTier].price}/${SUBSCRIPTION_TIERS[selectedTier].period}`}
          </button>
        </div>
      ) : (
        <div className="bg-gradient-to-br from-amber-50 to-rose-50 rounded-2xl p-5 border border-amber-200 mb-4">
          <div className="flex items-center gap-3 mb-3">
            <Crown className="w-6 h-6 text-amber-500" />
            <div>
              <h2 className="font-bold text-amber-700">Premium Active</h2>
              {subscription && (
                <p className="text-xs text-gray-500">
                  {subscription.tier.charAt(0).toUpperCase() + subscription.tier.slice(1)} plan &middot; Expires{" "}
                  {new Date(subscription.end_date).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {premiumFeatures.map((f) => (
              <div key={f.label} className="flex items-center gap-2 text-xs text-amber-700">
                <Check className="w-3 h-3" />
                {f.label}
              </div>
            ))}
          </div>
        </div>
      )}

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
          <div className="text-center py-4">
            <p className="text-sm text-gray-500">
              Upgrade to Premium to show your profile in up to 3 cities worldwide.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-3">
              Your profile appears in these locations ({locations.length}/3):
            </p>

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

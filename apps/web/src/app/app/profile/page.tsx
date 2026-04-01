"use client";

import { useEffect, useState, useRef } from "react";
import { Camera, Plus, Trash2, Save, Shield } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  getCurrentUser,
  getProfile,
  upsertProfile,
  getPhotos,
  uploadPhoto,
  deletePhoto,
} from "../../../lib/api";
import { LANGUAGES } from "../../../lib/types";
import type { Profile, Photo } from "../../../lib/types";

export default function ProfilePage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [interestedIn, setInterestedIn] = useState("");
  const [language, setLanguage] = useState("en");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    getCurrentUser().then(async (user) => {
      if (!user) return;
      setUserId(user.id);

      const [profile, userPhotos] = await Promise.all([
        getProfile(user.id),
        getPhotos(user.id),
      ]);

      if (profile) {
        setDisplayName(profile.display_name ?? "");
        setBio(profile.bio ?? "");
        setAge(profile.age?.toString() ?? "");
        setGender(profile.gender ?? "");
        setInterestedIn(profile.interested_in ?? "");
        setLanguage(profile.language ?? "en");
        setCity(profile.city ?? "");
        setCountry(profile.country ?? "");
        setVerified(profile.verified);
      }

      setPhotos(userPhotos);
      setLoading(false);
    });
  }, []);

  async function handleSave() {
    if (!userId) return;
    setSaving(true);

    await upsertProfile(userId, {
      display_name: displayName || null,
      bio: bio || null,
      age: age ? parseInt(age) : null,
      gender: gender || null,
      interested_in: interestedIn || null,
      language,
      city: city || null,
      country: country || null,
    } as Partial<Profile>);

    setSaving(false);
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!userId || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    const photo = await uploadPhoto(userId, file, photos.length);
    if (photo) setPhotos((prev) => [...prev, photo]);
  }

  async function handleDeletePhoto(photoId: string) {
    await deletePhoto(photoId);
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <div className="animate-pulse text-rose-600">Loading profile...</div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-4 pb-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Edit Profile</h1>
        {verified && (
          <span className="flex items-center gap-1 text-sm text-blue-600 bg-blue-50 px-3 py-1 rounded-full">
            <Shield className="w-4 h-4" fill="currentColor" /> Verified
          </span>
        )}
      </div>

      {/* Photos */}
      <div className="mb-6">
        <label className="text-sm font-medium text-gray-700 mb-2 block">Photos</label>
        <div className="grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <div key={photo.id} className="relative aspect-square rounded-xl overflow-hidden group">
              <img src={photo.url} alt="Profile" className="w-full h-full object-cover" />
              <button
                onClick={() => handleDeletePhoto(photo.id)}
                className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
              >
                <Trash2 className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          ))}
          {photos.length < 6 && (
            <button
              onClick={() => fileRef.current?.click()}
              className="aspect-square rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 hover:border-rose-400 hover:text-rose-500 transition"
            >
              <Plus className="w-6 h-6" />
              <span className="text-xs mt-1">Add</span>
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePhotoUpload}
        />
      </div>

      {/* Verify button */}
      {!verified && (
        <button
          onClick={() => router.push("/app/verify")}
          className="w-full mb-6 py-3 bg-blue-600 text-white rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-blue-700 transition"
        >
          <Camera className="w-5 h-5" /> Verify Your Profile
        </button>
      )}

      {/* Form */}
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium text-gray-700">Display Name</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500"
            placeholder="Your name"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700">Bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            className="mt-1 w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none"
            placeholder="Tell people about yourself..."
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-gray-700">Age</label>
            <input
              type="number"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              className="mt-1 w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500"
              placeholder="25"
              min={18}
              max={120}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Gender</label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="mt-1 w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 bg-white"
            >
              <option value="">Select</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="non-binary">Non-binary</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700">Interested In</label>
          <select
            value={interestedIn}
            onChange={(e) => setInterestedIn(e.target.value)}
            className="mt-1 w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 bg-white"
          >
            <option value="">Select</option>
            <option value="men">Men</option>
            <option value="women">Women</option>
            <option value="everyone">Everyone</option>
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700">Language</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="mt-1 w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 bg-white"
          >
            {Object.entries(LANGUAGES).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-gray-700">City</label>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="mt-1 w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500"
              placeholder="New York"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Country</label>
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="mt-1 w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500"
              placeholder="USA"
            />
          </div>
        </div>
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full mt-6 py-3 bg-rose-600 text-white rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-rose-700 transition disabled:opacity-50"
      >
        <Save className="w-5 h-5" />
        {saving ? "Saving..." : "Save Profile"}
      </button>
    </div>
  );
}

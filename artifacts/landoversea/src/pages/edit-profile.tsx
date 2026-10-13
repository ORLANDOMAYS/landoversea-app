import { useState, useEffect, useRef } from 'react';
import { resolveMediaUrl } from '@/lib/media-url';
import {
  type ProfileUpdateRelationshipGoal,
} from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, Link } from 'wouter';
import { ChevronLeft, Plus, Trash2, MapPin, Loader2, Crown } from 'lucide-react';
import {
  useLiveDeletePhoto,
  useLiveProfile,
  useLiveUpdateProfile,
  useLiveUploadPhoto,
} from '@/hooks/use-supabase-surfaces';

type CanonicalProfileGender =
  | 'male'
  | 'female'
  | 'non_binary'
  | 'transgender'
  | 'prefer_not_to_say'
  | 'other';

function normalizeProfileGender(value: string | null | undefined): CanonicalProfileGender | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const aliases: Record<string, CanonicalProfileGender> = {
    man: 'male',
    male: 'male',
    woman: 'female',
    female: 'female',
    nonbinary: 'non_binary',
    non_binary: 'non_binary',
    transgender: 'transgender',
    prefer_not_to_say: 'prefer_not_to_say',
    other: 'other',
  };
  return aliases[normalized] ?? null;
}

const INTERESTS_OPTIONS = [
  'Travel', 'Languages', 'Cooking', 'Music', 'Art', 'Hiking',
  'Photography', 'Movies', 'Reading', 'Yoga', 'Dancing', 'Gaming',
  'Fashion', 'Sports', 'Coffee', 'Wine', 'Meditation', 'Surfing',
  'Cycling', 'Festivals',
];

const RELATIONSHIP_GOALS = [
  { value: 'serious', label: '💍 Serious Relationship' },
  { value: 'casual', label: '☕ Casual Dating' },
  { value: 'friendship', label: '🤝 Friendship' },
  { value: 'marriage', label: '👫 Marriage' },
  { value: 'adventure', label: '✈️ Adventure Partner' },
  { value: 'undecided', label: '🤷 Still Deciding' },
];

const GENDER_OPTIONS: Array<{ value: CanonicalProfileGender; label: string }> = [
  { value: 'male', label: 'Man' },
  { value: 'female', label: 'Woman' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'transgender', label: 'Transgender' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
  { value: 'other', label: 'Other' },
];
const LANGUAGE_OPTIONS = ['English','Spanish','French','German','Italian','Portuguese','Japanese','Korean','Mandarin','Cantonese','Arabic','Hindi','Russian','Dutch','Swedish','Turkish','Thai','Vietnamese','Indonesian','Polish'];
const CULTURAL_OPTIONS = ['Asian Culture','European Culture','Latin Culture','Middle Eastern Culture','African Culture','South Asian Culture','East Asian Culture','Southeast Asian Culture','Caribbean Culture','Scandinavian Culture','Mediterranean Culture','Multicultural'];

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className={`relative inline-flex w-11 h-6 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-muted'}`}>
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

export default function EditProfile() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const photoInputRef = useRef<HTMLInputElement>(null);

  const { data: profile, isLoading } = useLiveProfile();
  const updateMutation = useLiveUpdateProfile();
  const uploadPhotoMutation = useLiveUploadPhoto();
  const deletePhotoMutation = useLiveDeletePhoto();

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [location, setLocationVal] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [relationshipGoal, setRelationshipGoal] = useState('');
  const [saving, setSaving] = useState(false);

  const [gender, setGender] = useState<CanonicalProfileGender | null>(null);
  const [age, setAge] = useState<number | ''>('');
  const [primaryLanguage, setPrimaryLanguage] = useState('');
  const [otherLanguages, setOtherLanguages] = useState<string[]>([]);
  const [culturalInterests, setCulturalInterests] = useState<string[]>([]);
  const [relocationOpenness, setRelocationOpenness] = useState(false);

  useEffect(() => {
    if (profile) {
      setName(profile.name || '');
      setBio(profile.bio || '');
      setLocationVal(profile.city || '');
      setInterests(profile.interests || []);
      setRelationshipGoal(profile.relationshipGoal || '');
      setGender(normalizeProfileGender(profile.gender));
      setAge(profile.age || '');
      setPrimaryLanguage(profile.primaryLanguage || '');
      setOtherLanguages(profile.otherLanguages || []);
      setCulturalInterests(profile.culturalInterests || []);
      setRelocationOpenness(profile.relocationOpenness || false);
    }
  }, [profile]);

  const photos = profile?.photos || [];

  const toggleInterest = (interest: string) => {
    setInterests(prev =>
      prev.includes(interest) ? prev.filter(i => i !== interest) : [...prev, interest]
    );
  };

  const toggleLanguage = (l: string) => setOtherLanguages(prev => prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l]);
  const toggleCultural = (c: string) => setCulturalInterests(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Invalid file', description: 'Please select an image file', variant: 'destructive' });
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Max 5MB', variant: 'destructive' });
      e.target.value = '';
      return;
    }
    uploadPhotoMutation.mutate(
      { file, position: photos.length },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/profiles/me'] });
          queryClient.invalidateQueries({ queryKey: ['profile', 'me'] });
          toast({ title: 'Photo uploaded!' });
        },
        onError: (err: any) => {
          toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
        },
      }
    );
    e.target.value = '';
  };

  const handleDeletePhoto = (photoId: string) => {
    deletePhotoMutation.mutate(
      { photoId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/profiles/me'] });
          queryClient.invalidateQueries({ queryKey: ['profile', 'me'] });
          toast({ title: 'Photo removed' });
        },
        onError: (err: any) => {
          toast({ title: 'Failed to remove photo', description: err.message, variant: 'destructive' });
        },
      }
    );
  };

  const handleSave = async () => {
    setSaving(true);
    updateMutation.mutate(
      {
        data: {
          name,
          bio,
          city: location,
          interests,
          relationshipGoal: relationshipGoal as ProfileUpdateRelationshipGoal,
          gender: gender ?? undefined,
          age: age !== '' ? age as number : undefined,
          primaryLanguage: primaryLanguage || undefined,
          otherLanguages,
          culturalInterests,
          relocationOpenness,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/profiles/me'] });
          queryClient.invalidateQueries({ queryKey: ['profile', 'me'] });
          toast({ title: 'Profile updated!' });
          setSaving(false);
          setLocation('/profile');
        },
        onError: (err: any) => {
          toast({ title: 'Failed to save', description: err.message, variant: 'destructive' });
          setSaving(false);
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      {/* Header */}
      <header
        className="sticky top-0 z-40 flex items-center gap-3 px-4 py-3"
        style={{
          background: 'var(--nav-bg)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--nav-border)',
        }}
      >
        <Link href="/profile" aria-label="Back to profile" className="w-9 h-9 rounded-full glass flex items-center justify-center">
          <ChevronLeft className="w-5 h-5 text-foreground" />
        </Link>
        <h1 className="font-serif text-xl text-foreground flex-1">Edit Profile</h1>
        <button
          onClick={handleSave}
          disabled={saving || updateMutation.isPending}
          className="btn-glow px-4 py-1.5 text-sm text-white font-semibold rounded-full disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none flex items-center gap-1.5"
        >
          {(saving || updateMutation.isPending) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Save
        </button>
      </header>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-5">
        {/* Photos Grid */}
        <div className="glass rounded-2xl p-4 space-y-3">
          <h2 className="font-serif text-lg text-foreground">Photos</h2>
          <div className="grid grid-cols-3 gap-2">
            {photos.slice(0, 6).map((photo, idx) => (
              <div key={photo.id} className="relative aspect-square glass rounded-2xl overflow-hidden group">
                <img
                  src={resolveMediaUrl(photo.url)}
                  alt={`Photo ${idx + 1}`}
                  className="w-full h-full object-cover"
                />
                {idx === 0 && (
                  <div className="absolute top-1.5 left-1.5 bg-black/50 rounded-full px-1.5 py-0.5 flex items-center gap-1">
                    <Crown className="w-3 h-3 text-yellow-400" />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <button
                    onClick={() => handleDeletePhoto(photo.id)}
                    className="w-8 h-8 rounded-full bg-red-500/80 flex items-center justify-center hover:bg-red-500 transition-colors"
                    disabled={deletePhotoMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4 text-foreground" />
                  </button>
                </div>
              </div>
            ))}

            {/* Empty slots */}
            {photos.length < 6 && Array.from({ length: Math.min(6 - photos.length, 6) }).map((_, i) => (
              <button
                key={`empty-${i}`}
                onClick={() => photoInputRef.current?.click()}
                className="aspect-square glass rounded-2xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 hover:border-border transition-colors"
                disabled={uploadPhotoMutation.isPending}
              >
                {uploadPhotoMutation.isPending && i === 0 ? (
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                ) : (
                  <Plus className="w-5 h-5 text-muted-foreground" />
                )}
              </button>
            ))}
          </div>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhotoUpload}
          />
          <p className="text-muted-foreground text-xs">First photo is your main photo. Max 6 photos.</p>
        </div>

        {/* Display Name */}
        <div className="glass rounded-2xl p-4 space-y-2">
          <label className="text-foreground text-sm">Display Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="glass-input w-full rounded-2xl px-3 py-2.5 outline-none focus:border-border"
            placeholder="Your name"
          />
        </div>

        {/* Bio */}
        <div className="glass rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-foreground text-sm">About You</label>
            <span className="text-muted-foreground text-xs">{bio.length}/300</span>
          </div>
          <textarea
            value={bio}
            onChange={e => setBio(e.target.value.slice(0, 300))}
            rows={4}
            className="glass-input w-full rounded-2xl p-3 resize-none outline-none focus:border-border"
            placeholder="Tell people a little about yourself..."
          />
        </div>

        {/* Location */}
        <div className="glass rounded-2xl p-4 space-y-2">
          <label className="text-foreground text-sm">Location</label>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={location}
              onChange={e => setLocationVal(e.target.value)}
              className="glass-input w-full rounded-2xl px-3 py-2.5 pl-9 outline-none focus:border-border"
              placeholder="City, Country"
            />
          </div>
        </div>

        {/* Gender */}
        <div className="glass rounded-2xl p-4 space-y-3">
          <label className="text-foreground text-sm">Gender</label>
          <div className="flex flex-wrap gap-2">
            {GENDER_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => setGender(prev => prev === opt.value ? null : opt.value)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all border ${
                  gender === opt.value ? 'bg-primary/20 border-primary/60 text-primary' : 'glass border-border text-muted-foreground hover:border-border'
                }`}>{opt.label}</button>
            ))}
          </div>
        </div>

        {/* Age */}
        <div className="glass rounded-2xl p-4 space-y-2">
          <label className="text-foreground text-sm">Age</label>
          <input type="number" min={18} max={100} placeholder="Your age"
            value={age} onChange={e => setAge(e.target.value ? parseInt(e.target.value) : '')}
            className="glass-input w-full rounded-2xl px-3 py-2.5 outline-none focus:border-border" />
        </div>

        {/* Primary Language */}
        <div className="glass rounded-2xl p-4 space-y-2">
          <label className="text-foreground text-sm">Primary Language</label>
          <select value={primaryLanguage} onChange={e => setPrimaryLanguage(e.target.value)}
            className="glass-input w-full rounded-2xl px-3 py-2.5 outline-none focus:border-border bg-transparent text-foreground">
            <option value="" className="bg-popover text-popover-foreground">Select a language</option>
            {LANGUAGE_OPTIONS.map(l => <option key={l} value={l} className="bg-popover text-popover-foreground">{l}</option>)}
          </select>
        </div>

        {/* Other Languages */}
        <div className="glass rounded-2xl p-4 space-y-3">
          <h2 className="font-serif text-lg text-foreground">Other Languages</h2>
          <div className="flex flex-wrap gap-2">
            {LANGUAGE_OPTIONS.map(l => {
              const sel = otherLanguages.includes(l);
              return (
                <button key={l} onClick={() => toggleLanguage(l)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${
                    sel ? 'glass-strong border-primary text-primary' : 'glass border-border text-muted-foreground hover:border-border'
                  }`}>{l}</button>
              );
            })}
          </div>
        </div>

        {/* Cultural Background */}
        <div className="glass rounded-2xl p-4 space-y-3">
          <h2 className="font-serif text-lg text-foreground">Cultural Background</h2>
          <div className="flex flex-wrap gap-2">
            {CULTURAL_OPTIONS.map(c => {
              const sel = culturalInterests.includes(c);
              return (
                <button key={c} onClick={() => toggleCultural(c)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${
                    sel ? 'glass-strong border-secondary text-secondary' : 'glass border-border text-muted-foreground hover:border-border'
                  }`}>{c}</button>
              );
            })}
          </div>
        </div>

        {/* Relocation Openness */}
        <div className="glass rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-foreground text-sm font-medium">Open to relocation</p>
              <p className="text-muted-foreground text-xs">Willing to move to be with someone</p>
            </div>
            <Switch checked={relocationOpenness} onChange={setRelocationOpenness} />
          </div>
        </div>

        {/* Interests */}
        <div className="glass rounded-2xl p-4 space-y-3">
          <h2 className="font-serif text-lg text-foreground">Interests</h2>
          <div className="flex flex-wrap gap-2">
            {INTERESTS_OPTIONS.map(interest => {
              const selected = interests.includes(interest);
              return (
                <button
                  key={interest}
                  onClick={() => toggleInterest(interest)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${
                    selected
                      ? 'glass-strong border-primary text-primary'
                      : 'glass border-border text-muted-foreground hover:border-border'
                  }`}
                >
                  {interest}
                </button>
              );
            })}
          </div>
        </div>

        {/* Relationship Goals */}
        <div className="glass rounded-2xl p-4 space-y-3">
          <h2 className="font-serif text-lg text-foreground">Relationship Goals</h2>
          <div className="grid grid-cols-2 gap-2">
            {RELATIONSHIP_GOALS.map(goal => {
              const selected = relationshipGoal === goal.value;
              return (
                <button
                  key={goal.value}
                  onClick={() => setRelationshipGoal(goal.value)}
                  className={`glass rounded-2xl px-3 py-3 text-sm text-left transition-all border ${
                    selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground hover:border-white/25'
                  }`}
                >
                  {goal.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Save button at bottom */}
        <button
          onClick={handleSave}
          disabled={saving || updateMutation.isPending}
          className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none flex items-center justify-center gap-2"
        >
          {(saving || updateMutation.isPending) && <Loader2 className="w-4 h-4 animate-spin" />}
          Save Changes
        </button>
      </div>
    </div>
  );
}

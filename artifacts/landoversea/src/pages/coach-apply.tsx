import { useState } from 'react';
import { useLocation, Link } from 'wouter';
import {
  useCreateCoachProfile,
  useGetMyCoachProfile,
  useUpdateCoachAvailability,
  getGetMyCoachProfileQueryKey,
} from '@workspace/api-client-react';
import { ChevronLeft, Star, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

const SPECIALTIES = [
  'Cultural Adaptation',
  'Language Practice',
  'Dating Strategy',
  'Interview',
  'Business Culture',
  'Travel',
  'Relationship',
  'Communication',
  'Confidence',
  'Cross-cultural Romance',
];

const LANGUAGE_OPTIONS = [
  'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese',
  'Japanese', 'Korean', 'Mandarin', 'Cantonese', 'Arabic', 'Hindi',
  'Russian', 'Dutch', 'Swedish', 'Turkish', 'Thai', 'Vietnamese',
  'Indonesian', 'Polish',
];

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TIMES = ['Morning', 'Afternoon', 'Evening'];
const TIME_RANGES: Record<string, { startTime: string; endTime: string }> = {
  Morning: { startTime: '09:00', endTime: '12:00' },
  Afternoon: { startTime: '12:00', endTime: '17:00' },
  Evening: { startTime: '17:00', endTime: '21:00' },
};

export default function CoachApply() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: myCoachProfile, isLoading: profileLoading } = useGetMyCoachProfile();
  const createMutation = useCreateCoachProfile();
  const availabilityMutation = useUpdateCoachAvailability();

  const [bio, setBio] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [yearsExp, setYearsExp] = useState('');
  const [selectedSpecialties, setSelectedSpecialties] = useState<string[]>([]);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [selectedTimes, setSelectedTimes] = useState<string[]>([]);
  const coachTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const hasAvailability = selectedDays.length > 0 && selectedTimes.length > 0;

  const toggleItem = (item: string, list: string[], setList: (l: string[]) => void) => {
    setList(list.includes(item) ? list.filter(i => i !== item) : [...list, item]);
  };

  const buildAvailabilitySlots = () => selectedDays.flatMap((day) => {
    const dayIndex = DAYS.indexOf(day);
    return selectedTimes.map((time) => ({
      dayOfWeek: (dayIndex + 1) % 7,
      ...TIME_RANGES[time],
    }));
  });

  const handleAvailabilityUpdate = () => {
    if (!hasAvailability) {
      toast({ title: 'Select at least one day and time', variant: 'destructive' });
      return;
    }
    availabilityMutation.mutate(
      { data: { slots: buildAvailabilitySlots(), timeZone: coachTimeZone } },
      {
        onSuccess: () => toast({ title: 'Availability updated' }),
        onError: (err: any) => toast({
          title: 'Could not update availability',
          description: err?.message,
          variant: 'destructive',
        }),
      }
    );
  };

  const handleSubmit = () => {
    if (!bio.trim()) {
      toast({ title: 'Please write a bio', variant: 'destructive' });
      return;
    }
    if (selectedLanguages.length === 0) {
      toast({ title: 'Please select at least one language', variant: 'destructive' });
      return;
    }
    if (!hasAvailability) {
      toast({ title: 'Select at least one day and time', variant: 'destructive' });
      return;
    }

    let finalBio = bio.trim();
    if (yearsExp) {
      const suffix = '\n\nExperience: ' + yearsExp + ' years';
      if (finalBio.length + suffix.length <= 500) {
        finalBio = finalBio + suffix;
      }
    }

    createMutation.mutate(
      {
        data: {
          displayName: '', // server will pull from user profile
          bio: finalBio,
          specialties: selectedSpecialties,
          languages: selectedLanguages,
          sessionLengthsMinutes: [60],
          ratesPerHour: hourlyRate ? parseFloat(hourlyRate) : undefined,
          availability: {
            slots: buildAvailabilitySlots(),
            timeZone: coachTimeZone,
          },
        },
      },
      {
        onSuccess: (coach) => {
          queryClient.setQueryData(getGetMyCoachProfileQueryKey(), coach);
          toast({ title: 'Application submitted! We\'ll notify you within 3-5 business days.' });
          navigate('/coaches');
        },
        onError: (err: any) => {
          toast({
            title: 'Error',
            description: err?.message || 'Failed to submit application',
            variant: 'destructive',
          });
        },
      }
    );
  };

  const renderAvailabilityPicker = () => (
    <div className="glass rounded-2xl p-4 space-y-3">
      <div>
        <h2 className="font-serif text-foreground text-lg">Availability</h2>
        <p className="text-muted-foreground text-xs mt-1">
          Your local time zone: {coachTimeZone.replaceAll('_', ' ')}
        </p>
      </div>

      <div>
        <p className="text-muted-foreground text-xs mb-2">Days</p>
        <div className="flex flex-wrap gap-2">
          {DAYS.map(day => (
            <button
              key={day}
              type="button"
              onClick={() => toggleItem(day, selectedDays, setSelectedDays)}
              className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                selectedDays.includes(day)
                  ? 'bg-cyan-500/20 border border-cyan-400 text-cyan-400'
                  : 'glass border border-border text-foreground hover:glass-strong'
              }`}
            >
              {day}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-muted-foreground text-xs mb-2">Times</p>
        <div className="flex flex-wrap gap-2">
          {TIMES.map(time => (
            <button
              key={time}
              type="button"
              onClick={() => toggleItem(time, selectedTimes, setSelectedTimes)}
              className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                selectedTimes.includes(time)
                  ? 'bg-cyan-500/20 border border-cyan-400 text-cyan-400'
                  : 'glass border border-border text-foreground hover:glass-strong'
              }`}
            >
              {time}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  if (profileLoading) {
    return (
      <div className="flex justify-center items-center min-h-[100dvh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Already a coach
  if (myCoachProfile) {
    return (
      <div className="min-h-[100dvh] px-4 py-8">
        <div className="max-w-lg mx-auto space-y-4">
          <div className="glass rounded-3xl p-6 text-center">
            <Star className="w-12 h-12 text-yellow-400 mx-auto mb-4" />
            <h2 className="font-serif text-foreground text-2xl mb-2">You're already a coach! 🌟</h2>
            <p className="text-muted-foreground text-sm mb-6">Manage your business or replace your weekly availability below.</p>
            <Link href="/coach-dashboard" className="glass border border-border px-6 py-3 w-full text-foreground font-semibold rounded-full inline-flex items-center justify-center">
              Go to Dashboard
            </Link>
          </div>
          {renderAvailabilityPicker()}
          <button
            type="button"
            onClick={handleAvailabilityUpdate}
            disabled={!hasAvailability || availabilityMutation.isPending}
            className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
          >
            {availabilityMutation.isPending ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Saving...
              </span>
            ) : 'Update Availability'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      {/* Header */}
      <div
        className="sticky top-0 z-40 px-4 py-3 flex items-center gap-3"
        style={{
          background: 'var(--nav-bg)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--nav-border)',
        }}
      >
        <button onClick={() => navigate('/coaches')} className="w-9 h-9 rounded-full glass flex items-center justify-center">
          <ChevronLeft className="w-5 h-5 text-foreground" />
        </button>
        <div className="flex items-center gap-2">
          <Star className="w-5 h-5 text-yellow-400" />
          <h1 className="font-serif text-xl text-foreground">Become a Coach</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* About You */}
        <div className="glass rounded-2xl p-4 space-y-3">
          <h2 className="font-serif text-foreground text-lg">About You</h2>

          <div className="space-y-1">
            <label className="text-muted-foreground text-xs">Bio</label>
            <textarea
              rows={4}
              placeholder="Tell potential clients about your background, expertise, and coaching style..."
              value={bio}
              onChange={e => setBio(e.target.value)}
              className="glass-input rounded-2xl p-3 w-full resize-none outline-none placeholder:text-muted-foreground text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-muted-foreground text-xs">Hourly Rate (USD)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  placeholder="60"
                  value={hourlyRate}
                  onChange={e => setHourlyRate(e.target.value)}
                  className="glass-input rounded-xl px-4 py-2 pl-7 w-full outline-none placeholder:text-muted-foreground text-sm"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-muted-foreground text-xs">Years of Experience</label>
              <input
                type="number"
                min="0"
                placeholder="3"
                value={yearsExp}
                onChange={e => setYearsExp(e.target.value)}
                className="glass-input rounded-xl px-4 py-2 w-full outline-none placeholder:text-muted-foreground text-sm"
              />
            </div>
          </div>
        </div>

        {/* Specialties */}
        <div className="glass rounded-2xl p-4 space-y-3">
          <h2 className="font-serif text-foreground text-lg">Specialties</h2>
          <div className="flex flex-wrap gap-2">
            {SPECIALTIES.map(s => (
              <button
                key={s}
                onClick={() => toggleItem(s, selectedSpecialties, setSelectedSpecialties)}
                className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                  selectedSpecialties.includes(s)
                    ? 'bg-primary/20 border border-primary text-primary'
                    : 'glass border border-border text-foreground hover:glass-strong'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Languages */}
        <div className="glass rounded-2xl p-4 space-y-3">
          <h2 className="font-serif text-foreground text-lg">Languages</h2>
          <div className="flex flex-wrap gap-2">
            {LANGUAGE_OPTIONS.map(lang => (
              <button
                key={lang}
                onClick={() => toggleItem(lang, selectedLanguages, setSelectedLanguages)}
                className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                  selectedLanguages.includes(lang)
                    ? 'bg-secondary/20 border border-secondary text-secondary'
                    : 'glass border border-border text-foreground hover:glass-strong'
                }`}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>

        {/* Availability */}
        {renderAvailabilityPicker()}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!hasAvailability || createMutation.isPending || availabilityMutation.isPending}
          className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
        >
          {createMutation.isPending || availabilityMutation.isPending ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Submitting...
            </span>
          ) : 'Apply to Coach'}
        </button>
      </div>
    </div>
  );
}

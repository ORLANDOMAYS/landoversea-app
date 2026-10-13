import { useState, useEffect } from 'react';
import {
  useGetDiscoverFilters,
  getGetDiscoverFiltersQueryKey,
  getGetDiscoverCardsQueryKey,
  useUpdateDiscoverFilters,
  type DiscoverFiltersInput,
} from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, Link } from 'wouter';
import { ChevronLeft, Loader2, AlertTriangle } from 'lucide-react';
import { normalizeApiError } from '@/lib/api-error';
import {
  DISCOVER_FILTER_DEFAULTS,
  clearLegacyFiltersExt,
  normalizeDiscoverGender,
  type CanonicalDiscoverGender,
} from '@/lib/discover-filters';
import { liveKeys } from '@/hooks/use-supabase-surfaces';

const GENDER_OPTIONS: Array<{ value: CanonicalDiscoverGender | null; label: string }> = [
  { value: 'male', label: 'Man' },
  { value: 'female', label: 'Woman' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: null, label: 'Everyone' },
];

const LANGUAGE_OPTIONS = [
  'English', 'Spanish', 'French', 'Mandarin', 'Portuguese', 'Arabic',
  'Hindi', 'Japanese', 'Korean', 'Italian', 'German', 'Russian',
  'Dutch', 'Swedish', 'Thai', 'Vietnamese', 'Indonesian', 'Turkish',
  'Polish', 'Ukrainian',
];

const COUNTRY_OPTIONS = [
  'United States', 'United Kingdom', 'Canada', 'Australia', 'Germany',
  'France', 'Japan', 'South Korea', 'Brazil', 'Mexico', 'Spain',
  'Italy', 'Netherlands', 'Sweden', 'Thailand', 'Singapore', 'Philippines',
  'Malaysia', 'India', 'China', 'Nigeria', 'South Africa', 'UAE',
];

// Canonical relationship goal enum values shared with the profile.
const RELATIONSHIP_GOAL_OPTIONS = [
  { value: 'serious', label: '💍 Serious Relationship' },
  { value: 'casual', label: '☕ Casual Dating' },
  { value: 'friendship', label: '🤝 Friendship' },
  { value: 'language_exchange', label: '🌐 Language Exchange' },
  { value: 'networking', label: '💼 Networking' },
  { value: 'open', label: '✨ Open to Anything' },
];

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex w-11 h-6 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-muted'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  );
}

export default function FiltersPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const {
    data: filters,
    isLoading,
    isError: isLoadError,
    error: loadError,
    refetch: refetchFilters,
  } = useGetDiscoverFilters();
  const updateMutation = useUpdateDiscoverFilters();

  const [minAge, setMinAge] = useState(DISCOVER_FILTER_DEFAULTS.minAge);
  const [maxAge, setMaxAge] = useState(DISCOVER_FILTER_DEFAULTS.maxAge);
  const [gender, setGender] = useState<CanonicalDiscoverGender | null>(null);
  const [globalMode, setGlobalMode] = useState(true);
  const [country, setCountry] = useState('');
  const [language, setLanguage] = useState('');
  const [relationshipGoal, setRelationshipGoal] = useState<string>('');
  const [interestsOverlap, setInterestsOverlap] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [longDistance, setLongDistance] = useState(false);
  const [relocation, setRelocation] = useState(false);

  // Inline save error + the exact payload that failed so Retry can replay it.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastPayload, setLastPayload] = useState<{
    data: DiscoverFiltersInput;
    navigateOnSuccess: boolean;
  } | null>(null);

  useEffect(() => {
    if (filters) {
      setMinAge(filters.minAge ?? DISCOVER_FILTER_DEFAULTS.minAge);
      setMaxAge(filters.maxAge ?? DISCOVER_FILTER_DEFAULTS.maxAge);
      setGender(normalizeDiscoverGender(filters.gender));
      setGlobalMode(filters.globalMode ?? true);
      setCountry(filters.countries?.[0] ?? '');
      setLanguage(filters.languages?.[0] ?? '');
      setRelationshipGoal(filters.relationshipGoal ?? '');
      setInterestsOverlap(filters.interestsOverlap ?? false);
      setVerifiedOnly(filters.verifiedOnly ?? false);
      setLongDistance(filters.longDistance ?? false);
      setRelocation(filters.relocation ?? false);
    }
  }, [filters]);

  const refreshCards = () => {
    queryClient.invalidateQueries({ queryKey: getGetDiscoverFiltersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDiscoverCardsQueryKey() });
    queryClient.invalidateQueries({ queryKey: liveKeys.discovery });
  };

  // Runs a PATCH with a known payload; on success clears legacy state, refreshes
  // cards, and (optionally) navigates. On error stores payload for Retry.
  const runUpdate = (payload: { data: DiscoverFiltersInput; navigateOnSuccess: boolean }) => {
    setSaveError(null);
    setLastPayload(payload);
    updateMutation.mutate(
      { data: payload.data },
      {
        onSuccess: () => {
          clearLegacyFiltersExt();
          refreshCards();
          setLastPayload(null);
          toast({ title: 'Filters updated!' });
          if (payload.navigateOnSuccess) setLocation('/discover');
        },
        onError: (err) => {
          const { message } = normalizeApiError(err, 'Failed to update filters');
          setSaveError(message);
          toast({ title: 'Failed to update filters', description: message, variant: 'destructive' });
        },
      }
    );
  };

  const buildApplyPayload = (): DiscoverFiltersInput => {
    const data: DiscoverFiltersInput = {
      minAge,
      maxAge,
      gender,
      globalMode,
      relationshipGoal: relationshipGoal || null,
      interestsOverlap,
      verifiedOnly,
      longDistance,
      relocation,
      countries: !globalMode && country ? [country] : [],
      languages: language ? [language] : [],
    };
    return data;
  };

  const handleApply = () => {
    runUpdate({ data: buildApplyPayload(), navigateOnSuccess: true });
  };

  const handleClear = () => {
    // Reflect defaults in the UI immediately, then PATCH the same defaults.
    setMinAge(DISCOVER_FILTER_DEFAULTS.minAge);
    setMaxAge(DISCOVER_FILTER_DEFAULTS.maxAge);
    setGender(null);
    setGlobalMode(DISCOVER_FILTER_DEFAULTS.globalMode);
    setCountry('');
    setLanguage('');
    setRelationshipGoal('');
    setInterestsOverlap(DISCOVER_FILTER_DEFAULTS.interestsOverlap);
    setVerifiedOnly(DISCOVER_FILTER_DEFAULTS.verifiedOnly);
    setLongDistance(DISCOVER_FILTER_DEFAULTS.longDistance);
    setRelocation(DISCOVER_FILTER_DEFAULTS.relocation);
    runUpdate({ data: { ...DISCOVER_FILTER_DEFAULTS }, navigateOnSuccess: false });
  };

  const handleRetry = () => {
    if (lastPayload) runUpdate(lastPayload);
  };

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
        <Link href="/discover" aria-label="Back to discover" className="w-9 h-9 rounded-full glass flex items-center justify-center">
          <ChevronLeft className="w-5 h-5 text-foreground" />
        </Link>
        <h1 className="font-serif text-xl text-foreground">Discovery Filters</h1>
      </header>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : isLoadError ? (
          <div
            role="alert"
            className="glass rounded-2xl p-6 space-y-3 border border-red-400/30 text-center"
          >
            <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
            <p className="text-foreground font-medium">Couldn't load your filters</p>
            <p className="text-muted-foreground text-sm">
              {normalizeApiError(loadError, 'Please try again.').message}
            </p>
            <button
              onClick={() => refetchFilters()}
              className="glass border border-border rounded-full px-6 py-2.5 text-foreground font-semibold"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            {/* Age Range */}
            <div className="glass rounded-2xl p-5 space-y-4">
              <h2 className="font-serif text-lg text-foreground">Age Range</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-muted-foreground text-xs">Min Age</label>
                  <input
                    type="number"
                    min={18}
                    max={maxAge}
                    value={minAge}
                    onChange={e => setMinAge(Math.max(18, Math.min(parseInt(e.target.value) || 18, maxAge)))}
                    className="glass-input w-full rounded-2xl px-3 py-2.5 outline-none focus:border-border text-center"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-muted-foreground text-xs">Max Age</label>
                  <input
                    type="number"
                    min={minAge}
                    max={100}
                    value={maxAge}
                    onChange={e => setMaxAge(Math.min(100, Math.max(parseInt(e.target.value) || 45, minAge)))}
                    className="glass-input w-full rounded-2xl px-3 py-2.5 outline-none focus:border-border text-center"
                  />
                </div>
              </div>
              {/* Range slider display */}
              <div className="px-1">
                <input
                  type="range"
                  min={18}
                  max={100}
                  value={minAge}
                  onChange={e => setMinAge(Math.min(parseInt(e.target.value), maxAge - 1))}
                  className="w-full accent-primary"
                />
                <input
                  type="range"
                  min={18}
                  max={100}
                  value={maxAge}
                  onChange={e => setMaxAge(Math.max(parseInt(e.target.value), minAge + 1))}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-muted-foreground text-xs mt-1">
                  <span>{minAge} yrs</span>
                  <span>{maxAge} yrs</span>
                </div>
              </div>
            </div>

            {/* Show Me */}
            <div className="glass rounded-2xl p-5 space-y-3">
              <h2 className="font-serif text-lg text-foreground">Show Me</h2>
              <div className="flex flex-wrap gap-2">
                {GENDER_OPTIONS.map(opt => {
                  const selected = gender === opt.value;
                  return (
                    <button
                      key={opt.label}
                      onClick={() => setGender(opt.value)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all border ${
                        selected
                          ? 'bg-primary/20 border-primary/60 text-primary'
                          : 'glass border-border text-muted-foreground hover:border-border'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Global Mode */}
            <div className="glass rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-serif text-lg text-foreground">Global Mode</h2>
                  <p className="text-muted-foreground text-sm">Discover people from anywhere in the world</p>
                </div>
                <Switch checked={globalMode} onChange={setGlobalMode} />
              </div>

              {!globalMode && (
                <div className="space-y-1 pt-1">
                  <label className="text-muted-foreground text-xs">Country</label>
                  <select
                    value={country}
                    onChange={e => setCountry(e.target.value)}
                    className="glass-input w-full rounded-2xl px-3 py-2.5 outline-none focus:border-border"
                  >
                    <option value="">Any country</option>
                    {COUNTRY_OPTIONS.map(c => (
                      <option key={c} value={c} className="bg-popover text-popover-foreground">{c}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Language */}
            <div className="glass rounded-2xl p-5 space-y-2">
              <h2 className="font-serif text-lg text-foreground">Language</h2>
              <select
                value={language}
                onChange={e => setLanguage(e.target.value)}
                className="glass-input w-full rounded-2xl px-3 py-2.5 outline-none focus:border-border"
              >
                <option value="">Any language</option>
                {LANGUAGE_OPTIONS.map(l => (
                  <option key={l} value={l} className="bg-popover text-popover-foreground">{l}</option>
                ))}
              </select>
            </div>

            {/* Distance Radius — disabled, needs precise location */}
            <div className="glass rounded-2xl p-5 space-y-3 opacity-70">
              <div className="flex items-center gap-2">
                <h2 className="font-serif text-lg text-foreground">Distance Radius</h2>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground glass px-2 py-0.5 rounded-full">
                  Unavailable
                </span>
              </div>
              <input
                type="range"
                min={10}
                max={500}
                step={10}
                value={100}
                disabled
                aria-disabled="true"
                readOnly
                className="w-full accent-primary cursor-not-allowed"
              />
              <p className="text-muted-foreground text-xs">
                Radius filtering needs precise location permission and setup. It's
                not active yet and no distance preference is saved.
              </p>
            </div>

            {/* Relationship Goal */}
            <div className="glass rounded-2xl p-5 space-y-3">
              <h2 className="font-serif text-lg text-foreground">Looking For</h2>
              <div className="grid grid-cols-2 gap-2">
                {RELATIONSHIP_GOAL_OPTIONS.map(opt => (
                  <button key={opt.value}
                    onClick={() => setRelationshipGoal(prev => prev === opt.value ? '' : opt.value)}
                    className={`glass rounded-2xl px-3 py-3 text-sm text-left border transition-all ${
                      relationshipGoal === opt.value
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground hover:border-white/25'
                    }`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Shared Interests */}
            <div className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-serif text-lg text-foreground">Shared Interests</h2>
                  <p className="text-muted-foreground text-sm">Only show people who share your hobbies</p>
                </div>
                <Switch checked={interestsOverlap} onChange={setInterestsOverlap} />
              </div>
            </div>

            {/* Verified Only */}
            <div className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-serif text-lg text-foreground">Verified Only</h2>
                  <p className="text-muted-foreground text-sm">Only show users with a verified badge</p>
                </div>
                <Switch checked={verifiedOnly} onChange={setVerifiedOnly} />
              </div>
            </div>

            {/* Long-distance */}
            <div className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-serif text-lg text-foreground">Open to Long-distance</h2>
                  <p className="text-muted-foreground text-sm">Only show people open to long-distance</p>
                </div>
                <Switch checked={longDistance} onChange={setLongDistance} />
              </div>
            </div>

            {/* Relocation */}
            <div className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-serif text-lg text-foreground">Open to Relocation</h2>
                  <p className="text-muted-foreground text-sm">Only show people open to relocating</p>
                </div>
                <Switch checked={relocation} onChange={setRelocation} />
              </div>
            </div>

            {/* Inline save error + Retry */}
            {saveError && (
              <div
                role="alert"
                className="glass rounded-2xl p-4 border border-red-400/30 flex items-start gap-3"
              >
                <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-foreground text-sm font-medium">Couldn't save your filters</p>
                  <p className="text-muted-foreground text-xs mt-0.5">{saveError}</p>
                </div>
                <button
                  onClick={handleRetry}
                  disabled={updateMutation.isPending}
                  className="glass border border-border rounded-full px-4 py-1.5 text-foreground text-sm font-semibold disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pb-2">
              <button
                onClick={handleClear}
                disabled={updateMutation.isPending}
                className="glass border border-border rounded-full px-6 py-3 hover:glass-strong transition-all text-foreground font-semibold flex-1 disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
              >
                Clear
              </button>
              <button
                onClick={handleApply}
                disabled={updateMutation.isPending}
                className="btn-glow px-6 py-3 text-white font-semibold rounded-full disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none flex items-center justify-center gap-2 flex-1"
              >
                {updateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Apply
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

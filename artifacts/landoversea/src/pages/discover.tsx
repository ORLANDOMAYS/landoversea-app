import { useState, useEffect, useRef } from 'react';
import { resolveMediaUrl } from '@/lib/media-url';
import {
  getGetDiscoverCardsQueryKey,
  getGetDiscoverFiltersQueryKey,
  useGetDiscoverFilters,
  useUpdateDiscoverFilters,
  useGetSuperlikeBalance,
  type DiscoverFiltersInput,
} from '@workspace/api-client-react';
import {
  Loader2,
  MapPin,
  X,
  Heart,
  Globe,
  ShieldCheck,
  Mic,
  Zap,
  Eye,
  AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { useToast } from '@/hooks/use-toast';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import Starfield from '@/components/Starfield';
import { useI18n } from '@/i18n';
import { normalizeApiError } from '@/lib/api-error';
import {
  DISCOVER_FILTER_DEFAULTS,
  clearLegacyFiltersExt,
  normalizeDiscoverGender,
  type CanonicalDiscoverGender,
} from '@/lib/discover-filters';
import {
  liveKeys,
  useLiveDiscovery,
  useLiveSwipe,
} from '@/hooks/use-supabase-surfaces';

const LANGUAGE_OPTIONS = [
  'English','Mandarin','Spanish','French','Japanese','Korean',
  'Portuguese','Arabic','Hindi','German','Italian','Russian',
  'Thai','Vietnamese','Indonesian','Malay','Turkish','Dutch','Polish','Swedish','Tagalog','Swahili',
];

const GENDER_OPTIONS = [
  { value: 'male', labelKey: 'filtersPage.genderMan' },
  { value: 'female', labelKey: 'filtersPage.genderWoman' },
  { value: 'non_binary', labelKey: 'filtersPage.genderNonBinary' },
  { value: null, labelKey: 'filtersPage.genderEveryone' },
] as const satisfies ReadonlyArray<{
  value: CanonicalDiscoverGender | null;
  labelKey: 'filtersPage.genderMan' | 'filtersPage.genderWoman' | 'filtersPage.genderNonBinary' | 'filtersPage.genderEveryone';
}>;

// Canonical relationship goal enum values shared with the profile.
const RELATIONSHIP_GOAL_OPTIONS = [
  { value: 'serious', label: '💍 Serious Relationship' },
  { value: 'casual', label: '☕ Casual Dating' },
  { value: 'friendship', label: '🤝 Friendship' },
  { value: 'language_exchange', label: '🌐 Language Exchange' },
  { value: 'networking', label: '💼 Networking' },
  { value: 'open', label: '✨ Open to Anything' },
];

export default function Discover() {
  const { t, locale } = useI18n();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const swipeMutation = useLiveSwipe();
  const [currentIndex, setCurrentIndex] = useState(0);

  // Drag state for overlay
  const [dragX, setDragX] = useState(0);
  const [dragY, setDragY] = useState(0);
  const isDragging = useRef(false);

  // Filters state — hydrated from the persisted canonical filter model.
  const [showFilters, setShowFilters] = useState(false);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const filterDialogRef = useRef<HTMLDivElement>(null);
  const [filters, setFilters] = useState({
    minAge: DISCOVER_FILTER_DEFAULTS.minAge,
    maxAge: DISCOVER_FILTER_DEFAULTS.maxAge,
    gender: null as CanonicalDiscoverGender | null,
    country: '',
    language: '',
    globalMode: DISCOVER_FILTER_DEFAULTS.globalMode,
    relationshipGoal: '' as string,
    interestsOverlap: false,
    verifiedOnly: false,
    longDistance: false,
    relocation: false,
  });

  const {
    data: discoverFilters,
    isLoading: areFiltersLoading,
    isError: isFiltersError,
    error: filtersLoadError,
    refetch: refetchDiscoverFilters,
  } = useGetDiscoverFilters();
  const updateFiltersMutation = useUpdateDiscoverFilters();
  const {
    data: cards,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useLiveDiscovery(discoverFilters);

  // Inline filter-mutation error + the exact payload that failed, for Retry.
  const [filterError, setFilterError] = useState<string | null>(null);
  const [lastFilterPayload, setLastFilterPayload] = useState<{
    data: DiscoverFiltersInput;
    closeOnSuccess: boolean;
  } | null>(null);

  useEffect(() => {
    if (!showFilters) return;
    const previousActive = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : filterTriggerRef.current;
    const dialog = filterDialogRef.current;
    const focusable = () => Array.from(
      dialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowFilters(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = oldOverflow;
      previousActive?.focus();
    };
  }, [showFilters]);

  useEffect(() => {
    if (discoverFilters) {
      setFilters(prev => ({
        ...prev,
        minAge: discoverFilters.minAge ?? DISCOVER_FILTER_DEFAULTS.minAge,
        maxAge: discoverFilters.maxAge ?? DISCOVER_FILTER_DEFAULTS.maxAge,
        gender: normalizeDiscoverGender(discoverFilters.gender),
        country: discoverFilters.countries?.[0] ?? '',
        language: discoverFilters.languages?.[0] ?? '',
        globalMode: discoverFilters.globalMode ?? DISCOVER_FILTER_DEFAULTS.globalMode,
        relationshipGoal: discoverFilters.relationshipGoal ?? '',
        interestsOverlap: discoverFilters.interestsOverlap ?? false,
        verifiedOnly: discoverFilters.verifiedOnly ?? false,
        longDistance: discoverFilters.longDistance ?? false,
        relocation: discoverFilters.relocation ?? false,
      }));
    }
  }, [discoverFilters]);

  const { data: superlikeData, refetch: refetchSuperlikes } = useGetSuperlikeBalance();
  const superlikesRemaining = superlikeData?.remaining ?? null;
  const superlikeDisabled = superlikesRemaining !== null && superlikesRemaining === 0;

  const buildPayload = (state: typeof filters): DiscoverFiltersInput => ({
    minAge: state.minAge,
    maxAge: state.maxAge,
    gender: state.gender,
    countries: !state.globalMode && state.country ? [state.country] : [],
    languages: state.language ? [state.language] : [],
    globalMode: state.globalMode,
    relationshipGoal: state.relationshipGoal || null,
    interestsOverlap: state.interestsOverlap,
    verifiedOnly: state.verifiedOnly,
    longDistance: state.longDistance,
    relocation: state.relocation,
  });

  // PATCH a payload; on success clear legacy state, reset the deck, refetch
  // cards, and (optionally) close the panel. On error store payload for Retry.
  const runFilterUpdate = (payload: { data: DiscoverFiltersInput; closeOnSuccess: boolean }) => {
    setFilterError(null);
    setLastFilterPayload(payload);
    updateFiltersMutation.mutate(
      { data: payload.data },
      {
        onSuccess: () => {
          clearLegacyFiltersExt();
          setCurrentIndex(0);
          queryClient.invalidateQueries({ queryKey: getGetDiscoverFiltersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDiscoverCardsQueryKey() });
          queryClient.invalidateQueries({ queryKey: liveKeys.discovery });
          setLastFilterPayload(null);
          if (payload.closeOnSuccess) setShowFilters(false);
        },
        onError: (err) => {
          const { message } = normalizeApiError(err, t('discover.filterSaveError'));
          setFilterError(message);
          toast({ title: t('discover.filterSaveError'), description: message, variant: 'destructive' });
        },
      }
    );
  };

  const handleApplyFilters = () => {
    runFilterUpdate({ data: buildPayload(filters), closeOnSuccess: true });
  };

  const handleClearFilters = () => {
    const cleared = {
      minAge: DISCOVER_FILTER_DEFAULTS.minAge,
      maxAge: DISCOVER_FILTER_DEFAULTS.maxAge,
      gender: null as CanonicalDiscoverGender | null,
      country: '',
      language: '',
      globalMode: DISCOVER_FILTER_DEFAULTS.globalMode,
      relationshipGoal: '',
      interestsOverlap: DISCOVER_FILTER_DEFAULTS.interestsOverlap,
      verifiedOnly: DISCOVER_FILTER_DEFAULTS.verifiedOnly,
      longDistance: DISCOVER_FILTER_DEFAULTS.longDistance,
      relocation: DISCOVER_FILTER_DEFAULTS.relocation,
    };
    setFilters(cleared);
    runFilterUpdate({ data: { ...DISCOVER_FILTER_DEFAULTS }, closeOnSuccess: true });
  };

  const handleGlobalModeToggle = () => {
    const next = { ...filters, globalMode: !filters.globalMode };
    setFilters(next);
    runFilterUpdate({ data: buildPayload(next), closeOnSuccess: false });
  };

  const handleFilterRetry = () => {
    if (lastFilterPayload) runFilterUpdate(lastFilterPayload);
  };

  const handleTranslateBio = () => {
    toast({
      title: 'Translation unavailable',
      description: locale === 'en'
        ? 'Choose another app language in Settings to request translated profile text.'
        : 'Profile translation is not currently available. The original text is still shown.',
      variant: 'destructive',
    });
  };

  useEffect(() => {
    const remaining = (cards?.length ?? 0) - currentIndex;
    if (remaining <= 3 && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [cards?.length, currentIndex, fetchNextPage, hasNextPage, isFetchingNextPage]);

  const currentCards = cards || [];
  const card = currentCards[currentIndex];
  const profile = card?.profile;

  const handleSwipe = (direction: 'like' | 'pass' | 'superlike') => {
    if (swipeMutation.isPending || !card) return;
    swipeMutation.mutate(
      { targetUserId: profile.userId, action: direction },
      {
        onSuccess: result => {
          if (result.isMatch) {
            toast({
              title: t('discover.matchTitle'),
              description: t('discover.matchDesc', { name: profile.name }),
              action: (
                <Link href={`/messages/${result.conversationId}`}>
                  <button className="btn-glow px-3 py-1.5 text-xs rounded-full">{t('discover.sayHi')}</button>
                </Link>
              ),
            });
          }
          if (direction === 'superlike') {
            refetchSuperlikes();
          }
          setCurrentIndex(prev => prev + 1);
          setDragX(0);
          setDragY(0);
        },
        onError: (err) => {
          const { message } = normalizeApiError(err, 'Your choice could not be saved.');
          toast({ title: 'Action failed', description: message, variant: 'destructive' });
        },
      }
    );
  };

  const handleDragEnd = (_e: unknown, info: PanInfo) => {
    isDragging.current = false;
    setDragX(0);
    setDragY(0);
    if (swipeMutation.isPending) return;
    const threshold = 100;
    if (info.offset.x > threshold) {
      handleSwipe('like');
    } else if (info.offset.x < -threshold) {
      handleSwipe('pass');
    } else if (info.offset.y < -threshold) {
      handleSwipe('superlike');
    }
  };

  const handleDrag = (_e: unknown, info: PanInfo) => {
    setDragX(info.offset.x);
    setDragY(info.offset.y);
  };

  // Canonical persisted filters must be known before starting or emptying the
  // live deck; otherwise a failed filter request looks like "seen everyone".
  if (areFiltersLoading || (!discoverFilters && !isFiltersError) || isLoading) {
    return (
      <div className="relative h-[100dvh] flex flex-col overflow-hidden bg-transparent">
        <Starfield />
        <div className="flex-1 flex items-center justify-center z-10">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (isFiltersError) {
    return (
      <div className="relative h-[100dvh] flex flex-col overflow-hidden bg-transparent">
        <Starfield />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 z-10 gap-4">
          <AlertTriangle className="w-12 h-12 text-red-400" />
          <h2 className="text-2xl font-serif font-bold text-foreground">Couldn't load your discovery filters</h2>
          <p className="text-muted-foreground text-sm max-w-xs">
            {normalizeApiError(filtersLoadError, 'Your saved filters are unavailable. Please try again.').message}
          </p>
          <button
            onClick={() => refetchDiscoverFilters()}
            className="glass px-5 py-2.5 rounded-full text-foreground text-sm mt-2"
          >
            {t('common.retry')}
          </button>
        </div>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="relative h-[100dvh] flex flex-col overflow-hidden bg-transparent">
        <Starfield />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 z-10 gap-4">
          <Globe className="w-12 h-12 text-primary" />
          <h2 className="text-2xl font-serif font-bold text-foreground">{t('discover.loadErrorTitle')}</h2>
          <p className="text-muted-foreground text-sm max-w-xs">{t('discover.loadErrorDesc')}</p>
          <button
            onClick={() => refetch()}
            className="glass px-5 py-2.5 rounded-full text-foreground text-sm mt-2"
          >
            {t('common.retry')}
          </button>
        </div>
      </div>
    );
  }

  // Empty state
  if (currentCards.length === 0 || currentIndex >= currentCards.length) {
    if (isFetchingNextPage) {
      return (
        <div className="relative h-[100dvh] flex flex-col overflow-hidden bg-transparent">
          <Starfield />
          <div className="flex-1 flex items-center justify-center z-10">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
          </div>
        </div>
      );
    }
    return (
      <div className="relative h-[100dvh] flex flex-col overflow-hidden bg-transparent">
        <Starfield />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 z-10 gap-4">
          <div className="text-5xl mb-2">✈️</div>
          <h2 className="text-2xl font-serif font-bold text-foreground">{t('discover.seenEveryoneTitle')}</h2>
          <p className="text-muted-foreground text-sm max-w-xs">{t('discover.seenEveryoneDesc')}</p>
          <button
            onClick={() => setShowFilters(true)}
            className="glass px-5 py-2.5 rounded-full text-foreground text-sm mt-2"
          >
            {t('discover.adjustFilters')}
          </button>
        </div>
      </div>
    );
  }

  const primaryPhoto =
    resolveMediaUrl(profile.photos?.[0]?.url) ||
    'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&q=80&w=800';

  // Determine overlay
  const showLikeOverlay = dragX > 40;
  const showPassOverlay = dragX < -40;
  const showSuperlikeOverlay = dragY < -60 && Math.abs(dragX) < 60;

  // Card stack — back, middle, front
  const backCard = currentCards[currentIndex + 2];
  const midCard = currentCards[currentIndex + 1];
  const frontCard = currentCards[currentIndex];

  return (
    <div className="relative h-[100dvh] flex flex-col overflow-hidden bg-transparent">
      <Starfield />

      {/* ── SECTION 1: TOP HEADER BAR ── */}
      <div className="flex items-center justify-between px-4 pt-[env(safe-area-inset-top)] pt-4 pb-2 z-20 relative">
        {/* Left: Culture pill */}
        <div className="glass px-3 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Globe size={14} style={{ color: '#63E6FF' }} />
          {t('discover.culture')}
        </div>

        {/* Center: Wordmark + tagline */}
        <div className="flex flex-col items-center">
          <div className="flex items-baseline gap-0.5">
            <span
              style={{ fontFamily: 'var(--font-script)', fontSize: '22px' }}
              className="bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent leading-none"
            >
              Land
            </span>
            <span
              style={{ fontFamily: 'var(--font-script)', fontSize: '22px' }}
              className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent leading-none"
            >
              Over
            </span>
            <span
              style={{ fontFamily: 'var(--font-script)', fontSize: '22px' }}
              className="text-foreground leading-none"
            >
              SEA
            </span>
          </div>
          <span className="text-[8px] uppercase tracking-widest text-muted-foreground mt-0.5">
            {t('discover.subtitle')}
          </span>
        </div>

        {/* Right: Why Us pill */}
        <button
          ref={filterTriggerRef}
          type="button"
          onClick={() => setShowFilters(true)}
          aria-haspopup="dialog"
          aria-expanded={showFilters}
          className="px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer border border-pink-500/30"
          style={{
            background: 'linear-gradient(135deg, rgba(255,45,122,0.2), rgba(139,92,246,0.2))',
          }}
        >
          <span className="bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">
            {t('discover.whyUs')}
          </span>
        </button>
      </div>

      {/* ── SECTION 2: CARD DECK ── */}
      <div className="flex-1 flex items-center justify-center relative px-4 py-2">
        {/* Back card (index+2) */}
        {backCard && (
          <div
            className="absolute w-full max-w-[340px] aspect-[3/4] rounded-[28px] overflow-hidden shadow-2xl"
            style={{
              zIndex: 10,
              transform: 'scale(0.86) translateY(24px)',
              opacity: 0.5,
            }}
          >
            <img
              src={resolveMediaUrl(backCard.profile.photos?.[0]?.url) || primaryPhoto}
              alt={backCard.profile.name}
              className="absolute inset-0 w-full h-full object-cover"
              draggable="false"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />
          </div>
        )}

        {/* Middle card (index+1) */}
        {midCard && (
          <div
            className="absolute w-full max-w-[340px] aspect-[3/4] rounded-[28px] overflow-hidden shadow-2xl"
            style={{
              zIndex: 20,
              transform: 'scale(0.93) translateY(12px)',
              opacity: 0.7,
            }}
          >
            <img
              src={resolveMediaUrl(midCard.profile.photos?.[0]?.url) || primaryPhoto}
              alt={midCard.profile.name}
              className="absolute inset-0 w-full h-full object-cover"
              draggable="false"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />
          </div>
        )}

        {/* Front / active card */}
        <AnimatePresence mode="popLayout">
          <motion.div
            key={frontCard.userId}
            className="absolute w-full max-w-[340px] aspect-[3/4] rounded-[28px] overflow-hidden shadow-2xl cursor-grab active:cursor-grabbing"
            style={{ zIndex: 30 }}
            drag={swipeMutation.isPending ? false : true}
            dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
            dragElastic={0.7}
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{
              x: dragX > 0 ? 500 : dragX < 0 ? -500 : 0,
              y: dragY < -60 ? -500 : 0,
              rotate: dragX > 0 ? 30 : dragX < 0 ? -30 : 0,
              opacity: 0,
              transition: { duration: 0.3 },
            }}
            transition={{ type: 'spring', stiffness: 300, damping: 22 }}
          >
            {/* Photo */}
            <img
              src={primaryPhoto}
              alt={profile.name}
              className="absolute inset-0 w-full h-full object-cover"
              draggable="false"
            />

            {/* Bottom gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent z-10" />

            {/* Drag overlays */}
            <AnimatePresence>
              {showLikeOverlay && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-40 flex items-center justify-center"
                  style={{ background: 'rgba(0,200,80,0.25)' }}
                >
                  <span className="text-green-400 text-4xl font-bold font-serif border-4 border-green-400 px-4 py-1 rounded-xl rotate-[-15deg]">
                    {t('discover.overlayConnect')}
                  </span>
                </motion.div>
              )}
              {showPassOverlay && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-40 flex items-center justify-center"
                  style={{ background: 'rgba(220,50,50,0.25)' }}
                >
                  <span className="text-red-400 text-4xl font-bold font-serif border-4 border-red-400 px-4 py-1 rounded-xl rotate-[15deg]">
                    {t('discover.overlaySkip')}
                  </span>
                </motion.div>
              )}
              {showSuperlikeOverlay && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-40 flex items-center justify-center"
                  style={{ background: 'rgba(255,200,0,0.2)' }}
                >
                  <span className="text-yellow-400 text-4xl font-bold font-serif border-4 border-yellow-400 px-4 py-1 rounded-xl">
                    {t('discover.overlaySuper')}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Verified badge */}
            {profile.isVerified && (
              <div className="absolute top-4 right-4 z-20 flex items-center gap-1 bg-black/60 backdrop-blur-md px-2 py-1 rounded-full text-xs text-white">
                <ShieldCheck size={12} className="text-cyan-400" />
                {t('profile.verified')}
              </div>
            )}

            {/* Cultural Profile pill */}
            <div className="absolute top-4 left-4 z-20 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-full text-xs text-white flex items-center gap-1">
              <Globe size={12} style={{ color: '#63E6FF' }} />
              {t('discover.culturalProfile')}
            </div>

            {/* Bottom info */}
            <div className="absolute bottom-0 left-0 right-0 p-5 z-20">
              {/* Name & age */}
              <h2 className="text-2xl font-serif font-bold text-white">
                {profile.name}{profile.age ? `, ${profile.age}` : ''}
              </h2>

              {/* Location */}
              <div className="flex items-center gap-1 mt-1">
                <MapPin size={13} className="text-white flex-shrink-0" />
                <span className="text-white text-sm">
                  {profile.city ? `${profile.city}, ` : ''}
                  {profile.country || t('discover.globalCitizen')}
                  {card.distanceKm ? ` · ${Math.round(card.distanceKm)} km` : ''}
                </span>
              </div>

              {/* Language + voice pills */}
              <div className="flex flex-wrap gap-2 mt-2">
                {profile.primaryLanguage && (
                  <span className="glass px-2 py-0.5 rounded-full text-xs text-cyan-400 border border-cyan-400/30">
                    {profile.primaryLanguage}
                  </span>
                )}
                {profile.voiceIntroUrl && (
                  <span className="glass px-2 py-0.5 rounded-full text-xs text-pink-400 border border-pink-400/30 flex items-center gap-1">
                    <Mic size={10} />
                    {t('discover.voiceIntro')}
                  </span>
                )}
              </div>

              {/* Cultural / relationship badges */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {profile.relationshipGoal && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs border border-white/20 glass text-white/80">
                    {profile.relationshipGoal}
                  </span>
                )}
                {profile.interests?.slice(0, 2).map(interest => (
                  <span
                    key={interest}
                    className="px-2.5 py-0.5 rounded-full text-xs border border-white/20 glass text-white/80"
                  >
                    {interest}
                  </span>
                ))}
              </div>

              {/* Bio */}
              {profile.bio && (
                <div className="mt-3">
                  <p className="text-sm text-white line-clamp-2">{profile.bio}</p>
                  <button
                    type="button"
                    onClick={handleTranslateBio}
                    aria-label={`${t('discover.translate')} ${profile.name}'s bio`}
                    className="text-xs text-cyan-400 underline cursor-pointer mt-1"
                  >
                    {t('discover.translate')}
                  </button>
                </div>
              )}

              {/* Why We Connect */}
              <div className="mt-3 glass rounded-xl p-3">
                <p className="text-xs text-pink-400 font-medium mb-1">{t('discover.whyWeConnect')}</p>
                <p className="text-xs text-white">
                  {card.sharedLanguages && card.sharedLanguages.length > 0
                    ? t('discover.bothSpeak', { language: card.sharedLanguages[0] })
                    : card.sharedInterests && card.sharedInterests.length > 0
                    ? t('discover.sharedInterest', { interest: card.sharedInterests[0] })
                    : t('discover.compatibilityScore')}
                </p>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── SECTION 3: PILLS ROW ── */}
      <div className="flex items-center justify-center gap-3 py-2 z-20 relative">
        <div className="glass px-3 py-1.5 rounded-full text-xs text-cyan-400 border border-cyan-400/20">
          {t('discover.liveTranslation')}
        </div>
        <div className="glass px-3 py-1.5 rounded-full text-xs text-pink-400 border border-pink-400/20">
          {t('discover.culturalCoach')}
        </div>
      </div>

      {/* Superlike zap button row */}
      <div className="flex items-center justify-center z-20 relative mb-1">
        <button
          type="button"
          aria-label={`${t('discover.superlike')} ${profile.name}`}
          onClick={() => handleSwipe('superlike')}
          disabled={swipeMutation.isPending || superlikeDisabled}
          className="relative flex items-center gap-1.5 glass px-3 py-1.5 rounded-full text-xs border border-yellow-400/30 text-yellow-400 disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none disabled:cursor-not-allowed"
        >
          <Zap size={12} className="fill-yellow-400" />
          {t('discover.superlike')}
          {superlikesRemaining !== null && (
            <span className="ml-1 bg-yellow-400/20 text-yellow-300 rounded-full px-1.5 py-0.5 text-[10px] font-bold">
              {superlikesRemaining}
            </span>
          )}
        </button>
      </div>

      {/* ── SECTION 4: ACTION BUTTONS ── */}
      <div
        className="flex items-center justify-center gap-4 pb-4 z-20 relative"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        {/* Skip button */}
        <button
          type="button"
          aria-label={`${t('discover.overlaySkip')} ${profile.name}`}
          onClick={() => handleSwipe('pass')}
          disabled={swipeMutation.isPending}
          className="w-14 h-14 rounded-full glass flex items-center justify-center border border-border text-muted-foreground hover:text-red-400 hover:border-red-400/40 transition-colors active:scale-95 disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none disabled:cursor-not-allowed"
        >
          <X size={20} />
        </button>

        {/* Connect Across Cultures (main CTA) */}
        <button
          type="button"
          aria-label={`${t('discover.connect')} ${profile.name}`}
          onClick={() => handleSwipe('like')}
          disabled={swipeMutation.isPending}
          className="flex-1 max-w-[200px] h-14 btn-glow rounded-full flex items-center justify-center gap-2 text-sm font-semibold disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none disabled:cursor-not-allowed"
        >
          <Heart size={18} />
          {t('discover.connect')}
        </button>

        {/* View Profile button */}
        <button
          type="button"
          aria-label={`View ${profile.name}'s profile`}
          onClick={() => setLocation(`/profile/${profile.userId}`)}
          disabled={swipeMutation.isPending}
          className="w-14 h-14 rounded-full glass flex items-center justify-center border border-border text-muted-foreground hover:text-cyan-400 hover:border-cyan-400/40 transition-colors active:scale-95 disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none disabled:cursor-not-allowed"
        >
          <Eye size={20} />
        </button>
      </div>

      {/* ── FILTERS PANEL ── */}
      <AnimatePresence>
        {showFilters && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-[70]"
              aria-hidden="true"
              onClick={() => setShowFilters(false)}
            />
            <motion.div
              ref={filterDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="discover-filter-title"
              tabIndex={-1}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed bottom-0 left-0 right-0 glass-strong rounded-t-3xl p-6 z-[80] max-h-[80vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-5">
                <h2 id="discover-filter-title" className="text-xl font-serif font-bold text-foreground">{t('profile.discoveryFilters')}</h2>
                <button
                  type="button"
                  aria-label="Close discovery filters"
                  onClick={() => setShowFilters(false)}
                  className="w-8 h-8 rounded-full glass flex items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Global Mode toggle */}
              <div className="flex items-center justify-between mb-5 glass rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{t('discover.globalModeTitle')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('discover.globalModeDesc')}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={filters.globalMode}
                  aria-label={t('discover.globalModeTitle')}
                  onClick={handleGlobalModeToggle}
                  className={`w-12 h-6 rounded-full transition-colors relative ${
                    filters.globalMode ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                      filters.globalMode ? 'translate-x-6' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              <div className="space-y-4">
                {/* Age Range */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">{t('discover.minAge')}</label>
                    <input
                      type="number"
                      min={18}
                      max={99}
                      value={filters.minAge}
                      onChange={e =>
                        setFilters(prev => ({ ...prev, minAge: parseInt(e.target.value) || 18 }))
                      }
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/60"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">{t('discover.maxAge')}</label>
                    <input
                      type="number"
                      min={18}
                      max={99}
                      value={filters.maxAge}
                      onChange={e =>
                        setFilters(prev => ({ ...prev, maxAge: parseInt(e.target.value) || 60 }))
                      }
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/60"
                    />
                  </div>
                </div>

                {/* Gender */}
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    {t('filtersPage.showMe')}
                  </label>
                  <select
                    value={filters.gender ?? ''}
                    onChange={e => setFilters(prev => ({
                      ...prev,
                      gender: normalizeDiscoverGender(e.target.value),
                    }))}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/60"
                  >
                    {GENDER_OPTIONS.map(option => (
                      <option
                        key={option.value ?? 'everyone'}
                        value={option.value ?? ''}
                        className="bg-background text-foreground"
                      >
                        {t(option.labelKey)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Country */}
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">{t('discover.country')}</label>
                  <input
                    type="text"
                    placeholder={t('discover.anyCountry')}
                    value={filters.country}
                    onChange={e => setFilters(prev => ({ ...prev, country: e.target.value }))}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/60"
                  />
                </div>

                {/* Language */}
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">{t('discover.language')}</label>
                  <select
                    value={filters.language}
                    onChange={e => setFilters(prev => ({ ...prev, language: e.target.value }))}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/60"
                  >
                    <option value="" className="bg-background text-foreground">{t('discover.anyLanguage')}</option>
                    {LANGUAGE_OPTIONS.map(l => (
                      <option key={l} value={l} className="bg-background text-foreground">
                        {l}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Relationship goal */}
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">{t('discover.lookingForFilter')}</label>
                  <select
                    value={filters.relationshipGoal}
                    onChange={e => setFilters(prev => ({ ...prev, relationshipGoal: e.target.value }))}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/60"
                  >
                    <option value="" className="bg-background text-foreground">{t('discover.anyGoal')}</option>
                    {RELATIONSHIP_GOAL_OPTIONS.map(g => (
                      <option key={g.value} value={g.value} className="bg-background text-foreground">
                        {g.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Advanced toggles */}
                <div className="space-y-2">
                  <label className="flex items-center justify-between glass rounded-lg px-4 py-2.5 cursor-pointer">
                    <span className="text-sm text-foreground">{t('discover.verifiedOnlyFilter')}</span>
                    <input
                      type="checkbox"
                      checked={filters.verifiedOnly}
                      onChange={e => setFilters(prev => ({ ...prev, verifiedOnly: e.target.checked }))}
                      className="accent-primary w-4 h-4"
                    />
                  </label>
                  <label className="flex items-center justify-between glass rounded-lg px-4 py-2.5 cursor-pointer">
                    <span className="text-sm text-foreground">{t('discover.interestsOverlap')}</span>
                    <input
                      type="checkbox"
                      checked={filters.interestsOverlap}
                      onChange={e => setFilters(prev => ({ ...prev, interestsOverlap: e.target.checked }))}
                      className="accent-primary w-4 h-4"
                    />
                  </label>
                  <label className="flex items-center justify-between glass rounded-lg px-4 py-2.5 cursor-pointer">
                    <span className="text-sm text-foreground">{t('discover.longDistanceFilter')}</span>
                    <input
                      type="checkbox"
                      checked={filters.longDistance}
                      onChange={e => setFilters(prev => ({ ...prev, longDistance: e.target.checked }))}
                      className="accent-primary w-4 h-4"
                    />
                  </label>
                  <label className="flex items-center justify-between glass rounded-lg px-4 py-2.5 cursor-pointer">
                    <span className="text-sm text-foreground">{t('discover.relocationFilter')}</span>
                    <input
                      type="checkbox"
                      checked={filters.relocation}
                      onChange={e => setFilters(prev => ({ ...prev, relocation: e.target.checked }))}
                      className="accent-primary w-4 h-4"
                    />
                  </label>
                </div>
              </div>

              {filterError && (
                <div
                  role="alert"
                  className="mt-4 glass rounded-lg p-3 border border-destructive/30 flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-foreground text-xs font-medium">{t('discover.filterSaveError')}</p>
                    <p className="text-muted-foreground text-xs mt-0.5">{filterError}</p>
                  </div>
                  <button
                    onClick={handleFilterRetry}
                    disabled={updateFiltersMutation.isPending}
                    className="glass border border-border rounded-full px-3 py-1 text-foreground text-xs font-semibold disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
                  >
                    {t('common.retry')}
                  </button>
                </div>
              )}

              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleClearFilters}
                  disabled={updateFiltersMutation.isPending}
                  className="flex-1 glass py-3 rounded-full text-sm font-medium text-foreground disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
                >
                  {t('discover.clear')}
                </button>
                <button
                  onClick={handleApplyFilters}
                  disabled={updateFiltersMutation.isPending}
                  className="flex-1 btn-glow py-3 rounded-full text-sm font-semibold disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
                >
                  {t('discover.applyFilters')}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

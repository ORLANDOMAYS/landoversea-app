import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { resolveMediaUrl } from '@/lib/media-url';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { useI18n, type TranslationKey } from '@/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, ArrowLeft, Upload, Check, Camera, Globe, Heart, Flame,
  Users, Briefcase, Sparkles, ChevronLeft, MapPin, Map, Compass, BookOpen
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { getPhotos, getProfile, uploadOwnPhoto, upsertOwnProfile } from '@/lib/supabase-api';

const TOTAL_STEPS = 14;
const MAX_PROFILE_PHOTO_BYTES = 12 * 1024 * 1024;
const PROFILE_PHOTO_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif',
]);

function isLikelyProfilePhoto(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = file.type.trim().toLowerCase();
  return (
    mime.startsWith('image/') ||
    ((mime === '' || mime === 'application/octet-stream') &&
      PROFILE_PHOTO_EXTENSIONS.has(extension))
  );
}

const INTERESTS_OPTIONS = [
  "Travel","Languages","Cooking","Music","Art","Hiking","Photography",
  "Movies","Reading","Yoga","Dancing","Gaming","Fashion","Sports",
  "Coffee","Wine","Tea Ceremonies","Meditation","Surfing","Cycling",
  "Festivals","History","Architecture","Street Food","Anime","K-pop",
  "Jazz","Classical Music","Volunteering","Entrepreneurship",
];

const GENDER_OPTIONS: { value: string; labelKey: TranslationKey }[] = [
  { value: "male", labelKey: 'onboarding.genders.man' },
  { value: "female", labelKey: 'onboarding.genders.woman' },
  { value: "non_binary", labelKey: 'onboarding.genders.nonBinary' },
  { value: "transgender", labelKey: 'onboarding.genders.transgender' },
  { value: "prefer_not_to_say", labelKey: 'onboarding.genders.preferNotToSay' },
  { value: "other", labelKey: 'onboarding.genders.other' },
];

const LOOKING_FOR_OPTIONS: { value: string; labelKey: TranslationKey }[] = [
  { value: "male", labelKey: 'onboarding.lookingForOptions.man' },
  { value: "female", labelKey: 'onboarding.lookingForOptions.woman' },
  { value: "non_binary", labelKey: 'onboarding.lookingForOptions.nonBinary' },
  { value: "everyone", labelKey: 'onboarding.lookingForOptions.everyone' },
];

const GOAL_OPTIONS: { value: string; labelKey: TranslationKey; icon: React.ElementType }[] = [
  { value:"serious",          labelKey:'onboarding.goals.serious',          icon: Heart },
  { value:"casual",           labelKey:'onboarding.goals.casual',           icon: Flame },
  { value:"friendship",       labelKey:'onboarding.goals.friendship',       icon: Users },
  { value:"language_exchange",labelKey:'onboarding.goals.languageExchange', icon: Globe },
  { value:"networking",       labelKey:'onboarding.goals.networking',       icon: Briefcase },
  { value:"open",             labelKey:'onboarding.goals.open',             icon: Sparkles },
];

const LANGUAGE_OPTIONS = [
  "English","Mandarin","Spanish","French","Japanese","Korean",
  "Portuguese","Arabic","Hindi","German","Italian","Russian",
  "Thai","Vietnamese","Indonesian","Malay","Turkish","Dutch","Polish","Swedish","Tagalog","Swahili",
];

const COUNTRY_OPTIONS = [
  "Japan","Korea","France","Brazil","India","Mexico","Nigeria","Italy",
  "China","Spain","UK","Australia","Germany","Morocco","Colombia",
  "Ethiopia","Turkey","Indonesia","Philippines","Egypt",
];

const CULTURAL_GOALS: { value: string; labelKey: TranslationKey; icon: React.ElementType }[] = [
  { value:"language_exchange",  icon:Globe, labelKey:'onboarding.culturalGoals.languageExchangeLabel' },
  { value:"romance",            icon:Heart, labelKey:'onboarding.culturalGoals.romanceLabel' },
  { value:"friendship",         icon:Users, labelKey:'onboarding.culturalGoals.friendshipLabel' },
  { value:"travel",             icon:Compass, labelKey:'onboarding.culturalGoals.travelLabel' },
  { value:"professional",       icon:Briefcase, labelKey:'onboarding.culturalGoals.professionalLabel' },
  { value:"learning",           icon:BookOpen, labelKey:'onboarding.culturalGoals.learningLabel' },
];

const RELOCATION_OPTIONS: { value: string; labelKey: TranslationKey }[] = [
  { value: "yes", labelKey: 'onboarding.relocation.yes' },
  { value: "no", labelKey: 'onboarding.relocation.no' },
  { value: "not_sure", labelKey: 'onboarding.relocation.notSure' },
];

const LONG_DISTANCE_OPTIONS: { value: string; labelKey: TranslationKey }[] = [
  { value: "yes", labelKey: 'onboarding.longDistance.yes' },
  { value: "no", labelKey: 'onboarding.longDistance.no' },
  { value: "not_sure", labelKey: 'onboarding.relocation.notSure' },
];

const DRAFT_VERSION = 1;
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface OnboardingFormData {
  name: string;
  age: string;
  bio: string;
  primaryLanguage: string;
  country: string;
  city: string;
  gender: string;
  lookingFor: string;
  relationshipGoal: string;
  relocation: string;
  longDistance: string;
  minAge: string;
  maxAge: string;
}

interface OnboardingDraft {
  version: number;
  userId: string;
  updatedAt: number;
  savedAt?: number;
  baseServerUpdatedAt?: string | null;
  step: number;
  formData: Partial<OnboardingFormData>;
  learningLanguages: string[];
  interests: string[];
  culturalGoals: string[];
  preferredCountries: string[];
}

const DEFAULT_FORM_DATA: OnboardingFormData = {
  name: '',
  age: '',
  bio: '',
  primaryLanguage: 'English',
  country: '',
  city: '',
  gender: '',
  lookingFor: '',
  relationshipGoal: '',
  relocation: '',
  longDistance: '',
  minAge: '18',
  maxAge: '60',
};

function canonicalGender(value: string | null | undefined): string {
  if (!value) return '';
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const aliases: Record<string, string> = {
    man: 'male',
    woman: 'female',
    nonbinary: 'non_binary',
    'prefer_not_to_say': 'prefer_not_to_say',
  };
  return aliases[normalized] ?? normalized;
}

function canonicalLookingFor(value: string | null | undefined): string {
  if (!value) return '';
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const aliases: Record<string, string> = {
    man: 'male',
    woman: 'female',
    nonbinary: 'non_binary',
  };
  return aliases[normalized] ?? normalized;
}

function triStatePreference(value: string): boolean | null {
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return null;
}

function preferenceFormValue(value: boolean | null | undefined): string {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'not_sure';
}

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 50 : -50,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 50 : -50,
    opacity: 0,
  }),
};

export default function Onboarding() {
  const { t } = useI18n();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const hydrationIdRef = useRef(0);
  const baseServerUpdatedAtRef = useRef<string | null>(null);

  const [initialized, setInitialized] = useState(false);
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  const [hydrationAttempt, setHydrationAttempt] = useState(0);
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState<OnboardingFormData>(DEFAULT_FORM_DATA);
  const [learningLanguages, setLearningLanguages] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [culturalGoals, setCulturalGoals] = useState<string[]>([]);
  const [preferredCountries, setPreferredCountries] = useState<string[]>([]);

  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoUploaded, setPhotoUploaded] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoUploadProgress, setPhotoUploadProgress] = useState(0);
  const [photoUploadError, setPhotoUploadError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const hydrationId = ++hydrationIdRef.current;

    setInitialized(false);
    setHydrationError(null);
    setStep(1);
    setDirection(1);
    setErrors({});
    setFormData({ ...DEFAULT_FORM_DATA });
    setLearningLanguages([]);
    setInterests([]);
    setCulturalGoals([]);
    setPreferredCountries([]);
    setPhotoPreview(null);
    setPhotoFile(null);
    setPhotoUploaded(false);
    setUploadingPhoto(false);
    setPhotoUploadProgress(0);
    setPhotoUploadError(null);
    baseServerUpdatedAtRef.current = null;

    if (!userId) return;

    // Clear legacy
    localStorage.removeItem('los_onboarding_draft');

    const draftKey = `los_onboarding_draft_v2_${userId}`;
    const draftStr = localStorage.getItem(draftKey);
    let draft: OnboardingDraft | null = null;
    if (draftStr) {
      try {
        const p = JSON.parse(draftStr);
        const localUpdatedAt = p.updatedAt ?? p.savedAt;
        if (p.version === DRAFT_VERSION && p.userId === userId && typeof localUpdatedAt === 'number' && Date.now() - localUpdatedAt < DRAFT_MAX_AGE_MS) {
          draft = { ...p, updatedAt: localUpdatedAt };
        }
      } catch {}
    }

    Promise.all([getProfile(userId), getPhotos(userId)])
      .then(([supabaseProfile, photos]) => {
        const profile = supabaseProfile ? {
          name: supabaseProfile.display_name,
          age: supabaseProfile.age,
          bio: supabaseProfile.bio,
          primaryLanguage: supabaseProfile.language,
          country: supabaseProfile.country,
          city: supabaseProfile.city,
          gender: canonicalGender(supabaseProfile.gender),
          lookingFor: canonicalLookingFor(supabaseProfile.interested_in),
          updatedAt: supabaseProfile.updated_at,
          photos,
          relationshipGoal: supabaseProfile.relationship_goal,
          relocationOpenness: supabaseProfile.relocation_openness,
          longDistanceOpenness: supabaseProfile.long_distance,
          preferredMinAge: supabaseProfile.preferred_min_age,
          preferredMaxAge: supabaseProfile.preferred_max_age,
          interests: supabaseProfile.interests,
          learningLanguages: supabaseProfile.learning_languages,
          culturalInterests: supabaseProfile.cultural_interests,
          countriesOfInterest: supabaseProfile.countries_of_interest,
        } : null;
        if (hydrationIdRef.current !== hydrationId) return;
        const serverVersion = profile?.updatedAt ?? null;
        baseServerUpdatedAtRef.current = serverVersion;
        const draftHasBaseVersion = draft
          ? Object.prototype.hasOwnProperty.call(draft, 'baseServerUpdatedAt')
          : false;
        const activeDraft = draft && (
          draftHasBaseVersion
            ? draft.baseServerUpdatedAt === serverVersion
            : serverVersion === null
        ) ? draft : null;

        const d = activeDraft?.formData ?? {};
        const has = (v: unknown) => v !== undefined && v !== null && v !== '';
        const draftHas = (field: keyof OnboardingFormData) =>
          Object.prototype.hasOwnProperty.call(d, field);

        setFormData({
          name: has(d.name) ? d.name! : (profile?.name ?? user?.user_metadata?.display_name ?? ''),
          age: has(d.age) ? d.age! : (profile?.age != null ? String(profile.age) : ''),
          bio: draftHas('bio') ? (d.bio ?? '') : (profile?.bio ?? ''),
          primaryLanguage: has(d.primaryLanguage) ? d.primaryLanguage! : (profile?.primaryLanguage ?? 'English'),
          country: has(d.country) ? d.country! : (profile?.country ?? ''),
          city: draftHas('city') ? (d.city ?? '') : (profile?.city ?? ''),
          gender: has(d.gender) ? canonicalGender(d.gender) : (profile?.gender ?? ''),
          lookingFor: has(d.lookingFor) ? canonicalLookingFor(d.lookingFor) : (profile?.lookingFor ?? ''),
          relationshipGoal: has(d.relationshipGoal) ? d.relationshipGoal! : (profile?.relationshipGoal ?? ''),
          relocation: has(d.relocation) ? d.relocation! : preferenceFormValue(profile?.relocationOpenness),
          longDistance: has(d.longDistance) ? d.longDistance! : preferenceFormValue(profile?.longDistanceOpenness),
          minAge: has(d.minAge) ? d.minAge! : (profile?.preferredMinAge != null ? String(profile.preferredMinAge) : '18'),
          maxAge: has(d.maxAge) ? d.maxAge! : (profile?.preferredMaxAge != null ? String(profile.preferredMaxAge) : '60'),
        });

        if (activeDraft?.interests) setInterests(activeDraft.interests);
        else if (profile?.interests) setInterests(profile.interests);

        if (activeDraft?.learningLanguages) setLearningLanguages(activeDraft.learningLanguages);
        else if (profile?.learningLanguages) setLearningLanguages(profile.learningLanguages);

        if (activeDraft?.culturalGoals) setCulturalGoals(activeDraft.culturalGoals);
        else if (profile?.culturalInterests) setCulturalGoals(profile.culturalInterests);

        if (activeDraft?.preferredCountries) setPreferredCountries(activeDraft.preferredCountries);
        else if (profile?.countriesOfInterest) setPreferredCountries(profile.countriesOfInterest);

        if (activeDraft?.step) {
          setStep(activeDraft.step >= 1 && activeDraft.step <= TOTAL_STEPS ? activeDraft.step : 1);
        }

        if (Array.isArray(profile?.photos) && profile.photos.length > 0) {
          setPhotoUploaded(true);
          setPhotoPreview(profile.photos[0].url);
        }

        setInitialized(true);
      })
      .catch((error: unknown) => {
        if (hydrationIdRef.current !== hydrationId) return;
        setHydrationError(
          error instanceof Error ? error.message : 'Unable to load your saved profile.',
        );
      });

    return () => {
      if (hydrationIdRef.current === hydrationId) hydrationIdRef.current += 1;
    };
  }, [userId, hydrationAttempt]);

  useEffect(() => {
    if (!initialized || !userId) return;

    const draft: OnboardingDraft = {
      version: DRAFT_VERSION,
      userId,
      updatedAt: Date.now(),
      baseServerUpdatedAt: baseServerUpdatedAtRef.current,
      step,
      formData,
      learningLanguages,
      interests,
      culturalGoals,
      preferredCountries,
    };
    try {
      localStorage.setItem(`los_onboarding_draft_v2_${userId}`, JSON.stringify(draft));
    } catch {}
  }, [initialized, userId, step, formData, learningLanguages, interests, culturalGoals, preferredCountries]);

  const set = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: '' }));
  };

  const toggleLearningLanguage = (lang: string) => {
    setLearningLanguages(prev => {
      if (prev.includes(lang)) return prev.filter(x => x !== lang);
      if (prev.length >= 4) return prev;
      return [...prev, lang];
    });
    setErrors(prev => ({ ...prev, otherLanguages: '' }));
  };

  const toggleInterest = (i: string) =>
    setInterests(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]);

  const toggleCulturalGoal = (v: string) =>
    setCulturalGoals(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);

  const toggleCountry = (c: string) =>
    setPreferredCountries(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);

  const validateStep = (): boolean => {
    const errs: Record<string, string> = {};
    if (step === 1) {
      if (!formData.name.trim()) errs.name = t('onboarding.errName');
      const age = parseInt(formData.age);
      if (!formData.age || isNaN(age)) errs.age = t('onboarding.errAge');
      else if (age < 18) errs.age = t('onboarding.errAgeMin');
      else if (age > 120) errs.age = t('onboarding.errAgeInvalid');
    }
    if (step === 2) {
      if (!formData.gender) errs.gender = t('onboarding.errGender');
    }
    if (step === 3) {
      if (!formData.lookingFor) errs.lookingFor = t('onboarding.errLookingFor');
    }
    if (step === 4) {
      if (!formData.country.trim()) errs.country = t('onboarding.errCountry');
    }
    if (step === 5) {
      if (!formData.primaryLanguage) errs.primaryLanguage = t('onboarding.errPrimaryLanguage');
    }
    if (step === 6) {
      if (learningLanguages.length < 1) errs.otherLanguages = t('onboarding.errOtherLanguages');
    }
    if (step === 9) {
      if (!formData.relationshipGoal) errs.relationshipGoal = t('onboarding.errGoal');
    }
    if (step === 10) {
      if (!formData.relocation) errs.relocation = t('onboarding.errRelocation');
    }
    if (step === 11) {
      if (!formData.longDistance) errs.longDistance = t('onboarding.errLongDistance');
    }
    if (step === 12) {
      if (!formData.bio.trim() || formData.bio.trim().length < 20)
        errs.bio = t('onboarding.errBio');
    }
    if (step === 13) {
      if (!photoUploaded) errs.photo = t('onboarding.errPhoto');
    }
    if (Object.keys(errs).length > 0) { setErrors(errs); return false; }
    return true;
  };

  const handleNext = () => {
    if (validateStep()) {
      setDirection(1);
      setStep(s => s + 1);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setDirection(-1);
      setStep(s => s - 1);
    }
  };

  const uploadSelectedPhoto = async (file: File) => {
    const alreadyHadUploadedPhoto = photoUploaded;
    setUploadingPhoto(true);
    setPhotoUploadProgress(0);
    setPhotoUploadError(null);
    setErrors(prev => ({ ...prev, photo: '' }));
    try {
      setPhotoUploadProgress(15);
      const uploaded = await uploadOwnPhoto(file, 0);
      setPhotoUploadProgress(100);
      setPhotoPreview(uploaded.url);
      setPhotoUploaded(true);
      setPhotoFile(null);
      setPhotoUploadError(null);
      setErrors(prev => ({ ...prev, photo: '' }));
    } catch (error) {
      if (!alreadyHadUploadedPhoto) setPhotoUploaded(false);
      const message =
        error instanceof Error ? error.message : t('onboarding.photoUploadFailedDesc');
      setPhotoUploadError(message);
      setErrors(prev => ({ ...prev, photo: message }));
      toast({
        title:
          t('onboarding.photoUploadFailed'),
        description: message,
        variant: 'destructive',
      });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0] ?? null;
    // Snapshot the File first, then clear the control so choosing the same
    // camera-roll item again always produces a new change event on iOS.
    e.currentTarget.value = '';
    if (!file) return;
    if (!isLikelyProfilePhoto(file)) {
      const message = t('onboarding.invalidFileDesc');
      setPhotoFile(null);
      setPhotoUploadError(message);
      setErrors(prev => ({ ...prev, photo: message }));
      toast({ title: t('onboarding.invalidFile'), description: message, variant: 'destructive' });
      return;
    }
    if (file.size > MAX_PROFILE_PHOTO_BYTES) {
      const message = `${t('onboarding.fileTooLarge')} (12 MB maximum).`;
      setPhotoFile(null);
      setPhotoUploadError(message);
      setErrors(prev => ({ ...prev, photo: message }));
      toast({ title: t('onboarding.fileTooLarge'), description: message, variant: 'destructive' });
      return;
    }

    setPhotoFile(file);
    setPhotoUploadError(null);
    setErrors(prev => ({ ...prev, photo: '' }));
    const reader = new FileReader();
    reader.onload = ev => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    await uploadSelectedPhoto(file);
  };

  const openPhotoPicker = () => {
    if (!fileInputRef.current || uploadingPhoto) return;
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  };

  const handleFinish = async () => {
    if (!photoUploaded) {
      toast({ title: t('onboarding.photoRequired'), description: t('onboarding.photoRequiredDesc') });
      setStep(13);
      return;
    }
    try {
      const relocationOpenness = triStatePreference(formData.relocation);
      const longDistanceOpenness = triStatePreference(formData.longDistance);

      const minAge = parseInt(formData.minAge, 10);
      const maxAge = parseInt(formData.maxAge, 10);

      await upsertOwnProfile({
        display_name: formData.name.trim(),
        age: parseInt(formData.age),
        bio: formData.bio.trim(),
        language: formData.primaryLanguage,
        country: formData.country.trim(),
        city: formData.city?.trim() || null,
        gender: formData.gender,
        interested_in: formData.lookingFor,
        learning_languages: learningLanguages,
        relationship_goal: formData.relationshipGoal,
        interests,
        cultural_interests: culturalGoals,
        countries_of_interest: preferredCountries,
        relocation_openness: relocationOpenness,
        long_distance: longDistanceOpenness,
        ...(Number.isNaN(minAge) ? {} : { preferred_min_age: minAge }),
        ...(Number.isNaN(maxAge) ? {} : { preferred_max_age: maxAge }),
      });

      if (userId) {
        localStorage.removeItem(`los_onboarding_draft_v2_${userId}`);
      }

      await queryClient.invalidateQueries();
      toast({ title: t('onboarding.welcome') });
      setLocation('/discover');
    } catch (error: any) {
      toast({ title: t('onboarding.savingError'), description: error.message, variant: 'destructive' });
    }
  };

  const Chip = ({ val, label, selected, onClick }: { val: string; label?: string; selected: boolean; onClick: () => void }) => (
    <button
      key={val}
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full border text-sm transition-all font-medium ${
        selected
          ? 'bg-primary/20 border-primary text-primary'
          : 'border-border bg-card/45 text-foreground/75 hover:border-primary/45 hover:text-foreground'
      }`}
    >
      {selected && <span className="mr-1">✓</span>}{label ?? val}
    </button>
  );

  const ChoiceCard = ({
    selected,
    onClick,
    icon: Icon,
    label,
  }: {
    selected: boolean;
    onClick: () => void;
    icon?: React.ElementType;
    label: string;
  }) => {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`glass rounded-2xl p-4 flex items-center gap-4 cursor-pointer transition-all w-full text-left ${
          selected ? 'border border-primary/60 glow-pink bg-primary/10' : 'border border-border/70 hover:border-primary/40'
        }`}
      >
        {Icon && (
          <div className="glass w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0">
            <Icon className="w-5 h-5 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-foreground font-medium text-base">{label}</div>
        </div>
        <div className={`w-6 h-6 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors ${selected ? 'border-primary bg-primary' : 'border-border'}`}>
          {selected && <Check className="w-4 h-4 text-primary-foreground" />}
        </div>
      </button>
    );
  };

  const renderStep = () => {
    switch (step) {
      // STEP 1 — Name & Age
      case 1: return (
        <div className="space-y-6">
          <div>
            <h2 className="font-serif text-foreground text-3xl font-bold mb-2">{t('onboarding.identityTitle')}</h2>
            <p className="text-muted-foreground text-base mb-6">{t('onboarding.identitySubtitle')}</p>
          </div>
          <div>
            <label className="text-foreground/80 text-sm font-medium mb-2 block">{t('onboarding.nameLabel')}</label>
            <input
              type="text"
              value={formData.name}
              onChange={e => set('name', e.target.value)}
              placeholder={t('onboarding.namePlaceholder')}
              className="glass-input w-full rounded-2xl px-4 py-4 text-foreground text-base placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-colors"
            />
            {errors.name && <p className="text-destructive text-sm font-medium mt-2">{errors.name}</p>}
          </div>
          <div>
            <label className="text-foreground/80 text-sm font-medium mb-2 block">{t('onboarding.ageLabel')}</label>
            <input
              type="number"
              min={18}
              max={120}
              value={formData.age}
              onChange={e => set('age', e.target.value)}
              placeholder={t('onboarding.agePlaceholder')}
              className="glass-input w-full rounded-2xl px-4 py-4 text-foreground text-base placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-colors"
            />
            {errors.age && <p className="text-destructive text-sm font-medium mt-2">{errors.age}</p>}
          </div>
        </div>
      );

      // STEP 2 — Gender
      case 2: return (
        <div className="space-y-6">
          <div>
            <h2 className="font-serif text-foreground text-3xl font-bold mb-6">{t('onboarding.genderTitle')}</h2>
          </div>
          <div className="flex flex-col gap-3">
            {GENDER_OPTIONS.map(g => (
              <ChoiceCard key={g.value} selected={formData.gender === g.value} onClick={() => set('gender', g.value)} label={t(g.labelKey)} />
            ))}
            {errors.gender && <p className="text-destructive text-sm font-medium mt-2">{errors.gender}</p>}
          </div>
        </div>
      );

      // STEP 3 — Looking For
      case 3: return (
        <div className="space-y-6">
          <div>
            <h2 className="font-serif text-foreground text-3xl font-bold mb-2">{t('onboarding.interestedInTitle')}</h2>
            <p className="text-muted-foreground text-base mb-6">{t('onboarding.interestedInSubtitle')}</p>
          </div>
          <div className="flex flex-col gap-3">
            {LOOKING_FOR_OPTIONS.map(opt => (
              <ChoiceCard
                key={opt.value}
                selected={formData.lookingFor === opt.value}
                onClick={() => set('lookingFor', opt.value)}
                label={t(opt.labelKey)}
              />
            ))}
            {errors.lookingFor && <p className="text-destructive text-sm font-medium mt-1">{errors.lookingFor}</p>}
          </div>
          <div className="pt-4 border-t border-border/80">
            <label className="text-foreground/80 text-sm font-medium mb-3 block">{t('onboarding.agePreference')}</label>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-muted-foreground text-xs mb-1 block">{t('onboarding.minAge')}</label>
                <input
                  type="number"
                  min={18}
                  max={120}
                  value={formData.minAge}
                  onChange={e => set('minAge', e.target.value)}
                  className="glass-input w-full rounded-2xl px-4 py-3 text-foreground text-base placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-colors"
                />
              </div>
              <div className="flex-1">
                <label className="text-muted-foreground text-xs mb-1 block">{t('onboarding.maxAge')}</label>
                <input
                  type="number"
                  min={18}
                  max={120}
                  value={formData.maxAge}
                  onChange={e => set('maxAge', e.target.value)}
                  className="glass-input w-full rounded-2xl px-4 py-3 text-foreground text-base placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-colors"
                />
              </div>
            </div>
          </div>
        </div>
      );

      // STEP 4 — Location
      case 4: return (
        <div className="space-y-6">
          <div>
            <h2 className="font-serif text-foreground text-3xl font-bold mb-2">{t('onboarding.locationTitle')}</h2>
            <p className="text-muted-foreground text-base mb-6">{t('onboarding.locationSubtitle')}</p>
          </div>
          <div>
            <label className="text-foreground/80 text-sm font-medium mb-2 block">{t('onboarding.country')}</label>
            <input
              type="text"
              value={formData.country}
              onChange={e => set('country', e.target.value)}
              placeholder={t('onboarding.countryPlaceholder')}
              className="glass-input w-full rounded-2xl px-4 py-4 text-foreground text-base placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-colors"
            />
            {errors.country && <p className="text-destructive text-sm font-medium mt-2">{errors.country}</p>}
          </div>
          <div>
            <label className="text-foreground/80 text-sm font-medium mb-2 block">
              {t('onboarding.cityLabel')} <span className="text-muted-foreground font-normal">({t('common.optional')})</span>
            </label>
            <input
              type="text"
              value={formData.city}
              onChange={e => set('city', e.target.value)}
              placeholder={t('onboarding.cityPlaceholder')}
              className="glass-input w-full rounded-2xl px-4 py-4 text-foreground text-base placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-colors"
            />
          </div>
        </div>
      );

      // STEP 5 — Native Language
      case 5: return (
        <div className="space-y-6">
          <div>
            <h2 className="font-serif text-foreground text-3xl font-bold mb-2">{t('onboarding.nativeLangTitle')}</h2>
            <p className="text-muted-foreground text-base mb-6">{t('onboarding.nativeLangSubtitle')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {LANGUAGE_OPTIONS.map(lang => (
              <Chip
                key={lang}
                val={lang}
                selected={formData.primaryLanguage === lang}
                onClick={() => set('primaryLanguage', lang)}
              />
            ))}
          </div>
          {errors.primaryLanguage && <p className="text-destructive text-sm font-medium mt-2">{errors.primaryLanguage}</p>}
        </div>
      );

      // STEP 6 — Target Language
      case 6: return (
        <div className="space-y-6">
          <div>
            <h2 className="font-serif text-foreground text-3xl font-bold mb-2">{t('onboarding.targetLangTitle')}</h2>
            <p className="text-muted-foreground text-base mb-6">{t('onboarding.targetLangSubtitle')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {LANGUAGE_OPTIONS.filter(l => l !== formData.primaryLanguage).map(lang => (
              <Chip
                key={lang}
                val={lang}
                selected={learningLanguages.includes(lang)}
                onClick={() => toggleLearningLanguage(lang)}
              />
            ))}
          </div>
          <p className="text-muted-foreground text-xs">{t('onboarding.langSelected', { count: learningLanguages.length })}</p>
          {errors.otherLanguages && <p className="text-destructive text-sm font-medium mt-1">{errors.otherLanguages}</p>}
        </div>
      );

      // STEP 7 — Countries of Interest
      case 7: return (
        <div className="space-y-6">
          <div>
            <h2 className="font-serif text-foreground text-3xl font-bold mb-2">{t('onboarding.countriesTitle')}</h2>
            <p className="text-muted-foreground text-base mb-6">{t('onboarding.countriesSubtitle')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {COUNTRY_OPTIONS.map(c => (
              <Chip
                key={c}
                val={c}
                selected={preferredCountries.includes(c)}
                onClick={() => toggleCountry(c)}
              />
            ))}
          </div>
        </div>
      );

      // STEP 8 — Cultural Interests
      case 8: return (
        <div className="space-y-6">
          <div>
            <h2 className="font-serif text-foreground text-3xl font-bold mb-2">{t('onboarding.culturalConnTitle')}</h2>
            <p className="text-muted-foreground text-base mb-6">{t('onboarding.culturalConnSubtitle')}</p>
          </div>
          <div className="flex flex-col gap-3">
            {CULTURAL_GOALS.map(goal => (
              <ChoiceCard
                key={goal.value}
                selected={culturalGoals.includes(goal.value)}
                onClick={() => toggleCulturalGoal(goal.value)}
                icon={goal.icon}
                label={t(goal.labelKey)}
              />
            ))}
          </div>
        </div>
      );

      // STEP 9 — Relationship Goals
      case 9: return (
        <div className="space-y-6">
          <div>
            <h2 className="font-serif text-foreground text-3xl font-bold mb-2">{t('onboarding.goalsTitle')}</h2>
            <p className="text-muted-foreground text-base mb-6">{t('onboarding.goalsSubtitle')}</p>
          </div>
          <div className="flex flex-col gap-3">
            {GOAL_OPTIONS.map(g => (
              <ChoiceCard
                key={g.value}
                selected={formData.relationshipGoal === g.value}
                onClick={() => set('relationshipGoal', g.value)}
                icon={g.icon}
                label={t(g.labelKey)}
              />
            ))}
            {errors.relationshipGoal && <p className="text-destructive text-sm font-medium mt-1">{errors.relationshipGoal}</p>}
          </div>
        </div>
      );

      // STEP 10 — Relocation
      case 10: return (
        <div className="space-y-6">
          <div>
            <h2 className="font-serif text-foreground text-3xl font-bold mb-2">{t('onboarding.relocationTitle')}</h2>
            <p className="text-muted-foreground text-base mb-6">{t('onboarding.relocationSubtitle')}</p>
          </div>
          <div className="flex flex-col gap-3">
            {RELOCATION_OPTIONS.map(opt => (
              <ChoiceCard
                key={opt.value}
                selected={formData.relocation === opt.value}
                onClick={() => set('relocation', opt.value)}
                label={t(opt.labelKey)}
              />
            ))}
            {errors.relocation && <p className="text-destructive text-sm font-medium mt-1">{errors.relocation}</p>}
          </div>
        </div>
      );

      // STEP 11 — Long Distance
      case 11: return (
        <div className="space-y-6">
          <div>
            <h2 className="font-serif text-foreground text-3xl font-bold mb-2">{t('onboarding.longDistanceTitle')}</h2>
            <p className="text-muted-foreground text-base mb-6">{t('onboarding.longDistanceSubtitle')}</p>
          </div>
          <div className="flex flex-col gap-3">
            {LONG_DISTANCE_OPTIONS.map(opt => (
              <ChoiceCard
                key={opt.value}
                selected={formData.longDistance === opt.value}
                onClick={() => set('longDistance', opt.value)}
                label={t(opt.labelKey)}
              />
            ))}
            {errors.longDistance && <p className="text-destructive text-sm font-medium mt-1">{errors.longDistance}</p>}
          </div>
        </div>
      );

      // STEP 12 — Bio + Interests
      case 12: return (
        <div className="space-y-6">
          <div>
            <h2 className="font-serif text-foreground text-3xl font-bold mb-2">{t('onboarding.bioInterestsTitle')}</h2>
            <p className="text-muted-foreground text-base mb-6">{t('onboarding.bioInterestsSubtitle')}</p>
          </div>
          <div>
            <label className="text-foreground/80 text-sm font-medium mb-3 block">{t('onboarding.interestsLabel')}</label>
            <div className="flex flex-wrap gap-2 mb-6">
              {INTERESTS_OPTIONS.map(i => (
                <Chip key={i} val={i} selected={interests.includes(i)} onClick={() => toggleInterest(i)} />
              ))}
            </div>
          </div>
          <div>
            <label className="text-foreground/80 text-sm font-medium mb-2 block">{t('onboarding.bioLabel')}</label>
            <textarea
              value={formData.bio}
              onChange={e => set('bio', e.target.value)}
              placeholder={t('onboarding.bioPlaceholder')}
              rows={4}
              className="glass-input w-full rounded-2xl px-4 py-4 text-foreground text-base placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-colors resize-none"
            />
            <p className="text-muted-foreground text-xs mt-2 text-right">{formData.bio.length} / 500</p>
            {errors.bio && <p className="text-destructive text-sm font-medium mt-1">{errors.bio}</p>}
          </div>
        </div>
      );

      // STEP 13 — Photo
      case 13: return (
        <div className="space-y-6">
          <div>
            <h2 className="font-serif text-foreground text-3xl font-bold mb-2">{t('onboarding.photoTitle')}</h2>
            <p className="text-muted-foreground text-base mb-6">{t('onboarding.photoSubtitle')}</p>
          </div>
          <div className="flex flex-col items-center">
            <div className="relative w-48 h-48 rounded-full border-4 border-border overflow-hidden bg-muted/60 flex items-center justify-center mb-6">
              {photoPreview ? (
                <img src={resolveMediaUrl(photoPreview)} alt="Preview" className="w-full h-full object-cover" />
              ) : (
                <Camera className="w-12 h-12 text-muted-foreground" />
              )}
              {uploadingPhoto && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-sm">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                </div>
              )}
              {photoUploaded && (
                <div className="absolute bottom-4 right-4 bg-green-500 w-8 h-8 rounded-full flex items-center justify-center border-2 border-white shadow-lg">
                  <Check className="w-5 h-5 text-foreground" />
                </div>
              )}
            </div>

            <input
              id="onboarding-profile-photo"
              type="file"
              name="photo"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
              className="sr-only"
              ref={fileInputRef}
              onChange={handlePhotoChange}
              aria-describedby="onboarding-photo-feedback"
            />
            <button
              type="button"
              onClick={openPhotoPicker}
              disabled={uploadingPhoto}
              className="px-8 py-3 rounded-full bg-muted/80 hover:bg-muted text-foreground font-medium transition-colors border border-border flex items-center gap-2 disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none disabled:cursor-not-allowed"
            >
              <Upload className="w-4 h-4" />
              {photoUploaded ? t('onboarding.changePhoto') : t('onboarding.uploadPhoto')}
            </button>
            <div id="onboarding-photo-feedback" className="w-full text-center" aria-live="polite">
              {uploadingPhoto && (
                <p role="status" className="text-muted-foreground text-sm font-medium mt-4">
                  {t('onboarding.uploading')} {photoUploadProgress}%
                </p>
              )}
              {photoUploadError && !uploadingPhoto && (
                <div role="alert" className="mt-4">
                  <p className="text-destructive text-sm font-medium">{photoUploadError}</p>
                  {photoFile && !photoUploaded && (
                    <button
                      type="button"
                      onClick={() => void uploadSelectedPhoto(photoFile)}
                      className="mt-3 px-5 py-2 rounded-full border border-destructive/40 text-destructive text-sm font-semibold hover:bg-destructive/10"
                    >
                      {t('common.retry')}
                    </button>
                  )}
                </div>
              )}
              {!photoUploadError && errors.photo && (
                <p role="alert" className="text-destructive text-sm font-medium mt-4">{errors.photo}</p>
              )}
            </div>
          </div>
        </div>
      );

      // STEP 14 — Completion
      case 14: return (
        <div className="space-y-8 flex flex-col items-center justify-center text-center h-full min-h-[50vh]">
          <div className="w-24 h-24 rounded-full bg-primary/20 flex items-center justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center shadow-lg glow-pink">
              <Check className="w-8 h-8 text-primary-foreground" />
            </div>
          </div>
          <div>
            <h2 className="font-serif text-foreground text-4xl font-bold mb-4">{t('onboarding.allSetTitle')}</h2>
            <p className="text-muted-foreground text-lg mb-8 max-w-[280px] mx-auto">
              {t('onboarding.allSetSubtitle')}
            </p>
          </div>
          <button
            onClick={handleFinish}
            className="w-full py-4 rounded-2xl text-primary-foreground font-semibold text-lg btn-glow"
          >
            {t('onboarding.startDiscovering')}
          </button>
        </div>
      );

      default: return null;
    }
  };

  if (!initialized) {
    if (hydrationError) {
      return (
        <div className="min-h-[100dvh] bg-background relative flex flex-col text-foreground items-center justify-center gap-4 px-6 text-center" role="alert">
          <p className="font-medium">Couldn't load your saved profile</p>
          <p className="text-sm text-muted-foreground">Your saved answers were not changed. Check your connection and try again.</p>
          <button
            type="button"
            className="btn-glow rounded-full px-6 py-2.5"
            onClick={() => setHydrationAttempt((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      );
    }
    return (
      <div className="min-h-[100dvh] bg-background relative flex flex-col text-foreground items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary relative z-10" />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background relative flex flex-col text-foreground">
      <div className="starfield" />

      {/* Header */}
      <header className="px-6 pb-4 pt-[max(1rem,env(safe-area-inset-top))] flex items-center justify-between relative z-30 glass-strong sticky top-0">
        <div className="flex items-center gap-3">
          {step > 1 && step < 14 && (
            <button onClick={handleBack} className="p-2 -ml-2 rounded-full text-foreground hover:bg-muted/70 transition-colors">
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}
          <div className="font-serif bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent font-bold text-xl tracking-tight">LandOverSEA</div>
        </div>
        {step < 14 && (
          <div className="text-muted-foreground text-sm font-medium">
            {step} / {TOTAL_STEPS}
          </div>
        )}
      </header>

      {/* Progress */}
      {step < 14 && (
        <div className="w-full h-1 bg-border/70 z-20 relative">
          <div
            className="h-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col max-w-md w-full mx-auto px-6 pt-6 pb-[calc(10rem+env(safe-area-inset-bottom))] md:pb-28 relative z-10">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="flex-1 flex flex-col"
          >
            {renderStep()}
          </motion.div>
        </AnimatePresence>

        {/* Footer Actions */}
        {step < 14 && (
          <div className="fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 w-full max-w-md mx-auto px-6">
            <button
              type="button"
              onClick={handleNext}
              disabled={step === 13 && (!photoUploaded || uploadingPhoto)}
              className="w-full py-4 rounded-2xl text-primary-foreground font-semibold text-lg btn-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none disabled:cursor-not-allowed disabled:shadow-none"
            >
              {t('common.continue')}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

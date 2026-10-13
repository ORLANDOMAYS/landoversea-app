import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, Text, Alert, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  FORM_ACTION_KEYBOARD_OFFSET,
  KeyboardAwareScrollViewCompat,
} from '@/components/KeyboardAwareScrollViewCompat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useI18n, type TranslationKey } from '@/i18n';
import { useAuth } from '@/lib/AuthProvider';
import { useLiveMyProfile, useLivePhotoMutations, useLiveUpdateProfile } from '@/lib/liveSupabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '@/components/ui/GlassCard';
import { AuthenticatedProfileImage } from '@/components/AuthenticatedProfileImage';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { LocationAutocomplete } from '@/components/ui/LocationAutocomplete';
import {
  findCountryOption,
  findLocationOption,
  getCountryOptions,
  getSubdivisionOptions,
  type LocationOption,
} from '@/lib/location-data';

const TOTAL_STEPS = 14;
const MAX_PROFILE_PHOTO_BYTES = 12 * 1024 * 1024;

class PhotoUploadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function inferPhotoMime(fileName: string | null | undefined): string {
  const extension = fileName?.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'heic') return 'image/heic';
  if (extension === 'heif') return 'image/heif';
  return 'application/octet-stream';
}

const GENDER_OPTIONS = ["male", "female", "non_binary", "transgender", "prefer_not_to_say", "other"];
const LOOKING_FOR_OPTIONS = ["male", "female", "non_binary", "everyone"];
const GOAL_OPTIONS = ["serious", "casual", "friendship", "language_exchange", "networking", "open"];
const LANGUAGE_OPTIONS = [
  "English", "Mandarin", "Spanish", "French", "Japanese", "Korean", "Portuguese", "Arabic",
  "Hindi", "German", "Italian", "Russian", "Thai", "Vietnamese", "Indonesian", "Malay",
  "Turkish", "Dutch", "Polish", "Swedish", "Tagalog", "Swahili",
];
const COUNTRY_OPTIONS = [
  "Japan", "Korea", "France", "Brazil", "India", "Mexico", "Nigeria", "Italy", "China",
  "Spain", "UK", "Australia", "Germany", "Morocco", "Colombia", "Ethiopia", "Turkey",
  "Indonesia", "Philippines", "Egypt",
];
const INTERESTS_OPTIONS = [
  "Travel", "Languages", "Cooking", "Music", "Art", "Hiking", "Photography", "Movies",
  "Reading", "Yoga", "Dancing", "Gaming", "Fashion", "Sports", "Coffee", "Wine",
  "Tea Ceremonies", "Meditation", "Surfing", "Cycling", "Festivals", "History",
  "Architecture", "Street Food", "Anime", "K-pop", "Jazz", "Classical Music",
  "Volunteering", "Entrepreneurship",
];
const CULTURAL_GOALS = ["language_exchange", "romance", "friendship", "travel", "professional", "learning"];
const DRAFT_VERSION = 1;
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const DEFAULT_FORM_DATA = {
  name: '', age: '', bio: '', primaryLanguage: 'English', country: '', city: '',
  gender: '', lookingFor: '', relationshipGoal: '', relocation: '', longDistance: '',
  minAge: '18', maxAge: '60',
};

interface OnboardingDraft {
  version: number;
  userId: string;
  updatedAt: number;
  savedAt?: number;
  baseServerUpdatedAt?: string | null;
  step: number;
  formData: Partial<typeof DEFAULT_FORM_DATA>;
  learningLanguages: string[];
  interests: string[];
  culturalGoals: string[];
  preferredCountries: string[];
}

function canonicalGender(value: string | null | undefined): string {
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

const DISPLAY_LABEL_KEYS = {
  English: 'mobile.languageEnglish', Mandarin: 'mobile.languageMandarin', Spanish: 'mobile.languageSpanish',
  French: 'mobile.languageFrench', Japanese: 'mobile.languageJapanese', Korean: 'mobile.languageKorean',
  Portuguese: 'mobile.languagePortuguese', Arabic: 'mobile.languageArabic', Hindi: 'mobile.languageHindi',
  German: 'mobile.languageGerman', Italian: 'mobile.languageItalian', Russian: 'mobile.languageRussian',
  Thai: 'mobile.languageThai', Vietnamese: 'mobile.languageVietnamese', Indonesian: 'mobile.languageIndonesian',
  Malay: 'mobile.languageMalay', Turkish: 'mobile.languageTurkish', Dutch: 'mobile.languageDutch',
  Polish: 'mobile.languagePolish', Swedish: 'mobile.languageSwedish', Tagalog: 'mobile.languageTagalog',
  Swahili: 'mobile.languageSwahili',
  Japan: 'mobile.countryJapan', Korea: 'mobile.countryKorea', France: 'mobile.countryFrance',
  Brazil: 'mobile.countryBrazil', India: 'mobile.countryIndia', Mexico: 'mobile.countryMexico',
  Nigeria: 'mobile.countryNigeria', Italy: 'mobile.countryItaly', China: 'mobile.countryChina',
  Spain: 'mobile.countrySpain', UK: 'mobile.countryUK', Australia: 'mobile.countryAustralia',
  Germany: 'mobile.countryGermany', Morocco: 'mobile.countryMorocco', Colombia: 'mobile.countryColombia',
  Ethiopia: 'mobile.countryEthiopia', Turkey: 'mobile.countryTurkey', Indonesia: 'mobile.countryIndonesia',
  Philippines: 'mobile.countryPhilippines', Egypt: 'mobile.countryEgypt',
  Travel: 'mobile.optionTravel', Languages: 'mobile.interestLanguages', Cooking: 'mobile.interestCooking',
  Music: 'mobile.interestMusic', Art: 'mobile.interestArt', Hiking: 'mobile.interestHiking',
  Photography: 'mobile.interestPhotography', Movies: 'mobile.interestMovies', Reading: 'mobile.interestReading',
  Yoga: 'mobile.interestYoga', Dancing: 'mobile.interestDancing', Gaming: 'mobile.interestGaming',
  Fashion: 'mobile.interestFashion', Sports: 'mobile.interestSports', Coffee: 'mobile.interestCoffee',
  Wine: 'mobile.interestWine', 'Tea Ceremonies': 'mobile.interestTeaCeremonies',
  Meditation: 'mobile.interestMeditation', Surfing: 'mobile.interestSurfing', Cycling: 'mobile.interestCycling',
  Festivals: 'mobile.interestFestivals', History: 'mobile.interestHistory',
  Architecture: 'mobile.interestArchitecture', 'Street Food': 'mobile.interestStreetFood',
  Anime: 'mobile.interestAnime', 'K-pop': 'mobile.interestKPop', Jazz: 'mobile.interestJazz',
  'Classical Music': 'mobile.interestClassicalMusic', Volunteering: 'mobile.interestVolunteering',
  Entrepreneurship: 'mobile.interestEntrepreneurship',
} as const;

export default function OnboardingScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();

  const { user } = useAuth();
  const profileQuery = useLiveMyProfile();
  const updateProfile = useLiveUpdateProfile();
  const { upload: uploadProfilePhoto } = useLivePhotoMutations();
  const userId = user?.id;
  const hydratedUserRef = useRef<string | null>(null);
  const baseServerUpdatedAtRef = useRef<string | null>(null);
  const identityGenerationRef = useRef(0);
  const draftWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const latestDraftRef = useRef<OnboardingDraft | null>(null);

  const [step, setStep] = useState(1);
  const [initialized, setInitialized] = useState(false);
  const [draftSaveError, setDraftSaveError] = useState(false);
  const [formData, setFormData] = useState({ ...DEFAULT_FORM_DATA });
  const [learningLanguages, setLearningLanguages] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [culturalGoals, setCulturalGoals] = useState<string[]>([]);
  const [preferredCountries, setPreferredCountries] = useState<string[]>([]);
  const [localPhotoPreview, setLocalPhotoPreview] = useState<string | null>(null);
  const [confirmedPhotoUrl, setConfirmedPhotoUrl] = useState<string | null>(null);
  const [retryPhotoAsset, setRetryPhotoAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoUploadProgress, setPhotoUploadProgress] = useState(0);
  const [photoUploadError, setPhotoUploadError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<TranslationKey | null>(null);
  const [countryQuery, setCountryQuery] = useState('');
  const [selectedCountryCode, setSelectedCountryCode] = useState<string | null>(null);
  const [subdivisionQuery, setSubdivisionQuery] = useState('');
  const [selectedSubdivisionCode, setSelectedSubdivisionCode] = useState<string | null>(null);
  const countryOptions = useMemo(() => getCountryOptions(locale), [locale]);
  const subdivisionOptions = useMemo(
    () => selectedCountryCode
      ? getSubdivisionOptions(selectedCountryCode, locale)
      : [],
    [locale, selectedCountryCode],
  );
  const serverPhoto = profileQuery.data?.photos
    ?.slice()
    .sort((a: { position: number }, b: { position: number }) => a.position - b.position)[0];
  const photoPreview = localPhotoPreview ?? confirmedPhotoUrl ?? serverPhoto?.url ?? null;
  const photoUploaded = Boolean(confirmedPhotoUrl || serverPhoto);

  useEffect(() => {
    if (userId === hydratedUserRef.current) return;
    identityGenerationRef.current += 1;
    hydratedUserRef.current = null;
    baseServerUpdatedAtRef.current = null;
    latestDraftRef.current = null;
    setInitialized(false);
    setDraftSaveError(false);
    setStep(1);
    setFormData({ ...DEFAULT_FORM_DATA });
    setLearningLanguages([]);
    setInterests([]);
    setCulturalGoals([]);
    setPreferredCountries([]);
    setCountryQuery('');
    setSelectedCountryCode(null);
    setSubdivisionQuery('');
    setSelectedSubdivisionCode(null);
  }, [userId]);

  useEffect(() => {
    if (!userId || profileQuery.isLoading || hydratedUserRef.current === userId) return;
    let cancelled = false;
    const expectedGeneration = identityGenerationRef.current;
    const hydrate = async () => {
      let draft: OnboardingDraft | null = null;
      try {
        const draftStr = await AsyncStorage.getItem(`los_onboarding_${userId}`);
        if (draftStr) {
          const parsed = JSON.parse(draftStr);
          const localUpdatedAt = parsed.updatedAt ?? parsed.savedAt;
          if (parsed.version === DRAFT_VERSION && parsed.userId === userId && typeof localUpdatedAt === 'number' && Date.now() - localUpdatedAt < DRAFT_MAX_AGE_MS) {
            draft = { ...parsed, updatedAt: localUpdatedAt };
          }
        }
      } catch {
        if (identityGenerationRef.current === expectedGeneration) setDraftSaveError(true);
      }
      const profile = profileQuery.data;
      if (cancelled || identityGenerationRef.current !== expectedGeneration) return;
      const serverVersion = profile?.updatedAt ?? null;
      baseServerUpdatedAtRef.current = serverVersion;
      const draftHasBaseVersion = draft
        ? Object.prototype.hasOwnProperty.call(draft, 'baseServerUpdatedAt')
        : false;
      if (draft && (draftHasBaseVersion
        ? draft.baseServerUpdatedAt !== serverVersion
        : serverVersion !== null)) draft = null;
      const d = draft?.formData ?? {};
      const has = (value: unknown) => value !== undefined && value !== null && value !== '';
      const draftHas = (field: keyof typeof DEFAULT_FORM_DATA) =>
        Object.prototype.hasOwnProperty.call(d, field);
      const hydratedFormData = {
        name: has(d.name) ? d.name : (profile?.name ?? user?.user_metadata?.display_name ?? ''),
        age: has(d.age) ? (d.age ?? '') : (profile?.age != null ? String(profile.age) : ''),
        bio: draftHas('bio') ? (d.bio ?? '') : (profile?.bio ?? ''),
        primaryLanguage: has(d.primaryLanguage) ? d.primaryLanguage : (profile?.language ?? 'English'),
        country: has(d.country) ? d.country : (profile?.country ?? ''),
        city: draftHas('city') ? (d.city ?? '') : (profile?.city ?? ''),
        gender: has(d.gender) ? canonicalGender(d.gender) : canonicalGender(profile?.gender),
        lookingFor: has(d.lookingFor) ? canonicalGender(d.lookingFor) : canonicalGender(profile?.interested_in),
        relationshipGoal: has(d.relationshipGoal) ? d.relationshipGoal : (profile?.relationshipGoal ?? ''),
        relocation: has(d.relocation) ? (d.relocation ?? '') : preferenceFormValue(profile?.relocationOpenness),
        longDistance: has(d.longDistance) ? (d.longDistance ?? '') : preferenceFormValue(profile?.longDistance),
        minAge: has(d.minAge) ? (d.minAge ?? '18') : (profile?.preferredMinAge != null ? String(profile.preferredMinAge) : '18'),
        maxAge: has(d.maxAge) ? (d.maxAge ?? '60') : (profile?.preferredMaxAge != null ? String(profile.preferredMaxAge) : '60'),
      };
      const country = findCountryOption(countryOptions, hydratedFormData.country);
      const subdivisions = country ? getSubdivisionOptions(country.code, locale) : [];
      const subdivision = findLocationOption(subdivisions, hydratedFormData.city);
      setFormData({
        ...hydratedFormData,
        country: country?.canonicalName ?? '',
        city: subdivisions.length > 0
          ? (subdivision?.canonicalName ?? '')
          : hydratedFormData.city,
      });
      setCountryQuery(country?.name ?? hydratedFormData.country);
      setSelectedCountryCode(country?.code ?? null);
      setSubdivisionQuery(subdivision?.name ?? hydratedFormData.city);
      setSelectedSubdivisionCode(subdivision?.code ?? null);
      setLearningLanguages(draft?.learningLanguages ?? profile?.learningLanguages ?? []);
      setInterests(draft?.interests ?? profile?.interests ?? []);
      setCulturalGoals(draft?.culturalGoals ?? profile?.culturalInterests ?? []);
      setPreferredCountries(draft?.preferredCountries ?? profile?.countriesOfInterest ?? []);
      if (draft?.step) setStep(draft.step >= 1 && draft.step <= TOTAL_STEPS ? draft.step : 1);
      hydratedUserRef.current = userId;
      setInitialized(true);
    };
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [countryOptions, locale, profileQuery.data, profileQuery.isLoading, user, userId]);

  useEffect(() => {
    if (!initialized) return;
    if (selectedCountryCode) {
      const selectedCountry = countryOptions.find(option => option.code === selectedCountryCode);
      if (selectedCountry) setCountryQuery(selectedCountry.name);
    }
    if (selectedSubdivisionCode) {
      const selectedSubdivision = subdivisionOptions.find(
        option => option.code === selectedSubdivisionCode,
      );
      if (selectedSubdivision) setSubdivisionQuery(selectedSubdivision.name);
    }
  }, [
    countryOptions,
    initialized,
    selectedCountryCode,
    selectedSubdivisionCode,
    subdivisionOptions,
  ]);

  const enqueueDraftWrite = (
    draft: OnboardingDraft,
    expectedUserId: string,
    expectedGeneration: number,
  ) => {
    latestDraftRef.current = draft;
    draftWriteQueueRef.current = draftWriteQueueRef.current.then(async () => {
      if (
        identityGenerationRef.current !== expectedGeneration ||
        hydratedUserRef.current !== expectedUserId
      ) return;
      try {
        await AsyncStorage.setItem(`los_onboarding_${expectedUserId}`, JSON.stringify(draft));
        if (
          identityGenerationRef.current === expectedGeneration &&
          hydratedUserRef.current === expectedUserId
        ) setDraftSaveError(false);
      } catch {
        if (
          identityGenerationRef.current === expectedGeneration &&
          hydratedUserRef.current === expectedUserId
        ) setDraftSaveError(true);
      }
    });
  };

  useEffect(() => {
    if (!initialized || !userId || hydratedUserRef.current !== userId) return;
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
    enqueueDraftWrite(draft, userId, identityGenerationRef.current);
  }, [initialized, step, formData, learningLanguages, interests, culturalGoals, preferredCountries, userId]);

  const retryDraftSave = () => {
    if (!userId || hydratedUserRef.current !== userId || !latestDraftRef.current) return;
    enqueueDraftWrite(latestDraftRef.current, userId, identityGenerationRef.current);
  };

  const set = (k: string, v: string) => {
    setValidationError(null);
    setFormData(p => ({ ...p, [k]: v }));
  };
  const handleCountryQueryChange = (value: string) => {
    setValidationError(null);
    setCountryQuery(value);
    setSelectedCountryCode(null);
    setSubdivisionQuery('');
    setSelectedSubdivisionCode(null);
    setFormData(previous => ({ ...previous, country: '', city: '' }));
  };
  const handleCountrySelect = (option: LocationOption) => {
    setValidationError(null);
    setCountryQuery(option.name);
    setSelectedCountryCode(option.code);
    setSubdivisionQuery('');
    setSelectedSubdivisionCode(null);
    setFormData(previous => ({
      ...previous,
      country: option.canonicalName,
      city: '',
    }));
  };
  const handleSubdivisionQueryChange = (value: string) => {
    setValidationError(null);
    setSubdivisionQuery(value);
    setSelectedSubdivisionCode(null);
    setFormData(previous => ({ ...previous, city: '' }));
  };
  const handleSubdivisionSelect = (option: LocationOption) => {
    setValidationError(null);
    setSubdivisionQuery(option.name);
    setSelectedSubdivisionCode(option.code);
    setFormData(previous => ({ ...previous, city: option.canonicalName }));
  };
  const optionLabel = (value: string) => {
    const keys = {
      male: 'mobile.optionMan', female: 'mobile.optionWoman', non_binary: 'mobile.optionNonBinary',
      transgender: 'mobile.optionTransgender', prefer_not_to_say: 'mobile.optionPreferNot',
      other: 'mobile.optionOther', everyone: 'mobile.optionEveryone', serious: 'mobile.optionSerious',
      casual: 'mobile.optionCasual', friendship: 'mobile.optionFriendship',
      language_exchange: 'mobile.optionLanguageExchange', networking: 'mobile.optionNetworking',
      open: 'mobile.optionOpen', romance: 'mobile.optionRomance', travel: 'mobile.optionTravel',
      professional: 'mobile.optionProfessional', learning: 'mobile.optionLearning',
    } as const;
    if (value in keys) return t(keys[value as keyof typeof keys]);
    if (value in DISPLAY_LABEL_KEYS) return t(DISPLAY_LABEL_KEYS[value as keyof typeof DISPLAY_LABEL_KEYS]);
    return value;
  };
  
  const toggleLearningLanguage = (lang: string) => {
    setLearningLanguages(prev => {
      if (prev.includes(lang)) {
        setValidationError(null);
        return prev.filter(l => l !== lang);
      }
      if (prev.length >= 4) {
        setValidationError('onboarding.targetLangSubtitle');
        return prev;
      }
      setValidationError(null);
      return [...prev, lang];
    });
  };

  const errorForStep = (): TranslationKey | null => {
    const age = Number(formData.age);
    if (step === 1 && !formData.name.trim()) return 'onboarding.errName';
    if (step === 1 && !formData.age.trim()) return 'onboarding.errAge';
    if (step === 1 && (!/^\d+$/.test(formData.age.trim()) || !Number.isSafeInteger(age))) return 'onboarding.errAgeInvalid';
    if (step === 1 && age < 18) return 'onboarding.errAgeMin';
    if (step === 2 && !formData.gender) return 'onboarding.errGender';
    if (step === 3 && !formData.lookingFor) return 'onboarding.errLookingFor';
    if (step === 4 && !selectedCountryCode) return 'onboarding.errCountry';
    if (step === 4 && subdivisionQuery.trim() && !selectedSubdivisionCode) return 'onboarding.errTravel';
    if (step === 5 && !formData.primaryLanguage) return 'onboarding.errPrimaryLanguage';
    if (step === 6 && learningLanguages.length < 1) return 'onboarding.errOtherLanguages';
    if (step === 6 && learningLanguages.length > 4) return 'onboarding.targetLangSubtitle';
    if (step === 9 && !formData.relationshipGoal) return 'onboarding.errGoal';
    if (step === 10 && !formData.relocation) return 'onboarding.errRelocation';
    if (step === 11 && !formData.longDistance) return 'onboarding.errLongDistance';
    if (step === 12 && formData.bio.trim().length < 20) return 'onboarding.errBio';
    if (step === 13 && !photoUploaded) return 'onboarding.errPhoto';
    return null;
  };

  const handleNext = () => {
    const error = errorForStep();
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    if (step < TOTAL_STEPS) setStep(s => s + 1);
    else handleFinish();
  };

  const handleBack = () => {
    setValidationError(null);
    if (step > 1) setStep(s => s - 1);
  };

  const uploadPhotoAsset = async (asset: ImagePicker.ImagePickerAsset) => {
    const assetSize = asset.fileSize ?? asset.file?.size ?? 0;
    if (assetSize > MAX_PROFILE_PHOTO_BYTES) {
      const message = `${t('onboarding.fileTooLarge')} (12 MB maximum).`;
      setPhotoUploadError(message);
      setValidationError('onboarding.errPhoto');
      Alert.alert(t('onboarding.fileTooLarge'), message);
      return;
    }

    setLocalPhotoPreview(asset.uri);
    setRetryPhotoAsset(asset);
    setUploadingPhoto(true);
    setPhotoUploadProgress(0);
    setPhotoUploadError(null);
    setValidationError(null);
    try {
      const fileName = asset.fileName || asset.file?.name || 'profile-photo';
      const mimeType = asset.mimeType || asset.file?.type || inferPhotoMime(fileName);
      await uploadProfilePhoto.mutateAsync({
        data: {
          photo: {
          uri: asset.uri,
          name: fileName,
          type: mimeType,
          },
        },
      });
      setPhotoUploadProgress(1);
      setConfirmedPhotoUrl(asset.uri);
      setLocalPhotoPreview(null);
      setRetryPhotoAsset(null);
      setPhotoUploadError(null);
      setValidationError(null);
      void profileQuery.refetch();
    } catch (error) {
      const message =
        error instanceof PhotoUploadError && error.status === 413
          ? `${t('onboarding.fileTooLarge')} (12 MB maximum).`
          : t('onboarding.photoUploadFailedDesc');
      setPhotoUploadError(message);
      setValidationError('onboarding.errPhoto');
      Alert.alert(
        error instanceof PhotoUploadError && error.status === 413
          ? t('onboarding.fileTooLarge')
          : t('mobile.uploadFailed'),
        message,
      );
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handlePhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: Platform.OS !== 'web',
        aspect: [4, 5],
        quality: 0.8,
      });
      if (result.canceled || !result.assets[0]?.uri) return;
      await uploadPhotoAsset(result.assets[0]);
    } catch {
      const message = t('onboarding.photoUploadFailedDesc');
      setPhotoUploadError(message);
      setValidationError('onboarding.errPhoto');
      Alert.alert(t('mobile.uploadFailed'), message);
    }
  };

  const handleFinish = async () => {
    try {
      const age = Number(formData.age);
      const preferredMinAge = Number(formData.minAge);
      const preferredMaxAge = Number(formData.maxAge);
      await updateProfile.mutateAsync({
        data: {
          name: formData.name,
          age,
          bio: formData.bio,
          primaryLanguage: formData.primaryLanguage,
          learningLanguages,
          country: formData.country,
          city: formData.city,
          gender: formData.gender,
          lookingFor: formData.lookingFor,
          relationshipGoal: formData.relationshipGoal,
          interests,
          culturalInterests: culturalGoals,
          countriesOfInterest: preferredCountries,
          relocationOpenness: triStatePreference(formData.relocation),
          longDistanceOpenness: triStatePreference(formData.longDistance),
          preferredMinAge,
          preferredMaxAge,
        }
      });
      if (userId) {
        await draftWriteQueueRef.current;
        await AsyncStorage.removeItem(`los_onboarding_${userId}`);
      }
      await queryClient.invalidateQueries();
      router.replace('/(tabs)/discover' as any);
    } catch (e) {
      Alert.alert(t('premium.genericError'), t('mobile.saveFailed'));
    }
  };

  return (
    <KeyboardAwareScrollViewCompat
      testID="onboarding-scroll"
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.scrollContent,
        {
          paddingTop: insets.top + 20,
          paddingBottom: insets.bottom + 40,
          paddingHorizontal: 24,
        },
      ]}
      bottomOffset={FORM_ACTION_KEYBOARD_OFFSET}
      extraKeyboardSpace={16}
    >
      <View style={styles.header}>
        {step > 1 && (
          <Button variant="ghost" size="icon" onPress={handleBack} leftIcon={<Ionicons name="arrow-back" size={24} color={colors.foreground} />} style={styles.backBtn} />
        )}
        <Text style={[styles.progress, { color: colors.mutedForeground }]}>{t('onboarding.step')} {step} {t('onboarding.of')} {TOTAL_STEPS}</Text>
      </View>

      {draftSaveError && (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[styles.draftWarning, { borderColor: colors.destructive }]}
        >
          <Text style={[styles.draftWarningText, { color: colors.destructive }]}>
            {t('mobile.saveFailed')}
          </Text>
          <Button
            testID="retry-onboarding-draft"
            title={t('common.retry')}
            variant="outline"
            size="sm"
            onPress={retryDraftSave}
          />
        </View>
      )}

      <GlassCard testID={`onboarding-step-${step}`} style={styles.card}>
        {step === 1 && (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>{t('onboarding.identityTitle')}</Text>
            <Input placeholder={t('onboarding.nameLabel')} value={formData.name} onChangeText={v => set('name', v)} />
            <Input placeholder={t('onboarding.ageLabel')} keyboardType="numeric" value={formData.age} onChangeText={v => set('age', v)} />
          </>
        )}
        {step === 2 && (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>{t('onboarding.genderTitle')}</Text>
            {GENDER_OPTIONS.map(g => (
              <Button key={g} title={optionLabel(g)} variant={formData.gender === g ? 'primary' : 'outline'} onPress={() => set('gender', g)} style={{marginBottom: 12}} />
            ))}
          </>
        )}
        {step === 3 && (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>{t('onboarding.interestedInTitle')}</Text>
            {LOOKING_FOR_OPTIONS.map(g => (
              <Button key={g} title={optionLabel(g)} variant={formData.lookingFor === g ? 'primary' : 'outline'} onPress={() => set('lookingFor', g)} style={{marginBottom: 12}} />
            ))}
          </>
        )}
        {step === 4 && (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>{t('onboarding.locationTitle')}</Text>
            <LocationAutocomplete
              testIDPrefix="onboarding-country"
              placeholder={t('onboarding.countryPlaceholder')}
              accessibilityLabel={t('onboarding.country')}
              noResultsText={t('messages.noResults')}
              value={countryQuery}
              options={countryOptions}
              selectedCode={selectedCountryCode}
              onChangeText={handleCountryQueryChange}
              onSelect={handleCountrySelect}
            />
            {selectedCountryCode && subdivisionOptions.length > 0 && (
              <LocationAutocomplete
                testIDPrefix="onboarding-subdivision"
                placeholder={t('onboarding.cityPlaceholder')}
                accessibilityLabel={t('onboarding.cityLabel')}
                noResultsText={t('messages.noResults')}
                value={subdivisionQuery}
                options={subdivisionOptions}
                selectedCode={selectedSubdivisionCode}
                onChangeText={handleSubdivisionQueryChange}
                onSelect={handleSubdivisionSelect}
              />
            )}
          </>
        )}
        {step === 5 && (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>{t('onboarding.nativeLangTitle')}</Text>
            {LANGUAGE_OPTIONS.map(l => (
               <Button key={l} title={optionLabel(l)} variant={formData.primaryLanguage === l ? 'primary' : 'outline'} onPress={() => set('primaryLanguage', l)} style={{marginBottom: 12}} />
            ))}
          </>
        )}
        {step === 6 && (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>{t('onboarding.targetLangTitle')}</Text>
            <Text style={[styles.selectionCount, { color: colors.mutedForeground }]}>
              {t('onboarding.langSelected', { count: learningLanguages.length })}
            </Text>
            {LANGUAGE_OPTIONS.filter(l => l !== formData.primaryLanguage).map(l => (
               <Button key={l} title={optionLabel(l)} variant={learningLanguages.includes(l) ? 'primary' : 'outline'} onPress={() => toggleLearningLanguage(l)} style={{marginBottom: 12}} />
            ))}
          </>
        )}
        {step === 7 && (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>{t('onboarding.countriesTitle')}</Text>
            {COUNTRY_OPTIONS.map(c => (
              <Button
                key={c}
                 title={optionLabel(c)}
                variant={preferredCountries.includes(c) ? 'primary' : 'outline'}
                onPress={() => setPreferredCountries(current => current.includes(c) ? current.filter(value => value !== c) : [...current, c])}
                style={{marginBottom: 12}}
              />
            ))}
          </>
        )}
        {step === 8 && (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>{t('onboarding.culturalConnTitle')}</Text>
            {CULTURAL_GOALS.map(goal => (
              <Button
                key={goal}
                title={optionLabel(goal)}
                variant={culturalGoals.includes(goal) ? 'primary' : 'outline'}
                onPress={() => setCulturalGoals(current => current.includes(goal) ? current.filter(value => value !== goal) : [...current, goal])}
                style={{marginBottom: 12}}
              />
            ))}
            {INTERESTS_OPTIONS.map(interest => (
              <Button
                key={interest}
                 title={optionLabel(interest)}
                variant={interests.includes(interest) ? 'primary' : 'outline'}
                onPress={() => setInterests(current => current.includes(interest) ? current.filter(value => value !== interest) : [...current, interest])}
                style={{marginBottom: 12}}
              />
            ))}
          </>
        )}
        {step === 9 && (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>{t('onboarding.goalsTitle')}</Text>
            {GOAL_OPTIONS.map(g => (
              <Button key={g} title={optionLabel(g)} variant={formData.relationshipGoal === g ? 'primary' : 'outline'} onPress={() => set('relationshipGoal', g)} style={{marginBottom: 12}} />
            ))}
          </>
        )}
        {step === 10 && (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>{t('onboarding.relocationTitle')}</Text>
            {['yes', 'no', 'not_sure'].map(o => (
              <Button key={o} title={o === 'yes' ? t('mobile.optionRelocateYes') : o === 'no' ? t('mobile.optionRelocateNo') : t('mobile.optionNotSure')} variant={formData.relocation === o ? 'primary' : 'outline'} onPress={() => set('relocation', o)} style={{marginBottom: 12}} />
            ))}
          </>
        )}
        {step === 11 && (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>{t('onboarding.longDistanceTitle')}</Text>
            {['yes', 'no', 'not_sure'].map(o => (
              <Button key={o} title={o === 'yes' ? t('mobile.optionLongDistanceYes') : o === 'no' ? t('mobile.optionLongDistanceNo') : t('mobile.optionNotSure')} variant={formData.longDistance === o ? 'primary' : 'outline'} onPress={() => set('longDistance', o)} style={{marginBottom: 12}} />
            ))}
          </>
        )}
        {step === 12 && (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>{t('onboarding.bioTitle')}</Text>
            <Input placeholder={t('onboarding.bioPlaceholder')} value={formData.bio} onChangeText={v => set('bio', v)} multiline style={{height: 120}} />
          </>
        )}
        {step === 13 && (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>{t('onboarding.photoTitle')}</Text>
            <View style={styles.photoContainer}>
              {profileQuery.isLoading && !localPhotoPreview ? (
                <View
                  accessibilityLabel={t('common.loading')}
                  style={[styles.photoPlaceholder, { backgroundColor: colors.glassStrong }]}
                >
                  <Ionicons name="hourglass-outline" size={40} color={colors.mutedForeground} />
                  <Text style={[styles.photoStatus, { color: colors.mutedForeground }]}>{t('common.loading')}</Text>
                </View>
              ) : photoPreview ? (
                <AuthenticatedProfileImage
                  url={photoPreview}
                  accessibilityLabel={t('onboarding.photoTitle')}
                  style={styles.photoPreview}
                />
              ) : (
                <View style={[styles.photoPlaceholder, { backgroundColor: colors.glassStrong }]}><Ionicons name="camera" size={48} color={colors.mutedForeground} /></View>
              )}
            </View>
            {profileQuery.isError && !localPhotoPreview && (
              <View accessibilityRole="alert" style={styles.photoError}>
                <Text style={[styles.photoStatus, { color: colors.destructive }]}>{t('discover.loadErrorDesc')}</Text>
                <Button
                  title={t('common.retry')}
                  variant="outline"
                  onPress={() => void profileQuery.refetch()}
                  loading={profileQuery.isFetching}
                />
              </View>
            )}
            {uploadingPhoto && (
              <Text accessibilityRole="text" style={[styles.photoStatus, { color: colors.mutedForeground }]}>
                {t('onboarding.uploading')} {photoUploadProgress}%
              </Text>
            )}
            {photoUploadError && !uploadingPhoto && (
              <View accessibilityRole="alert" style={styles.photoError}>
                <Text style={[styles.photoStatus, { color: colors.destructive }]}>{photoUploadError}</Text>
                {retryPhotoAsset && !photoUploaded && (
                  <Button
                    title={t('common.retry')}
                    variant="outline"
                    onPress={() => void uploadPhotoAsset(retryPhotoAsset)}
                  />
                )}
              </View>
            )}
            <Button
              title={photoUploaded ? t('onboarding.changePhoto') : t('onboarding.photoUpload')}
              onPress={handlePhoto}
              loading={uploadingPhoto}
              disabled={uploadingPhoto}
              style={{marginBottom: 12}}
            />
          </>
        )}
        {step === 14 && (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>{t('onboarding.allSetTitle')}</Text>
            <Text style={{ color: colors.mutedForeground, marginBottom: 24, fontSize: 16, lineHeight: 22 }}>{t('onboarding.allSetSubtitle')}</Text>
          </>
        )}
        {validationError && (
          <Text accessibilityRole="alert" style={[styles.validationError, { color: colors.destructive }]}>
            {t(validationError)}
          </Text>
        )}
      </GlassCard>

      <View testID="onboarding-footer" style={styles.footer}>
        <Button
          testID="onboarding-next"
          title={step === TOTAL_STEPS ? t('common.finish') : t('common.next')}
          size="lg"
          onPress={handleNext}
          disabled={step === 13 && (!photoUploaded || uploadingPhoto)}
          style={{flex: 1}}
        />
      </View>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, width: '100%' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 24, flexShrink: 0 },
  backBtn: { marginRight: 16 },
  progress: { fontFamily: 'Inter_500Medium', fontSize: 14, flex: 1 },
  card: { padding: 24, marginBottom: 24, flexShrink: 0 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 28, marginBottom: 24 },
  footer: { flexDirection: 'row', marginTop: 'auto', flexShrink: 0 },
  photoContainer: { alignItems: 'center', marginBottom: 24 },
  photoPreview: { width: 200, height: 250, borderRadius: 20 },
  photoPlaceholder: { width: 200, height: 250, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  photoStatus: { fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center', marginTop: 12 },
  photoError: { alignItems: 'center', gap: 12, marginBottom: 16 },
  selectionCount: { fontFamily: 'Inter_500Medium', fontSize: 14, marginTop: -16, marginBottom: 20 },
  validationError: { fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20, marginTop: 12 },
  draftWarning: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8, marginBottom: 16 },
  draftWarningText: { fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
});

import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Text, ActivityIndicator, Dimensions, Animated, PanResponder, Alert, Pressable, RefreshControl, ScrollView, Modal, Switch } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveDiscovery, useLiveSwipe } from '@/lib/liveSupabase';
import { Button } from '@/components/ui/Button';
import { Ionicons } from '@expo/vector-icons';
import { AuthenticatedProfileImage } from '@/components/AuthenticatedProfileImage';
import { useI18n } from '@/i18n';
import { Input } from '@/components/ui/Input';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/lib/AuthProvider';

type DiscoveryGender = 'male' | 'female' | 'non_binary';

type DiscoverFiltersInput = {
  minAge?: number;
  maxAge?: number;
  gender?: DiscoveryGender | null;
  countries?: string[];
  languages?: string[];
  globalMode?: boolean;
  relationshipGoal?: string | null;
  interestsOverlap?: boolean;
  verifiedOnly?: boolean;
  longDistance?: boolean;
  relocation?: boolean;
};

const { width } = Dimensions.get('window');
const SWIPE_THRESHOLD = 120;
const GESTURE_ACTIVATION_THRESHOLD = 8;
const LEGACY_DISCOVERY_FILTERS_STORAGE_KEY = 'landoversea.discoveryFilters.v1';
const DISCOVERY_FILTERS_STORAGE_KEY_PREFIX = `${LEGACY_DISCOVERY_FILTERS_STORAGE_KEY}.user.`;

const COUNTRY_OPTIONS = [
  'United States', 'United Kingdom', 'Canada', 'Australia', 'Germany', 'France',
  'Japan', 'South Korea', 'Brazil', 'Mexico', 'Spain', 'Italy', 'Netherlands',
  'Sweden', 'Thailand', 'Singapore', 'Philippines', 'Malaysia', 'India', 'China',
  'Nigeria', 'South Africa', 'UAE',
];

const LANGUAGE_OPTIONS = [
  'English', 'Spanish', 'French', 'Mandarin', 'Portuguese', 'Arabic', 'Hindi',
  'Japanese', 'Korean', 'Italian', 'German', 'Russian', 'Dutch', 'Swedish',
  'Thai', 'Vietnamese', 'Indonesian', 'Turkish', 'Polish', 'Ukrainian',
];

const GENDER_OPTIONS = [
  { value: null, labelKey: 'filtersPage.genderEveryone' as const },
  { value: 'male', labelKey: 'filtersPage.genderMan' as const },
  { value: 'female', labelKey: 'filtersPage.genderWoman' as const },
  { value: 'non_binary', labelKey: 'filtersPage.genderNonBinary' as const },
] satisfies ReadonlyArray<{ value: DiscoveryGender | null; labelKey: string }>;

const GOAL_OPTIONS = [
  { value: 'serious', labelKey: 'onboarding.goals.serious' as const },
  { value: 'casual', labelKey: 'onboarding.goals.casual' as const },
  { value: 'friendship', labelKey: 'onboarding.goals.friendship' as const },
  { value: 'language_exchange', labelKey: 'onboarding.goals.languageExchange' as const },
  { value: 'networking', labelKey: 'onboarding.goals.networking' as const },
  { value: 'open', labelKey: 'onboarding.goals.open' as const },
];

const DEFAULT_FILTERS: DiscoverFiltersInput = {
  minAge: 18,
  maxAge: 60,
  gender: null,
  countries: [],
  languages: [],
  globalMode: false,
  relationshipGoal: null,
  interestsOverlap: false,
  verifiedOnly: false,
  longDistance: false,
  relocation: false,
};

function canonicalDiscoveryGender(value: unknown): DiscoveryGender | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'male' || normalized === 'man') return 'male';
  if (normalized === 'female' || normalized === 'woman') return 'female';
  if (normalized === 'non_binary' || normalized === 'nonbinary') return 'non_binary';
  return null;
}

function normalizeFilters(filters?: Partial<DiscoverFiltersInput>): DiscoverFiltersInput {
  return {
    ...DEFAULT_FILTERS,
    ...filters,
    gender: canonicalDiscoveryGender(filters?.gender),
    relationshipGoal: filters?.relationshipGoal ?? null,
    countries: [...(filters?.countries ?? [])],
    languages: [...(filters?.languages ?? [])],
  };
}

function parseStoredFilters(stored: string): DiscoverFiltersInput | null {
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    const isOptionalNumber = (key: string) => (
      value[key] === undefined || (typeof value[key] === 'number' && Number.isFinite(value[key]))
    );
    const isOptionalNullableString = (key: string) => (
      value[key] === undefined || value[key] === null || typeof value[key] === 'string'
    );
    const isOptionalStringArray = (key: string) => (
      value[key] === undefined
      || (Array.isArray(value[key]) && value[key].every(item => typeof item === 'string'))
    );
    const isOptionalBoolean = (key: string) => (
      value[key] === undefined || typeof value[key] === 'boolean'
    );
    if (
      !isOptionalNumber('minAge')
      || !isOptionalNumber('maxAge')
      || !isOptionalNullableString('gender')
      || !isOptionalNullableString('relationshipGoal')
      || !isOptionalStringArray('countries')
      || !isOptionalStringArray('languages')
      || !['globalMode', 'interestsOverlap', 'verifiedOnly', 'longDistance', 'relocation'].every(isOptionalBoolean)
    ) return null;
    return normalizeFilters(value as Partial<DiscoverFiltersInput>);
  } catch {
    return null;
  }
}

function discoveryFiltersStorageKey(userId: string): string {
  return `${DISCOVERY_FILTERS_STORAGE_KEY_PREFIX}${encodeURIComponent(userId)}`;
}

let legacyMigrationQueue: Promise<void> = Promise.resolve();
const accountPersistenceQueues = new Map<string, Promise<void>>();

async function runAccountPersistenceOperation<T>(
  storageKey: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = accountPersistenceQueues.get(storageKey) ?? Promise.resolve();
  const result = previous.catch(() => {
    // A failed operation must not poison this account's persistence queue.
  }).then(operation);
  const queueTail = result.then(() => undefined, () => undefined);
  accountPersistenceQueues.set(storageKey, queueTail);
  try {
    return await result;
  } finally {
    if (accountPersistenceQueues.get(storageKey) === queueTail) {
      accountPersistenceQueues.delete(storageKey);
    }
  }
}

async function loadDiscoveryFilters(storageKey: string): Promise<DiscoverFiltersInput> {
  return runAccountPersistenceOperation(storageKey, async () => {
    const stored = await AsyncStorage.getItem(storageKey);
    if (stored !== null) return parseStoredFilters(stored) ?? normalizeFilters();

    let result = normalizeFilters();
    const migration = legacyMigrationQueue.then(async () => {
      // Another account load may have completed migration while this load waited.
      const currentScopedValue = await AsyncStorage.getItem(storageKey);
      if (currentScopedValue !== null) {
        result = parseStoredFilters(currentScopedValue) ?? normalizeFilters();
        return;
      }

      const legacyValue = await AsyncStorage.getItem(LEGACY_DISCOVERY_FILTERS_STORAGE_KEY);
      if (legacyValue === null) return;

      // A malformed legacy value belongs to this migration attempt only. Persisting
      // defaults before removal prevents it from being retried by another account.
      result = parseStoredFilters(legacyValue) ?? normalizeFilters();
      await AsyncStorage.setItem(storageKey, JSON.stringify(result));
      await AsyncStorage.removeItem(LEGACY_DISCOVERY_FILTERS_STORAGE_KEY);
    });
    legacyMigrationQueue = migration.catch(() => {
      // Keep later account loads usable after an unavailable storage operation.
    });
    await migration;
    return result;
  });
}

async function persistDiscoveryFilters(
  storageKey: string,
  filters: DiscoverFiltersInput,
  canWrite: () => boolean,
): Promise<boolean> {
  return runAccountPersistenceOperation(storageKey, async () => {
    if (!canWrite()) return false;
    await AsyncStorage.setItem(storageKey, JSON.stringify(filters));
    return true;
  });
}

export default function DiscoverScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [filters, setFilters] = useState<DiscoverFiltersInput>(DEFAULT_FILTERS);
  const [filtersOwnerUserId, setFiltersOwnerUserId] = useState<string | null>(null);
  const activeFilters = userId && filtersOwnerUserId === userId ? filters : DEFAULT_FILTERS;
  const {
    data: cards,
    isLoading,
    isError,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useLiveDiscovery(activeFilters);
  const swipeMutation = useLiveSwipe();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [localFilters, setLocalFilters] = useState<DiscoverFiltersInput>(() => normalizeFilters(filters));
  const [filtersDirty, setFiltersDirty] = useState(false);
  const [isSavingFilters, setIsSavingFilters] = useState(false);
  const [filterSaveError, setFilterSaveError] = useState<string | null>(null);

  const position = useRef(new Animated.ValueXY()).current;
  const filterSessionRef = useRef(0);
  const filterLoadGenerationRef = useRef(0);
  const renderedUserIdRef = useRef(userId);
  renderedUserIdRef.current = userId;

  useEffect(() => {
    const generation = filterLoadGenerationRef.current + 1;
    filterLoadGenerationRef.current = generation;

    // Clear the previous account's presentation before starting any asynchronous read.
    const defaults = normalizeFilters();
    setFilters(defaults);
    setFiltersOwnerUserId(null);
    setLocalFilters(defaults);
    setFiltersDirty(false);
    setIsSavingFilters(false);
    setFilterSaveError(null);
    setCurrentIndex(0);
    filterSessionRef.current += 1;
    setShowFilters(false);

    if (!userId) return;

    const expectedUserId = userId;
    const storageKey = discoveryFiltersStorageKey(expectedUserId);
    void loadDiscoveryFilters(storageKey).then((loadedFilters) => {
      if (filterLoadGenerationRef.current !== generation) return;
      setFilters(loadedFilters);
      setFiltersOwnerUserId(expectedUserId);
    }).catch(() => {
      // Invalid or unavailable local storage falls back to the documented defaults.
      if (filterLoadGenerationRef.current !== generation) return;
      setFiltersOwnerUserId(expectedUserId);
    });
    return () => {
      if (filterLoadGenerationRef.current === generation) {
        filterLoadGenerationRef.current += 1;
      }
    };
  }, [userId]);

  useEffect(() => {
    if (filters && !filtersDirty) {
      setLocalFilters(normalizeFilters(activeFilters));
    }
  }, [activeFilters, filters, filtersDirty]);

  useEffect(() => {
    const remaining = (cards?.length ?? 0) - currentIndex;
    if (remaining <= 3 && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [cards?.length, currentIndex, fetchNextPage, hasNextPage, isFetchingNextPage]);

  const editFilters = (update: (current: DiscoverFiltersInput) => DiscoverFiltersInput) => {
    setLocalFilters(update);
    setFiltersDirty(true);
    setFilterSaveError(null);
  };

  const openFilters = () => {
    filterSessionRef.current += 1;
    setLocalFilters(normalizeFilters(activeFilters));
    setFiltersDirty(false);
    setFilterSaveError(null);
    setShowFilters(true);
  };

  const closeFilters = () => {
    // Invalidate this modal session so a late save cannot dismiss a newly opened sheet.
    filterSessionRef.current += 1;
    setShowFilters(false);
  };

  const handleSwipeComplete = async (action: 'like' | 'pass' | 'superlike') => {
    if (!cards || currentIndex >= cards.length || isSwiping) return;
    
    setIsSwiping(true);
    const currentCard = cards[currentIndex];
    const prevIndex = currentIndex;
    
    // Optimistic UI
    setCurrentIndex(prev => prev + 1);
    position.setValue({ x: 0, y: 0 });
    
    try {
      const result = await swipeMutation.mutateAsync({ targetUserId: currentCard.userId, action });
      if (result.isMatch && result.conversationId) {
        Alert.alert(
          t('discover.matchTitle'),
          t('discover.matchDesc', { name: currentCard.profile.name }),
          [
            { text: t('common.close'), style: 'cancel' },
            {
              text: t('discover.sayHi'),
              onPress: () => router.push(`/messages/${result.conversationId}` as any),
            },
          ],
        );
      }
    } catch (e) {
      Alert.alert(t('premium.genericError'), t('mobile.swipeFailed'));
      setCurrentIndex(prevIndex);
    } finally {
      setIsSwiping(false);
    }
  };

  const panResponder = PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gestureState) => {
        const horizontalDistance = Math.abs(gestureState.dx);
        const verticalDistance = Math.abs(gestureState.dy);
        return !isSwiping &&
          horizontalDistance > GESTURE_ACTIVATION_THRESHOLD &&
          horizontalDistance > verticalDistance * 1.25;
      },
      onPanResponderMove: (_evt, gestureState) => {
        if (isSwiping) return;
        position.setValue({ x: gestureState.dx, y: 0 });
      },
      onPanResponderRelease: (_evt, gestureState) => {
        if (isSwiping) {
          resetPosition();
          return;
        }
        if (gestureState.dx > SWIPE_THRESHOLD) {
          forceSwipe('right');
        } else if (gestureState.dx < -SWIPE_THRESHOLD) {
          forceSwipe('left');
        } else {
          resetPosition();
        }
      },
      onPanResponderTerminate: () => resetPosition(),
    });

  const forceSwipe = (direction: 'right' | 'left' | 'up') => {
    let x = 0;
    let y = 0;
    if (direction === 'right') x = width * 1.5;
    if (direction === 'left') x = -width * 1.5;
    if (direction === 'up') y = -width * 1.5;

    Animated.timing(position, {
      toValue: { x, y },
      duration: 250,
      useNativeDriver: false
    }).start(() => {
      const action = direction === 'right' ? 'like' : direction === 'left' ? 'pass' : 'superlike';
      handleSwipeComplete(action);
    });
  };

  const resetPosition = () => {
    Animated.spring(position, {
      toValue: { x: 0, y: 0 },
      friction: 4,
      useNativeDriver: false
    }).start();
  };

  const handleSwipeBtn = (action: 'like' | 'pass' | 'superlike') => {
    if (isSwiping) return;
    if (action === 'like') forceSwipe('right');
    else if (action === 'pass') forceSwipe('left');
    else forceSwipe('up');
  };

  const saveFilters = async () => {
    if (!userId || isSavingFilters) return;
    const expectedUserId = userId;
    const storageKey = discoveryFiltersStorageKey(expectedUserId);
    const saveSession = filterSessionRef.current;
    const saveGeneration = filterLoadGenerationRef.current + 1;
    // Invalidate an initial load before persistence can yield and return stale state.
    filterLoadGenerationRef.current = saveGeneration;
    const filtersToSave = normalizeFilters(localFilters);
    if (filtersToSave.globalMode) {
      filtersToSave.countries = [];
    }
    setIsSavingFilters(true);
    setFilterSaveError(null);
    const ownsSave = () => (
      renderedUserIdRef.current === expectedUserId
      && filterLoadGenerationRef.current === saveGeneration
    );
    try {
      const persisted = await persistDiscoveryFilters(storageKey, filtersToSave, ownsSave);
      if (!persisted || !ownsSave()) return;
      setFilters(filtersToSave);
      setFiltersOwnerUserId(expectedUserId);
      setCurrentIndex(0);
      if (filterSessionRef.current === saveSession) {
        setLocalFilters(filtersToSave);
        setFiltersDirty(false);
        setShowFilters(false);
      }
    } catch {
      if (ownsSave() && filterSessionRef.current === saveSession) {
        setFilterSaveError(t('premium.genericError'));
      }
    } finally {
      if (ownsSave()) setIsSavingFilters(false);
    }
  };

  const toggleListValue = (key: 'countries' | 'languages', value: string) => {
    editFilters(current => {
      const values = current[key] ?? [];
      return {
        ...current,
        [key]: values.includes(value)
          ? values.filter(item => item !== value)
          : [...values, value],
      };
    });
  };

  const currentCard = cards && currentIndex < cards.length ? cards[currentIndex] : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom + 84 }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>{t('discover.title')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('discover.filters')}
          hitSlop={12}
          onPress={openFilters}
        >
          <Ionicons name="options-outline" size={24} color={colors.foreground} />
        </Pressable>
      </View>

      <ScrollView 
        contentContainerStyle={{ flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => { setCurrentIndex(0); refetch(); }} tintColor={colors.primary} />}
      >
        <View style={styles.cardContainer}>
          {isLoading && !cards ? (
            <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 100 }} />
          ) : isError ? (
            <View style={styles.emptyState}>
              <Ionicons name="alert-circle" size={64} color={colors.destructive} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]} accessibilityRole="header">{t('discover.loadErrorTitle')}</Text>
              <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>{t('discover.loadErrorDesc')}</Text>
              <Button testID="discover-error-retry" title={t('common.retry')} variant="outline" onPress={() => { setCurrentIndex(0); refetch(); }} style={{ marginTop: 24 }} accessibilityRole="button" />
            </View>
          ) : currentCard ? (
            <Animated.View
              {...panResponder.panHandlers}
              style={[
                styles.card, 
                { borderColor: colors.border },
                {
                  transform: [
                    { translateX: position.x },
                    { translateY: position.y },
                    { rotate: position.x.interpolate({ inputRange: [-width/2, 0, width/2], outputRange: ['-10deg', '0deg', '10deg'] }) }
                  ]
                }
              ]}
            >
              <Pressable
                style={styles.cardPressable}
                accessibilityRole="button"
                accessibilityLabel={`${t('discover.viewProfile')}: ${currentCard.profile.name}`}
                onPress={() => router.push(`/profile/${currentCard.userId}` as any)}
              >
                <AuthenticatedProfileImage
                  url={currentCard.profile.photos?.[0]?.url}
                  style={StyleSheet.absoluteFill}
                  accessibilityLabel={currentCard.profile.name}
                />
                {!currentCard.profile.photos?.[0]?.url && (
                  <View style={[StyleSheet.absoluteFill, styles.noPhoto, { backgroundColor: colors.muted }]}>
                    <Ionicons name="person" size={100} color={colors.mutedForeground} />
                  </View>
                )}
                <View style={[styles.cardOverlay, { backgroundColor: colors.overlay }]}>
                  <View style={styles.cardInfo}>
                    <Text style={[styles.cardName, { color: colors.overlayForeground }]}>{currentCard.profile.name}, {currentCard.profile.age}</Text>
                    {currentCard.profile.city && currentCard.profile.country && (
                      <Text style={[styles.cardLocation, { color: colors.overlayForeground }]}><Ionicons name="location" size={14} color={colors.overlayForeground} /> {currentCard.profile.city}, {currentCard.profile.country}</Text>
                    )}
                    {currentCard.profile.bio && (
                      <Text style={[styles.cardBio, { color: colors.overlayForeground }]} numberOfLines={2}>{currentCard.profile.bio}</Text>
                    )}
                  </View>
                </View>
              </Pressable>
            </Animated.View>
          ) : isFetchingNextPage ? (
            <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 100 }} />
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="planet" size={64} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]} accessibilityRole="header">{t('discover.noProfiles')}</Text>
              <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>{t('discover.noProfilesDesc')}</Text>
              <Button title={t('common.retry')} variant="outline" onPress={() => { setCurrentIndex(0); refetch(); }} style={{ marginTop: 24 }} accessibilityRole="button" />
            </View>
          )}
        </View>
      </ScrollView>

      {currentCard && (
        <View style={styles.actions}>
          <Button
            testID="discover-pass"
            accessibilityRole="button"
            accessibilityLabel={t('discover.pass')}
            variant="outline"
            size="icon"
            onPress={() => handleSwipeBtn('pass')}
            leftIcon={<Ionicons name="close" size={28} color={colors.mutedForeground} />}
            style={[styles.actionBtn, { borderColor: colors.mutedForeground }]}
          />
          <Button
            testID="discover-superlike"
            accessibilityRole="button"
            accessibilityLabel={t('discover.superLike')}
            variant="outline"
            size="icon"
            onPress={() => handleSwipeBtn('superlike')}
            leftIcon={<Ionicons name="star" size={28} color={colors.secondary} />}
            style={[styles.actionBtn, { borderColor: colors.secondary, width: 64, height: 64, borderRadius: 32 }]}
          />
          <Button
            testID="discover-like"
            accessibilityRole="button"
            accessibilityLabel={t('discover.like')}
            variant="outline"
            size="icon"
            onPress={() => handleSwipeBtn('like')}
            leftIcon={<Ionicons name="heart" size={28} color={colors.primary} />}
            style={[styles.actionBtn, { borderColor: colors.primary }]}
          />
        </View>
      )}

      <Modal visible={showFilters} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeFilters}>
        <View style={[styles.modalContainer, { backgroundColor: colors.background, paddingTop: insets.top }]}>
          <View style={styles.modalHeader}>
            <Button
              title={t('common.close')}
              variant="ghost"
              size="sm"
              testID="close-discover-filters"
              onPress={closeFilters}
            />
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>{t('discover.filters')}</Text>
            <Button title={t('common.save')} size="sm" variant="ghost" onPress={saveFilters} loading={isSavingFilters} />
          </View>
          <ScrollView
            contentContainerStyle={styles.filterContent}
            keyboardShouldPersistTaps="handled"
            pointerEvents={isSavingFilters ? 'none' : 'auto'}
          >
            {filterSaveError ? (
              <View
                testID="discover-filter-save-error"
                accessibilityRole="alert"
                style={[styles.errorBox, { borderColor: colors.destructive, backgroundColor: colors.card }]}
              >
                <Ionicons name="alert-circle" size={20} color={colors.destructive} />
                <Text style={[styles.errorMessage, { color: colors.destructive }]}>{filterSaveError}</Text>
              </View>
            ) : null}
            <View style={[styles.switchRow, { borderBottomColor: colors.border }]}>
              <View style={styles.switchCopy}>
                <Text style={[styles.switchLabel, { color: colors.foreground }]}>{t('filtersPage.globalMode')}</Text>
                <Text style={[styles.switchDescription, { color: colors.mutedForeground }]}>{t('filtersPage.globalModeDesc')}</Text>
              </View>
              <Switch 
                value={localFilters.globalMode ?? false}
                onValueChange={v => editFilters(prev => ({...prev, globalMode: v}))}
                trackColor={{ true: colors.primary }}
              />
            </View>
            <Text style={[styles.filterLabel, { color: colors.foreground }]}>{t('filtersPage.ageRange')}</Text>
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <Input 
                placeholder={t('onboarding.minAge')}
                keyboardType="numeric" 
                value={String(localFilters.minAge ?? 18)}
                onChangeText={v => editFilters(prev => ({...prev, minAge: Math.max(18, Math.min(Number.parseInt(v, 10) || 18, prev.maxAge ?? 100))}))}
                containerStyle={{ flex: 1 }} 
              />
              <Input 
                placeholder={t('onboarding.maxAge')}
                keyboardType="numeric" 
                value={String(localFilters.maxAge ?? 60)}
                onChangeText={v => editFilters(prev => ({...prev, maxAge: Math.min(100, Math.max(Number.parseInt(v, 10) || 60, prev.minAge ?? 18))}))}
                containerStyle={{ flex: 1 }} 
              />
            </View>

            <Text style={[styles.filterLabel, { color: colors.foreground }]}>{t('filtersPage.showMe')}</Text>
            <View style={styles.chips}>
              {GENDER_OPTIONS.map(option => (
                <FilterChip
                  key={option.labelKey}
                  label={t(option.labelKey)}
                  selected={(localFilters.gender ?? null) === option.value}
                  onPress={() => editFilters(prev => ({ ...prev, gender: option.value }))}
                  colors={colors}
                />
              ))}
            </View>

            <Text style={[styles.filterLabel, { color: colors.foreground }]}>{t('filtersPage.country')}</Text>
            <Text style={[styles.filterHint, { color: colors.mutedForeground }]}>
              {localFilters.globalMode ? t('filtersPage.ignoredGlobal') : t('filtersPage.anyCountry')}
            </Text>
            <View style={styles.chips}>
              {COUNTRY_OPTIONS.map(country => (
                <FilterChip
                  key={country}
                  label={country}
                  selected={(localFilters.countries ?? []).includes(country)}
                  onPress={() => toggleListValue('countries', country)}
                  colors={colors}
                />
              ))}
            </View>

            <Text style={[styles.filterLabel, { color: colors.foreground }]}>{t('filtersPage.language')}</Text>
            <View style={styles.chips}>
              {LANGUAGE_OPTIONS.map(language => (
                <FilterChip
                  key={language}
                  label={language}
                  selected={(localFilters.languages ?? []).includes(language)}
                  onPress={() => toggleListValue('languages', language)}
                  colors={colors}
                />
              ))}
            </View>

            <Text style={[styles.filterLabel, { color: colors.foreground }]}>{t('filtersPage.lookingFor')}</Text>
            <View style={styles.chips}>
              {GOAL_OPTIONS.map(option => (
                <FilterChip
                  key={option.value}
                  label={t(option.labelKey)}
                  selected={localFilters.relationshipGoal === option.value}
                  onPress={() => editFilters(prev => ({
                    ...prev,
                    relationshipGoal: prev.relationshipGoal === option.value ? null : option.value,
                  }))}
                  colors={colors}
                />
              ))}
            </View>

            <FilterSwitch
              label={t('filtersPage.sharedInterests')}
              description={t('filtersPage.sharedInterestsDesc')}
              value={localFilters.interestsOverlap ?? false}
              onChange={value => editFilters(prev => ({ ...prev, interestsOverlap: value }))}
              colors={colors}
            />
            <FilterSwitch
              label={t('filtersPage.verifiedOnly')}
              description={t('filtersPage.verifiedOnlyDesc')}
              value={localFilters.verifiedOnly ?? false}
              onChange={value => editFilters(prev => ({ ...prev, verifiedOnly: value }))}
              colors={colors}
            />
            <FilterSwitch
              label={t('discover.longDistanceFilter')}
              value={localFilters.longDistance ?? false}
              onChange={value => editFilters(prev => ({ ...prev, longDistance: value }))}
              colors={colors}
            />
            <FilterSwitch
              label={t('discover.relocationFilter')}
              value={localFilters.relocation ?? false}
              onChange={value => editFilters(prev => ({ ...prev, relocation: value }))}
              colors={colors}
            />

          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function FilterChip({
  label,
  selected,
  onPress,
  colors,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected ? colors.glass : colors.card,
        },
      ]}
    >
      <Text style={[styles.chipText, { color: selected ? colors.primary : colors.mutedForeground }]}>{label}</Text>
    </Pressable>
  );
}

function FilterSwitch({
  label,
  description,
  value,
  onChange,
  colors,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.switchRow, { borderBottomColor: colors.border }]}>
      <View style={styles.switchCopy}>
        <Text style={[styles.switchLabel, { color: colors.foreground }]}>{label}</Text>
        {description ? <Text style={[styles.switchDescription, { color: colors.mutedForeground }]}>{description}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 24, paddingVertical: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 24 },
  cardContainer: { flex: 1, paddingHorizontal: 16, paddingBottom: 16 },
  card: { flex: 1, minHeight: 400, borderRadius: 24, overflow: 'hidden', borderWidth: 1, backgroundColor: '#111' },
  cardPressable: { flex: 1 },
  cardOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  cardInfo: { padding: 24, paddingBottom: 32 },
  cardName: { fontFamily: 'Inter_700Bold', fontSize: 32, textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  cardLocation: { fontFamily: 'Inter_500Medium', fontSize: 16, marginTop: 4 },
  cardBio: { fontFamily: 'Inter_400Regular', fontSize: 14, marginTop: 8 },
  noPhoto: { alignItems: 'center', justifyContent: 'center' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 20, marginTop: 16, textAlign: 'center' },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 14, marginTop: 8, textAlign: 'center', lineHeight: 20 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, paddingBottom: 16 },
  actionBtn: { width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, backgroundColor: 'transparent' },
  modalContainer: { flex: 1 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  modalTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1 },
  switchCopy: { flex: 1, paddingRight: 16 },
  switchLabel: { fontFamily: 'Inter_500Medium', fontSize: 16 },
  switchDescription: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17, marginTop: 3 },
  filterContent: { padding: 24, paddingBottom: 48 },
  filterLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 16, marginBottom: 8, marginTop: 24 },
  filterHint: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: -4, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9 },
  chipText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 16, padding: 12, marginTop: 24 },
  errorCopy: { flex: 1 },
  errorTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  errorMessage: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
});

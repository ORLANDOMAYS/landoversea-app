import { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, Image, Pressable, StyleSheet, Dimensions, Alert, AppState, TextInput } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import {
  SIGNED_URL_REFRESH_INTERVAL_MS,
  checkNewMatch,
  getCurrentUser,
  getDiscoverProfiles,
  mergeRefreshedProfilePhotos,
  recordSwipe,
  refreshProfilePhotoUrls,
} from "../../lib/api";
import { nextSwipeState } from "../../lib/dating-state";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.3;

export default function DiscoverScreen() {
  const [userId, setUserId] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [photoRefreshError, setPhotoRefreshError] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({ minAge: "18", maxAge: "120", gender: "", location: "" });
  const [appliedFilters, setAppliedFilters] = useState({ minAge: "18", maxAge: "120", gender: "", location: "" });

  const translateX = useSharedValue(0);
  const photoRefreshInFlight = useRef(false);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const user = await getCurrentUser();
      if (user) {
        setUserId(user.id);
        const result = await getDiscoverProfiles(user.id, {
          minAge: appliedFilters.minAge ? Number(appliedFilters.minAge) : undefined,
          maxAge: appliedFilters.maxAge ? Number(appliedFilters.maxAge) : undefined,
          gender: appliedFilters.gender || undefined,
          location: appliedFilters.location || undefined,
        });
        setProfiles(result);
        setCurrentIndex(0);
        setPhotoRefreshError(null);
      } else {
        setUserId(null);
      }
    } catch (err) {
      setError(err?.message || "Unable to load profiles.");
    } finally {
      setLoading(false);
    }
  }, [appliedFilters]);

  const renewPhotoUrls = useCallback(async () => {
    if (photoRefreshInFlight.current || profiles.length === 0) return;
    photoRefreshInFlight.current = true;
    try {
      const sourceProfiles = profiles;
      const { profiles: refreshed, failedCount } = await refreshProfilePhotoUrls(profiles);
      setProfiles((current) => mergeRefreshedProfilePhotos(current, sourceProfiles, refreshed));
      setPhotoRefreshError(
        failedCount > 0 ? `${failedCount} profile photo${failedCount === 1 ? "" : "s"} could not be refreshed.` : null
      );
    } catch (err) {
      setPhotoRefreshError(err?.message || "Unable to refresh profile photos.");
    } finally {
      photoRefreshInFlight.current = false;
    }
  }, [profiles]);

  useEffect(() => { loadProfiles(); }, [loadProfiles]);

  useEffect(() => {
    if (profiles.length === 0) return undefined;
    const timer = setInterval(() => {
      void renewPhotoUrls();
    }, SIGNED_URL_REFRESH_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void renewPhotoUrls();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [profiles.length, renewPhotoUrls]);

  const handleSwipe = useCallback(
    async (direction) => {
      if (!userId || currentIndex >= profiles.length || swiping) return;
      setSwiping(true);

      try {
        const profile = profiles[currentIndex];
        await recordSwipe(userId, profile.id, direction);

        if (direction !== "pass") {
          const match = await checkNewMatch(userId, profile.id);
          if (match) {
            Alert.alert("It's a Match!", `You matched with ${profile.display_name || "someone"}!`);
          }
        }
        setCurrentIndex((prev) => nextSwipeState(prev, true));
        translateX.value = 0;
      } catch (err) {
        translateX.value = withSpring(0);
        setError(err?.message || "Swipe could not be saved. Please retry.");
      } finally {
        setSwiping(false);
      }
    },
    [userId, currentIndex, profiles, swiping]
  );

  const gesture = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = e.translationX;
    })
    .onEnd((e) => {
      if (e.translationX > SWIPE_THRESHOLD) {
        translateX.value = withTiming(SCREEN_WIDTH * 1.5, { duration: 300 });
        runOnJS(handleSwipe)("like");
      } else if (e.translationX < -SWIPE_THRESHOLD) {
        translateX.value = withTiming(-SCREEN_WIDTH * 1.5, { duration: 300 });
        runOnJS(handleSwipe)("pass");
      } else {
        translateX.value = withSpring(0);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { rotate: `${(translateX.value / SCREEN_WIDTH) * 15}deg` },
    ],
  }));

  const currentProfile = profiles[currentIndex];

  if (loading) {
    return <View style={styles.center}><Text style={styles.emptyText}>Finding people near you…</Text></View>;
  }

  if (!userId) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Please log in to discover people</Text>
      </View>
    );
  }

  if (error && !currentProfile) {
    return <View style={styles.center}><Text accessibilityRole="alert" style={styles.errorText}>{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry loading profiles" style={styles.retryBtn} onPress={loadProfiles}><Text style={styles.retryText}>Retry</Text></Pressable></View>;
  }

  if (!currentProfile) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyEmoji}>🌊</Text>
        <Text style={styles.emptyTitle}>No more profiles</Text>
        <Text style={styles.emptyText}>Check back later for new people!</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh profiles" style={styles.retryBtn} onPress={loadProfiles}><Text style={styles.retryText}>Refresh</Text></Pressable>
      </View>
    );
  }

  const photoUrl =
    currentProfile.photos?.[0]?.url ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(currentProfile.display_name || "?")}&size=400&background=e11d48&color=fff`;

  return (
    <GestureHandlerRootView style={styles.container}>
      <Pressable accessibilityRole="button" accessibilityLabel="Discovery filters" accessibilityState={{ expanded: filtersOpen }} style={styles.filterToggle} onPress={() => setFiltersOpen((open) => !open)}>
        <Text style={styles.filterToggleText}>Filters</Text>
      </Pressable>
      {filtersOpen && (
        <View style={styles.filters}>
          <View style={styles.filterRow}>
            <TextInput accessibilityLabel="Minimum age" keyboardType="numeric" value={filters.minAge} onChangeText={(value) => setFilters({ ...filters, minAge: value })} placeholder="Min age" style={styles.filterInput} />
            <TextInput accessibilityLabel="Maximum age" keyboardType="numeric" value={filters.maxAge} onChangeText={(value) => setFilters({ ...filters, maxAge: value })} placeholder="Max age" style={styles.filterInput} />
          </View>
          <TextInput accessibilityLabel="Location filter" value={filters.location} onChangeText={(value) => setFilters({ ...filters, location: value })} placeholder="City or country" style={styles.filterInput} />
          <View style={styles.filterRow}>
            {["", "male", "female", "non-binary"].map((value) => <Pressable key={value || "all"} accessibilityRole="radio" accessibilityLabel={`Show ${value || "everyone"}`} accessibilityState={{ selected: filters.gender === value }} onPress={() => setFilters({ ...filters, gender: value })} style={[styles.filterChoice, filters.gender === value && styles.filterChoiceActive]}><Text>{value || "All"}</Text></Pressable>)}
          </View>
          <View style={styles.filterRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Reset filters" onPress={() => { const reset = { minAge: "18", maxAge: "120", gender: "", location: "" }; setFilters(reset); setAppliedFilters(reset); setFiltersOpen(false); }} style={styles.filterAction}><Text>Reset</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Apply filters" onPress={() => { setAppliedFilters(filters); setFiltersOpen(false); }} style={[styles.filterAction, styles.filterApply]}><Text style={styles.retryText}>Apply</Text></Pressable>
          </View>
        </View>
      )}
      {(error || photoRefreshError) && <Text accessibilityRole="alert" style={styles.inlineError}>{error || photoRefreshError} Retry the action.</Text>}
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.card, animatedStyle]}>
          <Image source={{ uri: photoUrl }} style={styles.cardImage} onError={renewPhotoUrls} />
          <View style={styles.cardOverlay}>
            <View style={styles.nameRow}>
              <Text style={styles.cardName}>
                {currentProfile.display_name || "Unknown"}
                {currentProfile.age ? `, ${currentProfile.age}` : ""}
              </Text>
            </View>
            {currentProfile.city && (
              <Text style={styles.cardLocation}>
                📍 {currentProfile.city}{currentProfile.country ? `, ${currentProfile.country}` : ""}
              </Text>
            )}
            {currentProfile.bio && <Text style={styles.cardBio} numberOfLines={2}>{currentProfile.bio}</Text>}
          </View>
        </Animated.View>
      </GestureDetector>

      <View style={styles.buttons}>
        <Pressable
          style={[styles.btn, styles.passBtn]}
          onPress={() => handleSwipe("pass")}
          disabled={swiping}
          accessibilityRole="button"
          accessibilityLabel="Pass on this profile"
        >
          <Text style={styles.btnIcon}>✕</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.superBtn]}
          onPress={() => handleSwipe("superlike")}
          disabled={swiping}
          accessibilityRole="button"
          accessibilityLabel="Super like this profile"
        >
          <Text style={styles.btnIcon}>⭐</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.likeBtn]}
          onPress={() => handleSwipe("like")}
          disabled={swiping}
          accessibilityRole="button"
          accessibilityLabel="Like this profile"
        >
          <Text style={[styles.btnIcon, { color: "#fff" }]}>♥</Text>
        </Pressable>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 24, fontWeight: "700", marginBottom: 8 },
  emptyText: { fontSize: 16, color: "#666" },
  errorText: { fontSize: 16, color: "#b91c1c", textAlign: "center" },
  inlineError: { color: "#b91c1c", paddingHorizontal: 16, paddingTop: 4 },
  retryBtn: { marginTop: 16, backgroundColor: "#e11d48", borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12 },
  retryText: { color: "#fff", fontWeight: "700" },
  filterToggle: { alignSelf: "flex-end", marginTop: 8, marginRight: 16, borderWidth: 1, borderColor: "#ddd", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#fff" },
  filterToggleText: { color: "#333", fontWeight: "600" },
  filters: { marginHorizontal: 16, marginTop: 8, padding: 10, gap: 8, borderWidth: 1, borderColor: "#ddd", borderRadius: 12, backgroundColor: "#fff" },
  filterRow: { flexDirection: "row", gap: 6 },
  filterInput: { flex: 1, borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 9 },
  filterChoice: { flex: 1, padding: 7, borderWidth: 1, borderColor: "#ddd", borderRadius: 8, alignItems: "center" },
  filterChoiceActive: { borderColor: "#e11d48", backgroundColor: "#fef2f2" },
  filterAction: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: "#ddd", alignItems: "center" },
  filterApply: { backgroundColor: "#e11d48", borderColor: "#e11d48" },
  card: {
    flex: 1,
    margin: 16,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#fff",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  cardImage: { flex: 1, width: "100%" },
  cardOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardName: { fontSize: 26, fontWeight: "800", color: "#fff" },
  cardLocation: { fontSize: 14, color: "#ddd", marginTop: 4 },
  cardBio: { fontSize: 14, color: "#eee", marginTop: 6 },
  buttons: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 20,
    paddingBottom: 24,
    paddingTop: 8,
  },
  btn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  passBtn: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd" },
  superBtn: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd", width: 50, height: 50, borderRadius: 25 },
  likeBtn: { backgroundColor: "#e11d48" },
  btnIcon: { fontSize: 24 },
});

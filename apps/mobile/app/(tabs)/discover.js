import { useEffect, useState, useCallback } from "react";
import { View, Text, Image, Pressable, StyleSheet, Dimensions, Alert } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { getCurrentUser, getDiscoverProfiles, recordSwipe, checkNewMatch } from "../../lib/api";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.3;

export default function DiscoverScreen() {
  const [userId, setUserId] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [swiping, setSwiping] = useState(false);

  const translateX = useSharedValue(0);

  useEffect(() => {
    getCurrentUser().then((user) => {
      if (user) {
        setUserId(user.id);
        getDiscoverProfiles(user.id).then(setProfiles);
      }
    });
  }, []);

  const handleSwipe = useCallback(
    async (direction) => {
      if (!userId || currentIndex >= profiles.length || swiping) return;
      setSwiping(true);

      const profile = profiles[currentIndex];
      await recordSwipe(userId, profile.id, direction);

      if (direction !== "pass") {
        const match = await checkNewMatch(userId, profile.id);
        if (match) {
          Alert.alert("It's a Match!", `You matched with ${profile.display_name || "someone"}!`);
        }
      }

      setCurrentIndex((prev) => prev + 1);
      translateX.value = 0;
      setSwiping(false);
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

  if (!userId) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Please log in to discover people</Text>
      </View>
    );
  }

  if (!currentProfile) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyEmoji}>🌊</Text>
        <Text style={styles.emptyTitle}>No more profiles</Text>
        <Text style={styles.emptyText}>Check back later for new people!</Text>
      </View>
    );
  }

  const photoUrl =
    currentProfile.photos?.[0]?.url ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(currentProfile.display_name || "?")}&size=400&background=e11d48&color=fff`;

  return (
    <GestureHandlerRootView style={styles.container}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.card, animatedStyle]}>
          <Image source={{ uri: photoUrl }} style={styles.cardImage} />
          <View style={styles.cardOverlay}>
            <View style={styles.nameRow}>
              <Text style={styles.cardName}>
                {currentProfile.display_name || "Unknown"}
                {currentProfile.age ? `, ${currentProfile.age}` : ""}
              </Text>
              {currentProfile.verified && <Text style={styles.badge}>✓</Text>}
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
        >
          <Text style={styles.btnIcon}>✕</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.superBtn]}
          onPress={() => handleSwipe("superlike")}
          disabled={swiping}
        >
          <Text style={styles.btnIcon}>⭐</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.likeBtn]}
          onPress={() => handleSwipe("like")}
          disabled={swiping}
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
  badge: { fontSize: 16, color: "#38bdf8", fontWeight: "700" },
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

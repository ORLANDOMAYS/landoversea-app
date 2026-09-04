import { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  StyleSheet,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getCoachById } from "../lib/api";

export default function CoachDetailScreen() {
  const { coachId } = useLocalSearchParams();
  const router = useRouter();
  const [coach, setCoach] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  function loadCoach() {
    if (coachId) {
      setLoading(true);
      setError(null);
      getCoachById(coachId)
        .then(setCoach)
        .catch((err) => setError(err?.message || "Unable to load this coach."))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }

  useEffect(loadCoach, [coachId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <Text style={styles.loading}>Loading coach...</Text>
      </View>
    );
  }

  if (!coach) {
    return (
      <View style={styles.center}>
        <Text accessibilityRole={error ? "alert" : undefined} style={error ? styles.errorText : styles.notFound}>
          {error || "Coach not found or is not currently approved."}
        </Text>
        {error && <Pressable accessibilityRole="button" accessibilityLabel="Retry loading coach" style={styles.retryBtn} onPress={loadCoach}>
          <Text style={styles.backBtnText}>Retry</Text>
        </Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const avatarUrl =
    coach.avatar_url ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(coach.display_name || "?")}&size=200&background=e11d48&color=fff`;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.profileHeader}>
        <Image source={{ uri: avatarUrl }} style={styles.avatar} />
        <View style={styles.nameRow}>
          <Text style={styles.name}>{coach.display_name}</Text>
        </View>
        <Text style={styles.meta}>
          ⭐ {coach.rating > 0 ? coach.rating.toFixed(1) : "New"} ({coach.total_reviews} reviews) · {coach.total_sessions} sessions
        </Text>
        {coach.languages?.length > 0 && (
          <Text style={styles.languages}>
            🌐 {coach.languages.join(", ")}
          </Text>
        )}
      </View>

      {coach.bio && (
        <View style={styles.section}>
          <Text style={styles.bio}>{coach.bio}</Text>
        </View>
      )}

      {coach.specialties?.length > 0 && (
        <View style={styles.tagsRow}>
          {coach.specialties.map((s) => (
            <View key={s} style={styles.tag}>
              <Text style={styles.tagText}>{s}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.pricingCard}>
        <Text style={styles.pricingTitle}>Listed rate</Text>
        <Text style={styles.price}>${coach.hourly_rate}/hour</Text>
        <Text style={styles.priceMeta}>
          Booking and payment are unavailable until a trusted billing provider is connected.
        </Text>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  loading: { fontSize: 16, color: "#666" },
  notFound: { fontSize: 18, color: "#888", marginBottom: 16 },
  errorText: { fontSize: 16, color: "#b91c1c", textAlign: "center", marginBottom: 16, paddingHorizontal: 24 },
  retryBtn: { backgroundColor: "#e11d48", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10, marginBottom: 8 },
  backBtn: {
    backgroundColor: "#e11d48",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  backBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  profileHeader: { alignItems: "center", marginBottom: 20 },
  avatar: { width: 100, height: 100, borderRadius: 50, marginBottom: 12 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 24, fontWeight: "800" },
  meta: { fontSize: 14, color: "#595959", marginTop: 4, textAlign: "center" },
  languages: { fontSize: 14, color: "#666", marginTop: 4 },
  section: { marginBottom: 16 },
  bio: { fontSize: 15, color: "#444", lineHeight: 22 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 16 },
  tag: {
    backgroundColor: "#fef2f2",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tagText: { fontSize: 12, color: "#e11d48", fontWeight: "600" },
  pricingCard: {
    backgroundColor: "#f9fafb",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    alignItems: "center",
  },
  pricingTitle: { fontSize: 18, fontWeight: "700", marginBottom: 8 },
  price: { fontSize: 32, fontWeight: "800", color: "#e11d48" },
  priceMeta: { fontSize: 13, color: "#595959", marginTop: 8, textAlign: "center", lineHeight: 19 },
});

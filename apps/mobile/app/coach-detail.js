import { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  StyleSheet,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getCoachById } from "../lib/api";

export default function CoachDetailScreen() {
  const { coachId } = useLocalSearchParams();
  const router = useRouter();
  const [coach, setCoach] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (coachId) {
      setLoading(true);
      getCoachById(coachId)
        .then(setCoach)
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [coachId]);

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
        <Text style={styles.notFound}>Coach not found</Text>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const avatarUrl =
    coach.avatar_url ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(coach.display_name || "?")}&size=200&background=e11d48&color=fff`;

  const features = [
    "AI-generated profile photos",
    "Personality-matched bios",
    "Psychology-based openers",
    "Real-time coaching sessions",
    "Voice coaching & feedback",
    "Success tracking & analytics",
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.profileHeader}>
        <Image source={{ uri: avatarUrl }} style={styles.avatar} />
        <View style={styles.nameRow}>
          <Text style={styles.name}>{coach.display_name}</Text>
          {coach.verified && <Text style={styles.verified}>✓</Text>}
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

      <View style={styles.featuresCard}>
        <Text style={styles.featuresTitle}>✨ What You Get</Text>
        {features.map((f) => (
          <View key={f} style={styles.featureRow}>
            <Text style={styles.checkmark}>✓</Text>
            <Text style={styles.featureText}>{f}</Text>
          </View>
        ))}
      </View>

      <View style={styles.pricingCard}>
        <Text style={styles.pricingTitle}>💎 Pricing</Text>
        <Text style={styles.price}>${coach.hourly_rate}/hour</Text>
        <Text style={styles.priceMeta}>
          Platform fee: {coach.platform_fee_percent}% · Secure payments
        </Text>
      </View>

      <Pressable
        style={styles.bookBtn}
        onPress={() =>
          Alert.alert(
            "Book Session",
            `Contact ${coach.display_name} to schedule a coaching session at $${coach.hourly_rate}/hr.`
          )
        }
      >
        <Text style={styles.bookBtnText}>
          Book Session — ${coach.hourly_rate}
        </Text>
      </Pressable>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  loading: { fontSize: 16, color: "#666" },
  notFound: { fontSize: 18, color: "#888", marginBottom: 16 },
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
  verified: { fontSize: 18, color: "#3b82f6", fontWeight: "700" },
  meta: { fontSize: 14, color: "#888", marginTop: 4 },
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
  featuresCard: {
    backgroundColor: "#fffbeb",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  featuresTitle: { fontSize: 18, fontWeight: "700", marginBottom: 12 },
  featureRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  checkmark: { color: "#22c55e", fontSize: 16, fontWeight: "700", marginRight: 10 },
  featureText: { fontSize: 14, color: "#444" },
  pricingCard: {
    backgroundColor: "#f9fafb",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    alignItems: "center",
  },
  pricingTitle: { fontSize: 18, fontWeight: "700", marginBottom: 8 },
  price: { fontSize: 32, fontWeight: "800", color: "#e11d48" },
  priceMeta: { fontSize: 13, color: "#888", marginTop: 4 },
  bookBtn: {
    backgroundColor: "#e11d48",
    padding: 18,
    borderRadius: 14,
    alignItems: "center",
  },
  bookBtnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
});

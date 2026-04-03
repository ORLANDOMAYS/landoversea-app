import { useEffect, useState } from "react";
import { View, Text, FlatList, Pressable, Image, StyleSheet, TextInput } from "react-native";
import { useRouter } from "expo-router";
import { getCoaches } from "../../lib/api";

export default function CoachesScreen() {
  const router = useRouter();
  const [coaches, setCoaches] = useState([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    getCoaches().then(setCoaches);
  }, []);

  const filtered = coaches.filter(
    (c) =>
      !search ||
      c.display_name?.toLowerCase().includes(search.toLowerCase()) ||
      (c.specialties || []).some((s) =>
        s.toLowerCase().includes(search.toLowerCase())
      )
  );

  function renderCoach({ item }) {
    const avatarUrl = item.avatar_url ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(item.display_name || "?")}&size=100&background=e11d48&color=fff`;

    return (
      <Pressable
        style={styles.coachCard}
        onPress={() =>
          router.push(`/coach-detail?coachId=${item.id}`)
        }
      >
        <Image source={{ uri: avatarUrl }} style={styles.avatar} />
        <View style={styles.coachInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.coachName}>{item.display_name}</Text>
            {item.verified && <Text style={styles.verified}>✓</Text>}
          </View>
          <Text style={styles.coachMeta}>
            ⭐ {item.rating > 0 ? item.rating.toFixed(1) : "New"} · {item.total_sessions} sessions
          </Text>
          {item.specialties?.length > 0 && (
            <View style={styles.tagsRow}>
              {item.specialties.slice(0, 3).map((s) => (
                <View key={s} style={styles.tag}>
                  <Text style={styles.tagText}>{s}</Text>
                </View>
              ))}
            </View>
          )}
          <Text style={styles.rate}>💎 ${item.hourly_rate}/hr</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Dating Coaches</Text>
        <Text style={styles.subtitle}>
          Get personalized help from verified dating experts
        </Text>
      </View>

      <TextInput
        style={styles.searchInput}
        value={search}
        onChangeText={setSearch}
        placeholder="Search coaches by name or specialty..."
        placeholderTextColor="#999"
      />

      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text style={{ fontSize: 48, marginBottom: 12 }}>🎓</Text>
          <Text style={styles.emptyTitle}>No coaches found</Text>
          <Text style={styles.emptyText}>
            {search ? "Try a different search term" : "Check back later for coaches"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderCoach}
          contentContainerStyle={{ padding: 16 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: { padding: 16, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: "800", color: "#111" },
  subtitle: { fontSize: 14, color: "#666", marginTop: 4 },
  searchInput: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
  },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  emptyTitle: { fontSize: 22, fontWeight: "700", marginBottom: 8 },
  emptyText: { fontSize: 16, color: "#666" },
  coachCard: {
    flexDirection: "row",
    padding: 12,
    marginBottom: 12,
    backgroundColor: "#f9fafb",
    borderRadius: 16,
  },
  avatar: { width: 64, height: 64, borderRadius: 32, marginRight: 12 },
  coachInfo: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  coachName: { fontSize: 17, fontWeight: "700" },
  verified: { fontSize: 14, color: "#3b82f6", fontWeight: "700" },
  coachMeta: { fontSize: 13, color: "#888", marginTop: 2 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 },
  tag: {
    backgroundColor: "#fef2f2",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagText: { fontSize: 11, color: "#e11d48", fontWeight: "600" },
  rate: { fontSize: 14, fontWeight: "600", color: "#f59e0b", marginTop: 6 },
});

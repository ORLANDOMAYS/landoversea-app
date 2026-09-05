import { useState, useCallback } from "react";
import { View, Text, FlatList, Pressable, Image, StyleSheet } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { getCurrentUser, getMatches } from "../../lib/api";
import { loadMatchesForCurrentUser } from "../../lib/match-loader";

export default function MatchesScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadMatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadMatchesForCurrentUser(getCurrentUser, getMatches);
      setUserId(result.userId);
      setMatches(result.matches);
    } catch (err) {
      setError(err?.message || "Unable to load matches.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadMatches();
    }, [loadMatches])
  );

  function renderMatch({ item }) {
    const p = item.profile;
    return (
      <View style={styles.matchRow}>
        <Pressable
          style={styles.chatTarget}
          accessibilityRole="button"
          accessibilityLabel={`Open chat with ${p?.display_name || "match"}`}
          onPress={() => router.push(`/chat?matchId=${item.id}`)}
        >
        <Image
          source={{
            uri: `https://ui-avatars.com/api/?name=${encodeURIComponent(p?.display_name || "?")}&size=100&background=e11d48&color=fff`,
          }}
          style={styles.avatar}
        />
        <View style={styles.matchInfo}>
          <Text style={styles.matchName}>{p?.display_name || "Unknown"}</Text>
          {p?.language && (
            <Text style={styles.langBadge}>🌐 {p.language.toUpperCase()}</Text>
          )}
          <Text style={styles.lastMsg} numberOfLines={1}>
            {item.lastMessage?.body || "Say hello!"}
          </Text>
        </View>
        </Pressable>
        <Pressable
          style={styles.videoBtn}
          onPress={() => router.push(`/video-call?matchId=${item.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`Start video call with ${p?.display_name || "match"}`}
        >
          <Text style={{ fontSize: 20 }}>📹</Text>
        </Pressable>
      </View>
    );
  }

  if (loading) {
    return <View style={styles.center}><Text style={styles.emptyText}>Loading matches…</Text></View>;
  }

  if (error) {
    return <View style={styles.center}><Text accessibilityRole="alert" style={styles.errorText}>{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry loading matches" style={styles.retryBtn} onPress={loadMatches}><Text style={styles.retryText}>Retry</Text></Pressable></View>;
  }

  if (!userId) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Please log in to see matches</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {matches.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 48, marginBottom: 12 }}>💝</Text>
          <Text style={styles.emptyTitle}>No matches yet</Text>
          <Text style={styles.emptyText}>Keep swiping to find your match!</Text>
        </View>
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(item) => item.id}
          renderItem={renderMatch}
          contentContainerStyle={{ padding: 16 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  emptyTitle: { fontSize: 22, fontWeight: "700", marginBottom: 8 },
  emptyText: { fontSize: 16, color: "#666" },
  errorText: { color: "#b91c1c", fontSize: 16, textAlign: "center" },
  retryBtn: { marginTop: 16, backgroundColor: "#e11d48", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  retryText: { color: "#fff", fontWeight: "700" },
  matchRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  avatar: { width: 56, height: 56, borderRadius: 28, marginRight: 12 },
  matchInfo: { flex: 1 },
  chatTarget: { flex: 1, flexDirection: "row", alignItems: "center" },
  matchName: { fontSize: 17, fontWeight: "600" },
  langBadge: { fontSize: 11, color: "#e11d48", marginTop: 2 },
  lastMsg: { fontSize: 14, color: "#888", marginTop: 4 },
  videoBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#f0f0f0",
    justifyContent: "center",
    alignItems: "center",
  },
});

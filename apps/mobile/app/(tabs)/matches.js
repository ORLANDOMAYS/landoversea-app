import { useEffect, useState, useCallback } from "react";
import { View, Text, FlatList, Pressable, Image, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { getCurrentUser, getMatches } from "../../lib/api";

export default function MatchesScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [matches, setMatches] = useState([]);

  useEffect(() => {
    getCurrentUser().then((user) => {
      if (user) setUserId(user.id);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (userId) getMatches(userId).then(setMatches);
    }, [userId])
  );

  function renderMatch({ item }) {
    const p = item.profile;
    return (
      <Pressable
        style={styles.matchRow}
        onPress={() => router.push(`/chat?matchId=${item.id}&userId=${userId}`)}
      >
        <Image
          source={{
            uri: `https://ui-avatars.com/api/?name=${encodeURIComponent(p?.display_name || "?")}&size=100&background=e11d48&color=fff`,
          }}
          style={styles.avatar}
        />
        <View style={styles.matchInfo}>
          <Text style={styles.matchName}>{p?.display_name || "Unknown"}</Text>
          <Text style={styles.lastMsg} numberOfLines={1}>
            {item.lastMessage?.body || "Say hello!"}
          </Text>
        </View>
      </Pressable>
    );
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
  matchRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  avatar: { width: 56, height: 56, borderRadius: 28, marginRight: 12 },
  matchInfo: { flex: 1 },
  matchName: { fontSize: 17, fontWeight: "600" },
  lastMsg: { fontSize: 14, color: "#888", marginTop: 4 },
});

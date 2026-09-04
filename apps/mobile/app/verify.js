import { View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

export default function VerifyScreen() {
  const router = useRouter();
  return (
    <View style={styles.container}>
      <Text style={{ fontSize: 48, marginBottom: 16 }}>🛡️</Text>
      <Text style={styles.title}>Verification unavailable</Text>
      <Text style={styles.subtitle}>
        Identity verification is not available yet. We will not mark profiles as
        verified until a trusted verification provider is connected.
      </Text>
      <Pressable style={styles.backBtn} onPress={() => router.back()}>
        <Text style={styles.backText}>Go Back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "#fff" },
  title: { fontSize: 24, fontWeight: "800", marginBottom: 12 },
  subtitle: { fontSize: 16, color: "#666", textAlign: "center", marginBottom: 32, lineHeight: 24 },
  btn: { backgroundColor: "#e11d48", paddingHorizontal: 48, paddingVertical: 16, borderRadius: 12 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  backBtn: { marginTop: 16, padding: 12 },
  backText: { color: "#666", fontSize: 16 },
});

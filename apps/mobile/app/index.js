import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../lib/supabase";

export default function LandingScreen() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) router.replace("/(tabs)/discover");
      else setChecking(false);
    });
  }, []);

  if (checking) {
    return (
      <View style={styles.container}>
        <Text style={styles.loading}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>LandOverSea</Text>
      <Text style={styles.tagline}>
        Find love across borders.{"\n"}Real-time translation. Real connections.
      </Text>
      <Pressable style={styles.btn} onPress={() => router.push("/auth")}>
        <Text style={styles.btnText}>Get Started</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "#fff" },
  loading: { fontSize: 16, color: "#666" },
  logo: { fontSize: 36, fontWeight: "800", color: "#e11d48", marginBottom: 12 },
  tagline: { fontSize: 16, color: "#666", textAlign: "center", marginBottom: 32, lineHeight: 24 },
  btn: { backgroundColor: "#e11d48", paddingHorizontal: 48, paddingVertical: 16, borderRadius: 999 },
  btnText: { color: "#fff", fontSize: 18, fontWeight: "700" },
});

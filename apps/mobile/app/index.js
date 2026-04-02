import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, Image, Dimensions } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../lib/supabase";

const { width } = Dimensions.get("window");

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
        <Image
          source={require("../assets/logo.webp")}
          style={styles.loadingLogo}
          resizeMode="contain"
        />
        <Text style={styles.loading}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Image
        source={require("../assets/logo.webp")}
        style={styles.logo}
        resizeMode="contain"
      />
      <Text style={styles.appName}>LandOverSea</Text>
      <Text style={styles.tagline}>
        Find love across borders.{"\n"}Real-time translation. Real connections.
      </Text>

      <View style={styles.features}>
        <View style={styles.featureRow}>
          <Text style={styles.featureIcon}>🌐</Text>
          <Text style={styles.featureText}>19 languages translated live</Text>
        </View>
        <View style={styles.featureRow}>
          <Text style={styles.featureIcon}>✓</Text>
          <Text style={styles.featureText}>Facial verification for safety</Text>
        </View>
        <View style={styles.featureRow}>
          <Text style={styles.featureIcon}>📍</Text>
          <Text style={styles.featureText}>Multi-location profiles</Text>
        </View>
        <View style={styles.featureRow}>
          <Text style={styles.featureIcon}>🎓</Text>
          <Text style={styles.featureText}>Expert dating coaches</Text>
        </View>
      </View>

      <Pressable style={styles.btn} onPress={() => router.push("/auth")}>
        <Text style={styles.btnText}>Get Started</Text>
      </Pressable>
      <Pressable onPress={() => router.push("/auth")}>
        <Text style={styles.loginText}>Already have an account? Sign in</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#fff",
  },
  loadingLogo: { width: 80, height: 80, marginBottom: 16 },
  loading: { fontSize: 16, color: "#666" },
  logo: { width: width * 0.4, height: width * 0.4, marginBottom: 8 },
  appName: { fontSize: 32, fontWeight: "800", color: "#e11d48", marginBottom: 8 },
  tagline: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 24,
  },
  features: { marginBottom: 32, alignSelf: "stretch", paddingHorizontal: 16 },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 12,
  },
  featureIcon: { fontSize: 20, width: 28, textAlign: "center" },
  featureText: { fontSize: 15, color: "#444" },
  btn: {
    backgroundColor: "#e11d48",
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 999,
    width: "100%",
    alignItems: "center",
  },
  btnText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  loginText: { color: "#e11d48", marginTop: 16, fontSize: 14 },
});

import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";
import {
  getCurrentUser,
  getProfile,
  upsertProfile,
  getUserLocations,
  addUserLocation,
  removeUserLocation,
} from "../../lib/api";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "th", label: "Thai" },
  { code: "vi", label: "Vietnamese" },
  { code: "ru", label: "Russian" },
  { code: "tr", label: "Turkish" },
  { code: "pl", label: "Polish" },
  { code: "nl", label: "Dutch" },
  { code: "sv", label: "Swedish" },
  { code: "tl", label: "Tagalog" },
];

export default function SettingsScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [language, setLanguage] = useState("en");
  const [locations, setLocations] = useState([]);
  const [newCity, setNewCity] = useState("");
  const [newCountry, setNewCountry] = useState("");

  useEffect(() => {
    getCurrentUser().then((user) => {
      if (!user) return;
      setUserId(user.id);
      getProfile(user.id).then((p) => {
        if (p) {
          setProfile(p);
          setLanguage(p.language || "en");
        }
      });
      getUserLocations(user.id).then(setLocations);
    });
  }, []);

  async function saveLang(code) {
    if (!userId) return;
    setLanguage(code);
    await upsertProfile(userId, { language: code });
  }

  async function handleUpgrade(plan) {
    if (!userId) return;
    const result = await upsertProfile(userId, { premium: true });
    if (result?.error) {
      Alert.alert("Error", result.error.message || "Failed to upgrade. Please try again.");
    } else {
      setProfile((prev) => ({ ...prev, premium: true }));
      Alert.alert("Upgraded!", `You are now a premium member (${plan} plan). Enjoy all features!`);
    }
  }

  async function handleAddLocation() {
    if (!userId || !newCity || !newCountry) return;
    if (!profile?.premium) {
      Alert.alert("Premium Only", "Upgrade to premium to add multiple locations.");
      return;
    }
    if (locations.length >= 3) {
      Alert.alert("Limit Reached", "You can have up to 3 locations.");
      return;
    }
    const loc = await addUserLocation(userId, newCity, newCountry);
    if (loc) {
      setLocations((prev) => [...prev, loc]);
      setNewCity("");
      setNewCountry("");
    }
  }

  async function handleRemoveLocation(id) {
    await removeUserLocation(id);
    setLocations((prev) => prev.filter((l) => l.id !== id));
  }

  async function logout() {
    if (supabase) await supabase.auth.signOut();
    router.replace("/");
  }

  if (!userId) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Please log in</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.section}>Language</Text>
      <View style={styles.langGrid}>
        {LANGUAGES.map((l) => (
          <Pressable
            key={l.code}
            style={[styles.langBtn, language === l.code && styles.langActive]}
            onPress={() => saveLang(l.code)}
          >
            <Text style={[styles.langText, language === l.code && styles.langTextActive]}>
              {l.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.section}>Locations {profile?.premium ? "(Premium)" : ""}</Text>
      {locations.map((loc) => (
        <View key={loc.id} style={styles.locRow}>
          <Text style={styles.locText}>
            📍 {loc.city}, {loc.country}
          </Text>
          <Pressable onPress={() => handleRemoveLocation(loc.id)}>
            <Text style={styles.removeText}>Remove</Text>
          </Pressable>
        </View>
      ))}
      {profile?.premium && locations.length < 3 && (
        <View style={styles.addLocRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={newCity}
            onChangeText={setNewCity}
            placeholder="City"
          />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={newCountry}
            onChangeText={setNewCountry}
            placeholder="Country"
          />
          <Pressable style={styles.addBtn} onPress={handleAddLocation}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>Add</Text>
          </Pressable>
        </View>
      )}
      {!profile?.premium && (
        <View>
          <Text style={styles.section}>Premium Plans</Text>
          <Pressable style={styles.upgradeBtn} onPress={() => handleUpgrade("Weekly")}>
            <Text style={styles.upgradeBtnText}>Weekly — $9.99/week</Text>
          </Pressable>
          <Pressable style={[styles.upgradeBtn, { backgroundColor: "#e11d48", marginTop: 8 }]} onPress={() => handleUpgrade("Monthly")}>
            <Text style={styles.upgradeBtnText}>Monthly — $35.99/month</Text>
          </Pressable>
          <Pressable style={[styles.upgradeBtn, { backgroundColor: "#7c3aed", marginTop: 8 }]} onPress={() => handleUpgrade("Yearly")}>
            <Text style={styles.upgradeBtnText}>Yearly — $199.99/year (Save 54%)</Text>
          </Pressable>
        </View>
      )}

      <Pressable style={styles.logoutBtn} onPress={logout}>
        <Text style={styles.logoutText}>Log Out</Text>
      </Pressable>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  emptyText: { fontSize: 16, color: "#666" },
  section: { fontSize: 20, fontWeight: "700", marginTop: 16, marginBottom: 12 },
  langGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  langBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: "#ddd" },
  langActive: { borderColor: "#e11d48", backgroundColor: "#fef2f2" },
  langText: { color: "#666", fontSize: 14 },
  langTextActive: { color: "#e11d48", fontWeight: "600" },
  locRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  locText: { fontSize: 16 },
  removeText: { color: "#e11d48", fontWeight: "600" },
  addLocRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 10, padding: 12, fontSize: 14 },
  addBtn: { backgroundColor: "#e11d48", paddingHorizontal: 16, borderRadius: 10, justifyContent: "center" },
  upgradeBtn: {
    backgroundColor: "#f59e0b",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 16,
  },
  upgradeBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  logoutBtn: {
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 24,
  },
  logoutText: { color: "#666", fontSize: 16, fontWeight: "600" },
});

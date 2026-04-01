import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../lib/supabase";

export default function AuthScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendOtp() {
    if (!supabase || !email) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ email });
    setLoading(false);
    if (error) {
      Alert.alert("Error", error.message);
    } else {
      Alert.alert("Check your email", "We sent you a login link.");
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome Back</Text>
      <Text style={styles.subtitle}>Enter your email to sign in</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="you@email.com"
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <Pressable
        style={[styles.btn, loading && styles.btnDisabled]}
        onPress={sendOtp}
        disabled={loading}
      >
        <Text style={styles.btnText}>{loading ? "Sending..." : "Send Login Link"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#fff" },
  title: { fontSize: 28, fontWeight: "800", marginBottom: 8 },
  subtitle: { fontSize: 16, color: "#666", marginBottom: 24 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 12, padding: 16, fontSize: 16, marginBottom: 16 },
  btn: { backgroundColor: "#e11d48", padding: 16, borderRadius: 12, alignItems: "center" },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});

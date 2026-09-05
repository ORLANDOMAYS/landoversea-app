import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { completeAuthCallback } from "../lib/auth-gate";

export default function AuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [state, setState] = useState({ status: "loading", message: "Signing you in..." });

  useEffect(() => {
    let active = true;
    let timer;

    async function finish() {
      try {
        const initialUrl = await Linking.getInitialURL();
        const callbackUrl =
          typeof params.callbackUrl === "string" ? params.callbackUrl : initialUrl;
        const result = await completeAuthCallback(callbackUrl);
        if (!active) return;
        setState({ status: "success", message: "Sign-in successful. Redirecting..." });
        timer = setTimeout(() => router.replace(result.destination), 900);
      } catch (error) {
        if (!active) return;
        setState({
          status: "error",
          message: error?.message || "This sign-in link is invalid or has expired.",
        });
      }
    }

    finish();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [params.callbackUrl, router]);

  return (
    <View style={styles.container}>
      {state.status === "loading" && <ActivityIndicator size="large" color="#e11d48" />}
      <Text style={styles.text}>{state.message}</Text>
      {state.status === "error" && (
        <Pressable style={styles.button} onPress={() => router.replace("/auth")}>
          <Text style={styles.buttonText}>Request a new link</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  text: {
    marginTop: 16,
    fontSize: 16,
    color: "#666",
  },
  button: { marginTop: 20, backgroundColor: "#e11d48", padding: 14, borderRadius: 10 },
  buttonText: { color: "#fff", fontWeight: "700" },
});

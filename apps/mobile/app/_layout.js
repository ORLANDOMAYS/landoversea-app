import { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import { supabase } from "../lib/supabase";

export default function RootLayout() {
  const router = useRouter();

  useEffect(() => {
    if (!supabase) return;

    // Handle deep link auth (magic link from email)
    function handleDeepLink(event) {
      const url = event.url || event;
      if (!url) return;
      const parsed = Linking.parse(url);
      // Extract tokens from the URL hash/params
      const accessToken =
        parsed.queryParams?.access_token ||
        parsed.queryParams?.token;
      const refreshToken = parsed.queryParams?.refresh_token;

      // PKCE flow: Supabase v2 sends a `code` param that must be exchanged
      const code = parsed.queryParams?.code;
      if (code) {
        supabase.auth
          .exchangeCodeForSession(code)
          .catch((err) => console.warn("Deep link code exchange failed:", err));
      } else if (accessToken && refreshToken) {
        // Implicit flow fallback
        supabase.auth
          .setSession({ access_token: accessToken, refresh_token: refreshToken })
          .catch((err) => console.warn("Deep link setSession failed:", err));
      }
    }

    // Check if app was opened by a deep link
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink({ url });
    });

    // Listen for deep links while the app is open
    const sub = Linking.addEventListener("url", handleDeepLink);

    // Listen for Supabase auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "SIGNED_IN" && session) {
          router.replace("/(tabs)/discover");
        } else if (event === "SIGNED_OUT") {
          router.replace("/");
        }
      }
    );

    return () => {
      sub.remove();
      subscription.unsubscribe();
    };
  }, []);

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#fff" },
          headerTintColor: "#e11d48",
          headerTitleStyle: { fontWeight: "700" },
        }}
      >
        <Stack.Screen name="index" options={{ title: "LandOverSea" }} />
        <Stack.Screen name="auth" options={{ title: "Login" }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="chat" options={{ title: "Chat" }} />
        <Stack.Screen name="verify" options={{ title: "Verify Profile" }} />
        <Stack.Screen name="video-call" options={{ headerShown: false }} />
        <Stack.Screen
          name="coach-detail"
          options={{ title: "Coach Profile" }}
        />
      </Stack>
    </>
  );
}

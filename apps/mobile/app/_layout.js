import { useEffect, useRef } from "react";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import { supabase } from "../lib/supabase";
import { getAuthDestination } from "../lib/auth-gate";
import { parseAuthCallbackUrl } from "../lib/auth-flow";

export default function RootLayout() {
  const router = useRouter();
  const handlingLink = useRef(false);

  useEffect(() => {
    function handleDeepLink(event) {
      const url = event.url || event;
      if (!url) return;
      const parsed = parseAuthCallbackUrl(url);
      if (parsed.kind !== "invalid") {
        handlingLink.current = true;
        router.replace({
          pathname: "/auth-callback",
          params: { callbackUrl: url },
        });
      }
    }

    Linking.getInitialURL().then(async (url) => {
      if (url && parseAuthCallbackUrl(url).kind !== "invalid") {
        handleDeepLink(url);
        return;
      }
      const result = await getAuthDestination();
      if (!handlingLink.current && result.destination !== "/") {
        router.replace(result.destination);
      }
    });
    const sub = Linking.addEventListener("url", handleDeepLink);

    const subscription = supabase
      ? supabase.auth.onAuthStateChange((event) => {
          if (event === "SIGNED_OUT") router.replace("/");
        }).data.subscription
      : null;

    return () => {
      sub.remove();
      subscription?.unsubscribe();
    };
  }, [router]);

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
        <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
        <Stack.Screen name="video-call" options={{ headerShown: false }} />
        <Stack.Screen
          name="coach-detail"
          options={{ title: "Coach Profile" }}
        />
      </Stack>
    </>
  );
}

import { useEffect, useState } from "react";
import { Tabs, usePathname, useRouter } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import { getAuthDestination } from "../../lib/auth-gate";

function TabIcon({ name, color }) {
  const icons = {
    Discover: "♥",
    Matches: "💬",
    Coaches: "🎓",
    Profile: "👤",
    Settings: "⚙",
  };
  return <Text style={{ fontSize: 22, color }}>{icons[name] || "•"}</Text>;
}

export default function TabsLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    getAuthDestination().then(({ destination }) => {
      if (!active) return;
      if (destination === "/") router.replace("/");
      else if (
        destination === "/(tabs)/profile" &&
        pathname !== "/profile"
      ) router.replace(destination);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, [pathname, router]);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color="#e11d48" />
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#e11d48",
        tabBarInactiveTintColor: "#999",
        headerStyle: { backgroundColor: "#fff" },
        headerTintColor: "#e11d48",
        headerTitleStyle: { fontWeight: "700" },
      }}
    >
      <Tabs.Screen
        name="discover"
        options={{
          title: "Discover",
          tabBarIcon: ({ color }) => <TabIcon name="Discover" color={color} />,
        }}
      />
      <Tabs.Screen
        name="matches"
        options={{
          title: "Matches",
          tabBarIcon: ({ color }) => <TabIcon name="Matches" color={color} />,
        }}
      />
      <Tabs.Screen
        name="coaches"
        options={{
          title: "Coaches",
          tabBarIcon: ({ color }) => <TabIcon name="Coaches" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => <TabIcon name="Profile" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <TabIcon name="Settings" color={color} />,
        }}
      />
    </Tabs>
  );
}

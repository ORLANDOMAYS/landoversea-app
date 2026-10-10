import React, { useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '@/i18n';
import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { registerForPushNotificationsAsync } from '@/lib/push';

export default function TabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const { t } = useI18n();
  const [tokenStatus, setTokenStatus] = useState<string>('');

  useEffect(() => {
    async function setupPush() {
      const token = await registerForPushNotificationsAsync();
      if (token) {
        setTokenStatus('Push active');
      } else {
        setTokenStatus('Push unavailable');
      }
    }
    setupPush();
  }, []);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: [
          styles.tabBar,
          {
            backgroundColor: Platform.OS === 'ios' ? 'transparent' : colors.navigation,
            borderTopColor: colors.border,
          }
        ],
        tabBarBackground: () => 
          Platform.OS === 'ios' ? (
            <BlurView tint={colorScheme === 'dark' ? 'dark' : 'light'} intensity={80} style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.navigation }]} />
          ),
      }}
    >
      <Tabs.Screen
        name="discover"
        options={{
          title: t('nav.discover'),
          tabBarIcon: ({ color, size }) => <Ionicons name="planet" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="matches"
        options={{
          title: t('nav.matches'),
          tabBarIcon: ({ color, size }) => <Ionicons name="heart" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: t('nav.messages'),
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="coaches"
        options={{
          title: t('nav.coaches'),
          tabBarIcon: ({ color, size }) => <Ionicons name="compass" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('nav.profile'),
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    borderTopWidth: 1,
    elevation: 0,
  }
});

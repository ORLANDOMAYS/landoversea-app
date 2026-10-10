import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { registerPushToken, removePushToken } from '@workspace/api-client-react';

const SAVED_PUSH_TOKEN_KEY = 'los_push_token';

export async function getSavedPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  try {
    return await SecureStore.getItemAsync(SAVED_PUSH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setSavedPushToken(token: string) {
  if (Platform.OS === 'web') return;
  await SecureStore.setItemAsync(SAVED_PUSH_TOKEN_KEY, token);
}

export async function clearSavedPushToken() {
  if (Platform.OS === 'web') return;

  const token = await getSavedPushToken();
  try {
    if (token) await removePushToken({ token });
  } finally {
    await SecureStore.deleteItemAsync(SAVED_PUSH_TOKEN_KEY);
  }
}

export type PushRegistrationResult =
  | { status: 'registered'; token: string }
  | { status: 'unavailable'; reason: 'web' | 'simulator' | 'missing-project-id' }
  | { status: 'denied' }
  | { status: 'error'; message: string };

export async function registerForPushNotificationsAsync(): Promise<PushRegistrationResult> {
  if (Platform.OS === 'web') return { status: 'unavailable', reason: 'web' };

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      return { status: 'denied' };
    }
    
    try {
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      if (!projectId) {
        return { status: 'unavailable', reason: 'missing-project-id' };
      }
      const pushTokenString = (await Notifications.getExpoPushTokenAsync({
        projectId,
      })).data;
      
      await registerPushToken({ token: pushTokenString, platform: Platform.OS as 'ios' | 'android' });
      await setSavedPushToken(pushTokenString);
      return { status: 'registered', token: pushTokenString };
    } catch (e) {
      return { status: 'error', message: e instanceof Error ? e.message : 'push-registration-error' };
    }
  }

  return { status: 'unavailable', reason: 'simulator' };
}

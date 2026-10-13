import * as SecureStore from 'expo-secure-store';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { clearSavedPushToken } from './push';
import { disconnectRevenueCatUser } from './revenuecat-identity';
import { supabase } from './supabase';

const TOKEN_KEY = 'los_mobile_session_token';
let currentQueryClient: QueryClient | null = null;
let webPreviewToken: string | null = null;

function getWebStorage(): Storage | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function setGlobalQueryClient(client: QueryClient) {
  currentQueryClient = client;
}

export async function getSessionToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.access_token ?? null;
}

export async function setSessionToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    webPreviewToken = token;
    getWebStorage()?.setItem(TOKEN_KEY, token);
    return;
  }

  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch (error) {
    throw new Error('Failed to write to SecureStore: ' + (error as Error).message);
  }
}

export async function clearSessionToken(): Promise<void> {
  if (Platform.OS === 'web') {
    webPreviewToken = null;
    getWebStorage()?.removeItem(TOKEN_KEY);
    return;
  }

  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch (error) {
    throw new Error('Failed to delete from SecureStore: ' + (error as Error).message);
  }
}

export async function performLogoutCleanup(userId?: string | number): Promise<void> {
  // Native SDK identity cleanup is serialized with any in-flight store sheet,
  // but local logout must not wait indefinitely for that queue to drain.
  void disconnectRevenueCatUser().catch(() => undefined);
  try {
    await clearSavedPushToken();
  } finally {
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    }
    await clearSessionToken();
  }
  const keys = await AsyncStorage.getAllKeys();
  const accountDraftKeys = keys.filter(key =>
    key.startsWith('los_onboarding_') || (userId !== undefined && key.includes(`_${userId}`)),
  );
  if (accountDraftKeys.length) await AsyncStorage.multiRemove(accountDraftKeys);
  if (currentQueryClient) {
    currentQueryClient.clear();
  }
}

export async function clearUserScopedCaches(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const scopedKeys = keys.filter(key => key.startsWith('los_onboarding_'));
  if (scopedKeys.length) await AsyncStorage.multiRemove(scopedKeys);
  currentQueryClient?.clear();
}

// Hook it up to the API client
setAuthTokenGetter(getSessionToken);

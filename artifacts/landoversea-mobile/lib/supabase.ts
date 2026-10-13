import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';
import { createClient, type SupportedStorage } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';
const LEGACY_SESSION_KEY = 'los_supabase_session';

function scopedStorageKey(key: string): string {
  const encoded = Array.from(
    key,
    character => character.codePointAt(0)!.toString(16).padStart(6, '0'),
  ).join('');
  return `los_sb_${encoded}`;
}

function isSessionKey(key: string): boolean {
  return key.endsWith('-auth-token');
}

function legacyValueMatchesKey(key: string, value: string): boolean {
  if (key.endsWith('-code-verifier')) {
    try {
      return typeof JSON.parse(value) !== 'object';
    } catch {
      return true;
    }
  }
  if (!isSessionKey(key)) return false;
  try {
    const parsed = JSON.parse(value);
    return !!parsed && typeof parsed === 'object';
  } catch {
    return false;
  }
}

function webStorage(): Storage | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const sessionStorage: SupportedStorage = {
  async getItem(key) {
    const scopedKey = scopedStorageKey(key);
    if (Platform.OS === 'web') {
      const storage = webStorage();
      const current = storage?.getItem(scopedKey) ?? null;
      if (current || !storage) return current;
      const legacy = storage.getItem(LEGACY_SESSION_KEY);
      if (legacy && legacyValueMatchesKey(key, legacy)) {
        storage.setItem(scopedKey, legacy);
        storage.removeItem(LEGACY_SESSION_KEY);
        return legacy;
      }
      return null;
    }
    const current = await SecureStore.getItemAsync(scopedKey);
    if (current) return current;
    const legacy = await SecureStore.getItemAsync(LEGACY_SESSION_KEY);
    if (legacy && legacyValueMatchesKey(key, legacy)) {
      await SecureStore.setItemAsync(scopedKey, legacy, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
      });
      await SecureStore.deleteItemAsync(LEGACY_SESSION_KEY);
      return legacy;
    }
    return null;
  },
  async setItem(key, value) {
    const scopedKey = scopedStorageKey(key);
    if (Platform.OS === 'web') {
      webStorage()?.setItem(scopedKey, value);
      return;
    }
    await SecureStore.setItemAsync(scopedKey, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
  },
  async removeItem(key) {
    const scopedKey = scopedStorageKey(key);
    if (Platform.OS === 'web') {
      const storage = webStorage();
      storage?.removeItem(scopedKey);
      if (isSessionKey(key)) storage?.removeItem(LEGACY_SESSION_KEY);
      return;
    }
    await SecureStore.deleteItemAsync(scopedKey);
    if (isSessionKey(key)) await SecureStore.deleteItemAsync(LEGACY_SESSION_KEY);
  },
};

export const supabaseConfigurationError =
  'Authentication is unavailable because Supabase is not configured.';

export const supabase = url && anonKey
  ? createClient(url, anonKey, {
      auth: {
        storage: sessionStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    })
  : null;

if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', state => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
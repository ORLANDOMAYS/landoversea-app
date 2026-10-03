import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import {
  AUTH_CALLBACK_PATH,
  AuthCallbackParameters,
  buildAuthCallbackUrl,
  NATIVE_AUTH_CALLBACK_URL,
} from './auth-callback-url';

export function createAuthCallbackUrl(
  parameters: AuthCallbackParameters = {},
): string {
  const baseUrl = Platform.OS === 'web'
    ? Linking.createURL(AUTH_CALLBACK_PATH)
    : NATIVE_AUTH_CALLBACK_URL;
  return buildAuthCallbackUrl(baseUrl, parameters);
}

export function createRecoveryCallbackUrl(): string {
  return createAuthCallbackUrl({ type: 'recovery' });
}
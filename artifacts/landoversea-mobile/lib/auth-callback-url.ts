export const LANDOVERSEA_AUTH_SCHEME = 'landoversea';
export const AUTH_CALLBACK_PATH = '/auth-callback';
export const NATIVE_AUTH_CALLBACK_URL = `${LANDOVERSEA_AUTH_SCHEME}://${AUTH_CALLBACK_PATH}`;

export type AuthCallbackParameters = Record<string, string | undefined>;

export function buildAuthCallbackUrl(
  baseUrl: string,
  parameters: AuthCallbackParameters = {},
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value) query.set(key, value);
  }
  const serialized = query.toString();
  if (!serialized) return baseUrl;
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${serialized}`;
}
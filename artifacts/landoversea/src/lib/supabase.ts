import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

export const supabaseConfigurationError =
  'Authentication is unavailable because Supabase is not configured.';

export function getSupabase(): SupabaseClient {
  if (browserClient) return browserClient;

  const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
  if (!url || !anonKey) throw new Error(supabaseConfigurationError);

  browserClient = createClient(url, anonKey, {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return browserClient;
}

/**
 * Lazy proxy: importing this module never constructs a client or reads a
 * session. This also keeps missing configuration as an explicit UI error.
 */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const client = getSupabase() as unknown as Record<PropertyKey, unknown>;
    const value = client[property];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

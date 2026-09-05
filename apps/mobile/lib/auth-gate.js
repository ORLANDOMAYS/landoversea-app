import { supabase, supabaseConfigurationError } from "./supabase";
import { decideAuthDestination, parseAuthCallbackUrl } from "./auth-flow";

export async function getAuthDestination() {
  if (!supabase) {
    return { destination: "/", error: supabaseConfigurationError };
  }

  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const user = data.session?.user;
    if (!user) return { destination: "/", error: null };

    let { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) {
      const fallbackName =
        user.user_metadata?.display_name ||
        user.email?.split("@")[0] ||
        null;
      const recovered = await supabase
        .from("profiles")
        .upsert({ id: user.id, display_name: fallbackName })
        .select("*")
        .single();
      if (recovered.error) throw recovered.error;
      profile = recovered.data;
    }

    return {
      destination: decideAuthDestination({ hasSession: true, profile }),
      error: null,
    };
  } catch (error) {
    return {
      destination: "/",
      error: error?.message || "Unable to initialize your account.",
    };
  }
}

export async function completeAuthCallback(url) {
  if (!supabase) throw new Error(supabaseConfigurationError);
  const parsed = parseAuthCallbackUrl(url);
  if (parsed.kind === "error" || parsed.kind === "invalid") {
    throw new Error(parsed.message);
  }

  const result =
    parsed.kind === "pkce"
      ? await supabase.auth.exchangeCodeForSession(parsed.code)
      : await supabase.auth.setSession({
          access_token: parsed.accessToken,
          refresh_token: parsed.refreshToken,
        });

  if (result.error) throw result.error;
  return getAuthDestination();
}
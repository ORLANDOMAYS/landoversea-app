"use client";

import { getSupabase } from "./supabase";
import { decideAuthDestination } from "./auth-flow";

export async function getAuthDestination() {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const user = data.session?.user;
    if (!user) return { destination: "/auth" as const, error: null };

    let { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    if (!profile) {
      const recovered = await supabase
        .from("profiles")
        .upsert({
          id: user.id,
          display_name:
            user.user_metadata?.display_name ??
            user.email?.split("@")[0] ??
            null,
        })
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
      destination: "/auth" as const,
      error:
        error instanceof Error
          ? error.message
          : "Unable to initialize your account.",
    };
  }
}
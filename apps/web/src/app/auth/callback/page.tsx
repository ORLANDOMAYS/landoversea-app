"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "../../../lib/supabase";
import { getAuthDestination } from "../../../lib/auth-gate";
import { parseWebAuthCallback } from "../../../lib/auth-flow";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [state, setState] = useState<{
    status: "loading" | "success" | "error";
    message: string;
  }>({ status: "loading", message: "Signing you in..." });

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function complete() {
      try {
        const decision = parseWebAuthCallback(window.location.search);
        if (decision.kind !== "pkce") throw new Error(decision.message);
        const { error } = await getSupabase().auth.exchangeCodeForSession(
          decision.code
        );
        if (error) throw error;
        const result = await getAuthDestination();
        if (result.error) throw new Error(result.error);
        if (!active) return;
        setState({
          status: "success",
          message: "Sign-in successful. Redirecting...",
        });
        timer = setTimeout(() => router.replace(result.destination), 900);
      } catch (error) {
        if (!active) return;
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "This sign-in link is invalid or has expired.",
        });
      }
    }

    complete();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white border border-gray-100 shadow p-8 text-center">
        {state.status === "loading" && (
          <div className="w-12 h-12 border-4 border-pink-600 border-t-transparent rounded-full animate-spin mx-auto mb-5" />
        )}
        <h1 className="text-xl font-bold mb-3">
          {state.status === "error" ? "Sign-in link failed" : "Signing in"}
        </h1>
        <p className={state.status === "error" ? "text-red-700" : "text-gray-600"}>
          {state.message}
        </p>
        {state.status === "error" && (
          <button
            onClick={() => router.replace("/auth")}
            className="mt-6 px-6 py-3 bg-pink-600 text-white rounded-xl font-semibold"
          >
            Request a new link
          </button>
        )}
      </div>
    </main>
  );
}
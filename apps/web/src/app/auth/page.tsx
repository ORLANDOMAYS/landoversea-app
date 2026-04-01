"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, ArrowLeft } from "lucide-react";
import { supabase } from "../../lib/supabase";

export default function AuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);

  async function sendLink() {
    if (!email || sending) return;
    setSending(true);
    setStatus("Sending...");
    const { error } = await supabase.auth.signInWithOtp({ email });
    setSending(false);
    setStatus(error ? error.message : "Check your email for the login link!");
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-rose-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <button
          onClick={() => router.push("/")}
          className="flex items-center gap-1 text-gray-500 hover:text-gray-700 mb-8 transition"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100">
          <div className="flex items-center gap-2 mb-6">
            <img src="/logo.webp" alt="LandOverSea" className="h-20 w-auto" />
          </div>

          <h1 className="text-2xl font-bold mb-2">Welcome</h1>
          <p className="text-gray-500 mb-6">
            Enter your email to sign in or create an account.
          </p>

          <div className="space-y-4">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendLink()}
                placeholder="you@email.com"
                className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition"
              />
            </div>

            <button
              onClick={sendLink}
              disabled={sending || !email}
              className="w-full py-3 bg-pink-600 text-white rounded-xl font-semibold hover:bg-pink-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? "Sending..." : "Send Magic Link"}
            </button>
          </div>

          {status && (
            <div
              className={`mt-4 p-3 rounded-xl text-sm ${
                status.includes("Check your email")
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : status === "Sending..."
                    ? "bg-gray-50 text-gray-600"
                    : "bg-red-50 text-red-700 border border-red-200"
              }`}
            >
              {status}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

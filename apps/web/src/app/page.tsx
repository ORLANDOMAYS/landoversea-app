"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Shield, MapPin, MessageCircle, ArrowRight } from "lucide-react";
import { supabase } from "../lib/supabase";

export default function LandingPage() {
  const router = useRouter();
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setLoggedIn(true);
    });
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-pink-50">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <img src="/logo.webp" alt="LandOverSea" className="h-16 w-auto" />
        </div>
        <div className="flex gap-3">
          {loggedIn ? (
            <button
              onClick={() => router.push("/app")}
              className="px-5 py-2.5 bg-rose-600 text-white rounded-full font-medium hover:bg-rose-700 transition"
            >
              Open App
            </button>
          ) : (
            <>
              <button
                onClick={() => router.push("/auth")}
                className="px-5 py-2.5 border border-gray-300 rounded-full font-medium hover:bg-gray-50 transition"
              >
                Log In
              </button>
              <button
                onClick={() => router.push("/auth")}
                className="px-5 py-2.5 bg-rose-600 text-white rounded-full font-medium hover:bg-rose-700 transition"
              >
                Sign Up
              </button>
            </>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="text-center px-6 pt-20 pb-16 max-w-4xl mx-auto">
        <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 leading-tight mb-6">
          Love Has No <span className="text-rose-600">Borders</span>
        </h1>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-10">
          Connect with people worldwide. Chat in any language with real-time
          translation. Verify profiles with facial recognition. Date globally,
          feel locally.
        </p>
        <button
          onClick={() => router.push("/auth")}
          className="inline-flex items-center gap-2 px-8 py-4 bg-rose-600 text-white text-lg rounded-full font-semibold hover:bg-rose-700 transition shadow-lg shadow-rose-200"
        >
          Get Started <ArrowRight className="w-5 h-5" />
        </button>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-16 grid md:grid-cols-2 lg:grid-cols-4 gap-8">
        {[
          {
            icon: Globe,
            title: "Real-Time Translation",
            desc: "Chat in your language — they see theirs. Learn together while you connect.",
          },
          {
            icon: Shield,
            title: "Face Verification",
            desc: "Every profile verified with facial recognition. No catfishing, just real people.",
          },
          {
            icon: MapPin,
            title: "Multi-Location",
            desc: "Premium members can appear in up to 3 cities worldwide. Tokyo, Bangkok, New York — you choose.",
          },
          {
            icon: MessageCircle,
            title: "Smart Matching",
            desc: "Swipe, match, and chat. Our system helps you find meaningful connections across cultures.",
          },
        ].map((f) => (
          <div
            key={f.title}
            className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition"
          >
            <div className="w-12 h-12 bg-rose-100 rounded-xl flex items-center justify-center mb-4">
              <f.icon className="w-6 h-6 text-rose-600" />
            </div>
            <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
            <p className="text-gray-500 text-sm leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </section>

      {/* CTA */}
      <section className="text-center px-6 py-20">
        <h2 className="text-3xl font-bold mb-4">Ready to Find Your Match?</h2>
        <p className="text-gray-500 mb-8">
          Join thousands of people connecting across borders every day.
        </p>
        <button
          onClick={() => router.push("/auth")}
          className="px-8 py-4 bg-rose-600 text-white text-lg rounded-full font-semibold hover:bg-rose-700 transition shadow-lg shadow-rose-200"
        >
          Create Free Account
        </button>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 py-8 text-center text-sm text-gray-400">
        © {new Date().getFullYear()} LandOverSea. All rights reserved.
      </footer>
    </div>
  );
}

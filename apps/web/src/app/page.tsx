"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Shield, MapPin, MessageCircle, ArrowRight, Heart, Users, Lock, Smartphone } from "lucide-react";
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
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-3 max-w-7xl mx-auto">
        <a href="https://www.landoversea.net/" target="_blank" rel="noopener noreferrer">
          <img src="/logo.webp" alt="LandOverSea" className="h-16 md:h-20 w-auto" />
        </a>
        <div className="flex items-center gap-4">
          <a
            href="https://www.landoversea.net/"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:inline text-gray-600 hover:text-pink-600 font-medium transition"
          >
            Main Site
          </a>
          {loggedIn ? (
            <button
              onClick={() => router.push("/app")}
              className="px-6 py-2.5 bg-pink-600 text-white rounded-full font-semibold hover:bg-pink-700 transition shadow-md"
            >
              Open App
            </button>
          ) : (
            <>
              <button
                onClick={() => router.push("/auth")}
                className="px-5 py-2.5 text-gray-700 font-medium hover:text-pink-600 transition"
              >
                Log In
              </button>
              <button
                onClick={() => router.push("/auth")}
                className="px-6 py-2.5 bg-pink-600 text-white rounded-full font-semibold hover:bg-pink-700 transition shadow-md"
              >
                Sign Up
              </button>
            </>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="relative bg-gradient-to-br from-pink-500 via-rose-500 to-pink-600 text-white overflow-hidden">
        <div className="absolute inset-0 bg-black/20" />
        <div className="relative z-10 text-center px-6 py-24 md:py-36 max-w-5xl mx-auto">
          <img
            src="/logo.webp"
            alt="LandOverSea"
            className="h-32 md:h-44 lg:h-52 w-auto mx-auto mb-8 drop-shadow-2xl"
          />
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold leading-tight mb-6 drop-shadow-lg">
            Discover Connections<br />Beyond Borders
          </h1>
          <p className="text-lg md:text-2xl text-white/90 max-w-3xl mx-auto mb-10 leading-relaxed">
            Say goodbye to superficial connections and hello to meaningful
            friendships. Connect with people from all over the world while
            enjoying features tailored to your interests and needs.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={() => router.push("/auth")}
              className="inline-flex items-center justify-center gap-2 px-10 py-4 bg-white text-pink-600 text-lg rounded-full font-bold hover:bg-gray-100 transition shadow-xl"
            >
              Get Started <ArrowRight className="w-5 h-5" />
            </button>
            <a
              href="https://www.landoversea.net/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-10 py-4 border-2 border-white text-white text-lg rounded-full font-bold hover:bg-white/10 transition"
            >
              Visit Our Main Site
            </a>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="bg-gray-900 text-white py-6">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-around gap-4 text-center">
          <div>
            <p className="text-3xl font-extrabold text-pink-400">10,000+</p>
            <p className="text-sm text-gray-300 mt-1">Target Members Worldwide</p>
          </div>
          <div className="hidden md:block w-px h-10 bg-gray-700" />
          <div>
            <p className="text-3xl font-extrabold text-pink-400">50+</p>
            <p className="text-sm text-gray-300 mt-1">Languages Supported</p>
          </div>
          <div className="hidden md:block w-px h-10 bg-gray-700" />
          <div>
            <p className="text-3xl font-extrabold text-pink-400">100%</p>
            <p className="text-sm text-gray-300 mt-1">Profile Verified</p>
          </div>
        </div>
      </section>

      {/* Feature sections */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        {/* 1-on-1 Chat */}
        <div className="flex flex-col md:flex-row items-center gap-12 mb-24">
          <div className="flex-1">
            <div className="w-14 h-14 bg-pink-100 rounded-2xl flex items-center justify-center mb-5">
              <MessageCircle className="w-7 h-7 text-pink-600" />
            </div>
            <h2 className="text-3xl md:text-4xl font-extrabold text-gray-900 mb-4">
              1-on-1 Chat with Translation
            </h2>
            <p className="text-gray-600 text-lg leading-relaxed mb-4">
              Connect on a deeper level with our real-time chat feature. Messages
              are automatically translated so both people see their own language.
              Share travel plans, exchange ideas, and learn each other&apos;s
              language naturally.
            </p>
            <p className="text-pink-600 font-semibold text-lg">
              Powered by real-time AI translation
            </p>
          </div>
          <div className="flex-1 flex justify-center">
            <div className="w-72 h-96 bg-gradient-to-br from-pink-100 to-rose-50 rounded-3xl shadow-xl flex items-center justify-center">
              <MessageCircle className="w-20 h-20 text-pink-400" />
            </div>
          </div>
        </div>

        {/* Smart Matching */}
        <div className="flex flex-col md:flex-row-reverse items-center gap-12 mb-24">
          <div className="flex-1">
            <div className="w-14 h-14 bg-pink-100 rounded-2xl flex items-center justify-center mb-5">
              <Heart className="w-7 h-7 text-pink-600" />
            </div>
            <h2 className="text-3xl md:text-4xl font-extrabold text-gray-900 mb-4">
              Smart Matching
            </h2>
            <p className="text-gray-600 text-lg leading-relaxed mb-4">
              Swipe, match, and chat. Our system helps you find meaningful
              connections across cultures. Like someone? Swipe right. It&apos;s a
              match when they like you back.
            </p>
            <p className="text-pink-600 font-semibold text-lg">
              Targeting 10,000 members around the globe
            </p>
          </div>
          <div className="flex-1 flex justify-center">
            <div className="w-72 h-96 bg-gradient-to-br from-rose-100 to-pink-50 rounded-3xl shadow-xl flex items-center justify-center">
              <Heart className="w-20 h-20 text-pink-400" />
            </div>
          </div>
        </div>

        {/* Customizable Profiles */}
        <div className="flex flex-col md:flex-row items-center gap-12 mb-24">
          <div className="flex-1">
            <div className="w-14 h-14 bg-pink-100 rounded-2xl flex items-center justify-center mb-5">
              <Users className="w-7 h-7 text-pink-600" />
            </div>
            <h2 className="text-3xl md:text-4xl font-extrabold text-gray-900 mb-4">
              Customizable Profiles
            </h2>
            <p className="text-gray-600 text-lg leading-relaxed">
              Tailor your profile to reflect your individuality. From your bio
              and photos to your interests and preferences, our platform gives
              you the tools to personalize every aspect of your profile to make
              it uniquely yours.
            </p>
          </div>
          <div className="flex-1 flex justify-center">
            <div className="w-72 h-96 bg-gradient-to-br from-pink-100 to-rose-50 rounded-3xl shadow-xl flex items-center justify-center">
              <Users className="w-20 h-20 text-pink-400" />
            </div>
          </div>
        </div>

        {/* Privacy & Security */}
        <div className="flex flex-col md:flex-row-reverse items-center gap-12 mb-24">
          <div className="flex-1">
            <div className="w-14 h-14 bg-pink-100 rounded-2xl flex items-center justify-center mb-5">
              <Lock className="w-7 h-7 text-pink-600" />
            </div>
            <h2 className="text-3xl md:text-4xl font-extrabold text-gray-900 mb-4">
              Privacy &amp; Security
            </h2>
            <p className="text-gray-600 text-lg leading-relaxed">
              Your privacy is our priority. Our chat feature includes robust
              security measures to ensure that your conversations remain private
              and secure. Chat with confidence, knowing that your personal
              information is protected every step of the way.
            </p>
          </div>
          <div className="flex-1 flex justify-center">
            <div className="w-72 h-96 bg-gradient-to-br from-rose-100 to-pink-50 rounded-3xl shadow-xl flex items-center justify-center">
              <Lock className="w-20 h-20 text-pink-400" />
            </div>
          </div>
        </div>
      </section>

      {/* Full-width banner */}
      <section className="bg-gradient-to-r from-pink-500 to-rose-600 text-white py-16">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-5xl font-extrabold mb-4">
            Global Reach, Personalized Experience
          </h2>
          <p className="text-lg md:text-xl text-white/90 max-w-3xl mx-auto">
            Connect with people from all over the world while enjoying features
            tailored to your interests and needs.
          </p>
        </div>
      </section>

      {/* Feature cards */}
      <section className="max-w-6xl mx-auto px-6 py-20 grid md:grid-cols-2 lg:grid-cols-4 gap-8">
        {[
          {
            icon: Globe,
            title: "Real-Time Translation",
            desc: "Chat in your language \u2014 they see theirs. Learn together while you connect.",
          },
          {
            icon: Shield,
            title: "Identity Verification",
            desc: "Every profile verified with facial recognition. No catfishing, just real people.",
          },
          {
            icon: MapPin,
            title: "Multi-Location",
            desc: "Premium members can appear in up to 3 cities worldwide. Tokyo, Bangkok, New York \u2014 you choose.",
          },
          {
            icon: Smartphone,
            title: "Mobile & Web",
            desc: "Available on iOS, Android, and web. Your connections travel with you everywhere.",
          },
        ].map((f) => (
          <div
            key={f.title}
            className="bg-white rounded-2xl p-8 shadow-lg border border-gray-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
          >
            <div className="w-14 h-14 bg-pink-100 rounded-2xl flex items-center justify-center mb-5">
              <f.icon className="w-7 h-7 text-pink-600" />
            </div>
            <h3 className="text-xl font-bold mb-3">{f.title}</h3>
            <p className="text-gray-500 leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </section>

      {/* Testimonials */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-extrabold text-center text-gray-900 mb-16">
            What Our Members Say
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                quote: "LandOverSea has been a game-changer for me. The ability to connect with people from all over the world has opened my eyes to new perspectives and experiences.",
                title: "Changed My Social Perspective!",
              },
              {
                quote: "After trying out several apps with mixed results, I stumbled upon LandOverSea, and I'm so glad I did. LandOverSea has renewed my faith in online friendships!",
                title: "A Breath of Fresh Air!",
              },
              {
                quote: "I never imagined that I would find my soulmate through an app. But thanks to LandOverSea, that's exactly what happened. I'm eternally grateful!",
                title: "Found My Soulmate Across the Globe!",
              },
            ].map((t) => (
              <div
                key={t.title}
                className="bg-white rounded-2xl p-8 shadow-md border border-gray-100"
              >
                <div className="text-pink-500 text-5xl font-serif mb-4">&ldquo;</div>
                <h3 className="text-lg font-bold text-gray-900 mb-3">
                  &ldquo;{t.title}&rdquo;
                </h3>
                <p className="text-gray-500 leading-relaxed italic">
                  &ldquo;{t.quote}&rdquo;
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="text-center px-6 py-24 bg-white">
        <img
          src="/logo.webp"
          alt="LandOverSea"
          className="h-24 md:h-32 w-auto mx-auto mb-8"
        />
        <h2 className="text-3xl md:text-4xl font-extrabold text-gray-900 mb-4">
          Ready to Find Your Match?
        </h2>
        <p className="text-gray-500 text-lg mb-10 max-w-2xl mx-auto">
          Join thousands of people connecting across borders every day.
          Start your journey today.
        </p>
        <button
          onClick={() => router.push("/auth")}
          className="px-10 py-4 bg-pink-600 text-white text-lg rounded-full font-bold hover:bg-pink-700 transition shadow-xl shadow-pink-200"
        >
          Create Free Account
        </button>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-6 py-16 grid md:grid-cols-3 gap-12">
          <div>
            <img src="/logo.webp" alt="LandOverSea" className="h-20 w-auto mb-4" />
            <p className="text-pink-400 font-semibold text-lg mb-2">
              Discover Connections Beyond Borders
            </p>
          </div>
          <div>
            <h4 className="text-pink-400 font-bold text-lg mb-4 uppercase tracking-wide">Contact</h4>
            <p className="text-gray-300 mb-1">+1 (301) 379-0561</p>
            <p className="text-gray-300 mb-4">landoversea@landoversea.net</p>
            <a href="https://www.landoversea.net/" target="_blank" rel="noopener noreferrer" className="text-pink-400 hover:text-pink-300 font-medium transition">
              Visit landoversea.net &rarr;
            </a>
          </div>
          <div>
            <h4 className="text-pink-400 font-bold text-lg mb-4 uppercase tracking-wide">Address</h4>
            <p className="text-gray-300">611 South DuPont Highway</p>
            <p className="text-gray-300">Suite 102</p>
            <p className="text-gray-300">Delaware, Dover</p>
            <p className="text-gray-300">19901</p>
          </div>
        </div>
        <div className="border-t border-gray-800 py-6 text-center text-sm text-gray-500">
          &copy; {new Date().getFullYear()} LandOverSea. All rights reserved.
        </div>
      </footer>
    </div>
  );
}

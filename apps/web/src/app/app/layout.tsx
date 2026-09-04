"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { MessageCircle, User, Settings, Flame } from "lucide-react";
import { getSupabase } from "../../lib/supabase";
import { getAuthDestination } from "../../lib/auth-gate";

const NAV_ITEMS = [
  { href: "/app", icon: Flame, label: "Discover" },
  { href: "/app/matches", icon: MessageCircle, label: "Matches" },
  { href: "/app/profile", icon: User, label: "Profile" },
  { href: "/app/settings", icon: Settings, label: "Settings" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};

    getAuthDestination().then((result) => {
      if (!active) return;
      if (result.error) {
        setError(result.error);
        setLoading(false);
        return;
      }
      const current = `${pathname}${window.location.search}`;
      if (
        result.destination !== "/app" &&
        !current.startsWith("/app/profile")
      ) {
        router.replace(result.destination);
      } else if (result.destination === "/auth") {
        router.replace("/auth");
      } else {
        setLoading(false);
      }
    });

    try {
      const { data } = getSupabase().auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") router.replace("/auth");
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch {
      // Initialization above renders the explicit configuration error.
    }

    return () => {
      active = false;
      unsubscribe();
    };
  }, [pathname, router]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md text-center text-red-700">{error}</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <img src="/logo.webp" alt="LandOverSea" className="h-20 w-auto animate-pulse" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <img src="/logo.webp" alt="LandOverSea" className="h-12 w-auto" />
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">{children}</main>

      {/* Bottom nav */}
      <nav className="bg-white border-t border-gray-200 flex justify-around py-2 sticky bottom-0 z-50">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/app"
              ? pathname === "/app"
              : pathname.startsWith(item.href);
          return (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 transition ${
                isActive ? "text-pink-600" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              <item.icon className="w-5 h-5" fill={isActive ? "currentColor" : "none"} />
              <span className="text-xs font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";

export default function VerifyPage() {
  const router = useRouter();

  return (
    <div className="max-w-lg mx-auto px-4 py-10 text-center">
      <ShieldAlert className="w-20 h-20 text-blue-600 mx-auto mb-6" />
      <h1 className="text-2xl font-bold mb-3">Verification unavailable</h1>
      <p className="text-gray-500 mb-8">
        Identity verification is not available yet. We will not mark profiles
        as verified until a trusted verification provider is connected.
      </p>
      <button
        onClick={() => router.push("/app/profile")}
        className="px-8 py-3 bg-gray-800 text-white rounded-full font-semibold inline-flex items-center gap-2"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Profile
      </button>
    </div>
  );
}
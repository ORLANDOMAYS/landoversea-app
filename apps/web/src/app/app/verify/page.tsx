"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle, XCircle, ArrowLeft, Shield } from "lucide-react";
import { getCurrentUser, verifyProfile } from "../../../lib/api";

export default function VerifyPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [step, setStep] = useState<"intro" | "camera" | "processing" | "success" | "error">("intro");
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    getCurrentUser().then((user) => {
      if (user) setUserId(user.id);
    });
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

  async function startCamera() {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      setStep("camera");
    } catch {
      setStep("error");
    }
  }

  async function captureAndVerify() {
    if (!videoRef.current || !canvasRef.current || !userId) return;
    setStep("processing");

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setStep("error");
      return;
    }
    ctx.drawImage(video, 0, 0);

    // Stop camera
    stream?.getTracks().forEach((t) => t.stop());

    // Simple face detection using canvas analysis
    // Check if there's a face-like region (skin tone detection)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    let skinPixels = 0;
    const totalPixels = pixels.length / 4;

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];

      // Simple skin tone detection heuristic
      if (r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15 && r - b > 15) {
        skinPixels++;
      }
    }

    const skinRatio = skinPixels / totalPixels;

    // If at least 10% of the image has skin tones, consider it a face
    if (skinRatio > 0.1) {
      const success = await verifyProfile(userId);
      setStep(success ? "success" : "error");
    } else {
      setStep("error");
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-4">
      <button
        onClick={() => {
          stream?.getTracks().forEach((t) => t.stop());
          router.push("/app/profile");
        }}
        className="flex items-center gap-1 text-gray-500 hover:text-gray-700 mb-6 transition"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Profile
      </button>

      {step === "intro" && (
        <div className="text-center py-10">
          <Shield className="w-20 h-20 text-blue-600 mx-auto mb-6" />
          <h1 className="text-2xl font-bold mb-3">Verify Your Identity</h1>
          <p className="text-gray-500 mb-8 max-w-sm mx-auto">
            Take a selfie to verify your profile. This helps keep our community
            safe and catfish-free.
          </p>
          <button
            onClick={startCamera}
            className="px-8 py-3 bg-blue-600 text-white rounded-full font-semibold flex items-center gap-2 mx-auto hover:bg-blue-700 transition"
          >
            <Camera className="w-5 h-5" /> Start Verification
          </button>
        </div>
      )}

      {step === "camera" && (
        <div className="text-center">
          <h2 className="text-lg font-bold mb-4">Position your face in the frame</h2>
          <div className="relative inline-block rounded-2xl overflow-hidden mb-4">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full max-w-sm rounded-2xl"
            />
            <div className="absolute inset-0 border-4 border-blue-400 rounded-2xl pointer-events-none" />
          </div>
          <canvas ref={canvasRef} className="hidden" />
          <button
            onClick={captureAndVerify}
            className="px-8 py-3 bg-blue-600 text-white rounded-full font-semibold flex items-center gap-2 mx-auto hover:bg-blue-700 transition"
          >
            <Camera className="w-5 h-5" /> Take Photo
          </button>
        </div>
      )}

      {step === "processing" && (
        <div className="text-center py-10">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-6" />
          <h2 className="text-lg font-bold mb-2">Verifying...</h2>
          <p className="text-gray-500">Analyzing your photo for verification</p>
          <canvas ref={canvasRef} className="hidden" />
        </div>
      )}

      {step === "success" && (
        <div className="text-center py-10">
          <CheckCircle className="w-20 h-20 text-green-500 mx-auto mb-6" />
          <h2 className="text-2xl font-bold mb-3">Verified!</h2>
          <p className="text-gray-500 mb-8">
            Your profile is now verified. Other users will see a verification
            badge on your profile.
          </p>
          <button
            onClick={() => router.push("/app/profile")}
            className="px-8 py-3 bg-rose-600 text-white rounded-full font-semibold hover:bg-rose-700 transition"
          >
            Back to Profile
          </button>
        </div>
      )}

      {step === "error" && (
        <div className="text-center py-10">
          <XCircle className="w-20 h-20 text-red-500 mx-auto mb-6" />
          <h2 className="text-2xl font-bold mb-3">Verification Failed</h2>
          <p className="text-gray-500 mb-8">
            We could not detect a face. Please try again with good lighting and
            face the camera directly.
          </p>
          <button
            onClick={() => setStep("intro")}
            className="px-8 py-3 bg-blue-600 text-white rounded-full font-semibold hover:bg-blue-700 transition"
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}

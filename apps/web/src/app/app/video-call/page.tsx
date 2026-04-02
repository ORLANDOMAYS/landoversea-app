"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff } from "lucide-react";
import { getCurrentUser, updateVideoCallStatus } from "../../../lib/api";

function VideoCallContent() {
  const searchParams = useSearchParams();
  const callId = searchParams.get("callId");

  const [userId, setUserId] = useState<string | null>(null);
  const [callStatus, setCallStatus] = useState<"connecting" | "active" | "ended">("connecting");
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [duration, setDuration] = useState(0);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getCurrentUser().then((user) => {
      if (user) setUserId(user.id);
    });
  }, []);

  useEffect(() => {
    async function startCall() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        if (callId) {
          await updateVideoCallStatus(callId, "active", {
            started_at: new Date().toISOString(),
          });
        }

        setCallStatus("active");

        timerRef.current = setInterval(() => {
          setDuration((prev) => prev + 1);
        }, 1000);
      } catch {
        setCallStatus("ended");
      }
    }

    if (userId && callId) {
      startCall();
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [userId, callId]);

  async function endCall() {
    if (timerRef.current) clearInterval(timerRef.current);
    localStreamRef.current?.getTracks().forEach((t) => t.stop());

    if (callId) {
      await updateVideoCallStatus(callId, "ended", {
        ended_at: new Date().toISOString(),
        duration_seconds: duration,
      });
    }

    setCallStatus("ended");
    setTimeout(() => window.close(), 2000);
  }

  function toggleMute() {
    const stream = localStreamRef.current;
    if (stream) {
      stream.getAudioTracks().forEach((t) => {
        t.enabled = !t.enabled;
      });
      setIsMuted(!isMuted);
    }
  }

  function toggleVideo() {
    const stream = localStreamRef.current;
    if (stream) {
      stream.getVideoTracks().forEach((t) => {
        t.enabled = !t.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  }

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  if (callStatus === "ended") {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <PhoneOff className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Call Ended</h2>
          <p className="text-gray-400">Duration: {formatTime(duration)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Status bar */}
      <div className="flex items-center justify-center py-4">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${callStatus === "active" ? "bg-green-500 animate-pulse" : "bg-yellow-500 animate-pulse"}`} />
          <span className="text-white text-sm font-medium">
            {callStatus === "connecting" ? "Connecting..." : formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Video area */}
      <div className="flex-1 relative flex items-center justify-center">
        {/* Remote video placeholder */}
        <div className="w-full max-w-2xl aspect-video bg-gray-800 rounded-2xl flex items-center justify-center mx-4">
          <div className="text-center">
            <Video className="w-16 h-16 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Waiting for peer connection...</p>
            <p className="text-gray-600 text-xs mt-1">WebRTC signaling in progress</p>
          </div>
        </div>

        {/* Local video (picture-in-picture) */}
        <div className="absolute bottom-4 right-4 w-40 aspect-video rounded-xl overflow-hidden border-2 border-white/20 shadow-xl">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          {isVideoOff && (
            <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
              <VideoOff className="w-6 h-6 text-gray-500" />
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-6 py-8">
        <button
          onClick={toggleMute}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition ${
            isMuted ? "bg-red-500/20 text-red-400" : "bg-white/10 text-white hover:bg-white/20"
          }`}
        >
          {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>

        <button
          onClick={endCall}
          className="w-16 h-16 rounded-full bg-red-600 flex items-center justify-center text-white hover:bg-red-700 transition"
        >
          <Phone className="w-7 h-7 rotate-[135deg]" />
        </button>

        <button
          onClick={toggleVideo}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition ${
            isVideoOff ? "bg-red-500/20 text-red-400" : "bg-white/10 text-white hover:bg-white/20"
          }`}
        >
          {isVideoOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
        </button>
      </div>
    </div>
  );
}

export default function VideoCallPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-900 flex items-center justify-center">
          <div className="animate-pulse text-white">Loading...</div>
        </div>
      }
    >
      <VideoCallContent />
    </Suspense>
  );
}

"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, Send, Globe } from "lucide-react";
import {
  getCurrentUser,
  getMessages,
  sendMessage,
  subscribeToMessages,
  getProfile,
  getMatches,
} from "../../../lib/api";
import { translateText } from "../../../lib/translate";
import type { Message, Profile, MatchWithProfile } from "../../../lib/types";
import { LANGUAGES } from "../../../lib/types";

function ChatContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const matchId = searchParams.get("matchId");

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [otherProfile, setOtherProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!matchId) return;

    getCurrentUser().then(async (user) => {
      if (!user) return;
      setUserId(user.id);

      const [profile, msgs, matches] = await Promise.all([
        getProfile(user.id),
        getMessages(matchId),
        getMatches(user.id),
      ]);

      setMyProfile(profile);
      setMessages(msgs);

      const match = matches.find((m: MatchWithProfile) => m.id === matchId);
      if (match?.profile) {
        setOtherProfile(match.profile);
      }

      setLoading(false);
    });
  }, [matchId]);

  // Real-time subscription
  useEffect(() => {
    if (!matchId || !userId) return;

    const channel = subscribeToMessages(matchId, (newMsg) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === newMsg.id)) return prev;
        return [...prev, newMsg];
      });
    });

    return () => {
      channel.unsubscribe();
    };
  }, [matchId, userId]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || !userId || !matchId || sending) return;
    setSending(true);

    const myLang = myProfile?.language ?? "en";
    const otherLang = otherProfile?.language ?? "en";
    const body = input.trim();

    let translated: string | undefined;
    if (myLang !== otherLang) {
      translated = await translateText(body, myLang, otherLang);
    }

    setInput("");
    await sendMessage(matchId, userId, body, myLang, translated);
    setSending(false);
  }

  if (!matchId) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <p className="text-gray-500">No chat selected</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <div className="animate-pulse text-rose-600">Loading chat...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] max-w-lg mx-auto">
      {/* Chat header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200">
        <button onClick={() => router.push("/app/matches")} className="text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <img
          src={
            otherProfile?.avatar_url ??
            `https://ui-avatars.com/api/?name=${encodeURIComponent(otherProfile?.display_name ?? "?")}&background=f43f5e&color=fff`
          }
          alt={otherProfile?.display_name ?? "User"}
          className="w-10 h-10 rounded-full object-cover"
        />
        <div className="flex-1">
          <p className="font-semibold text-gray-900">{otherProfile?.display_name ?? "Match"}</p>
          {otherProfile?.language && otherProfile.language !== (myProfile?.language ?? "en") && (
            <p className="text-xs text-gray-500 flex items-center gap-1">
              <Globe className="w-3 h-3" />
              Speaks {LANGUAGES[otherProfile.language] ?? otherProfile.language}
            </p>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-10">
            <p className="text-gray-400">No messages yet. Say hello!</p>
          </div>
        )}

        {messages.map((msg) => {
          const isMine = msg.sender_id === userId;
          return (
            <div key={msg.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] ${isMine ? "items-end" : "items-start"}`}>
                <div
                  className={`px-4 py-2.5 rounded-2xl text-sm ${
                    isMine
                      ? "bg-rose-600 text-white rounded-br-md"
                      : "bg-white text-gray-900 border border-gray-200 rounded-bl-md"
                  }`}
                >
                  {msg.body}
                </div>

                {/* Translation */}
                {msg.translated_body && msg.translated_body !== msg.body && (
                  <div
                    className={`mt-1 px-3 py-1.5 rounded-xl text-xs ${
                      isMine
                        ? "bg-rose-100 text-rose-700"
                        : "bg-blue-50 text-blue-700"
                    }`}
                  >
                    <Globe className="w-3 h-3 inline mr-1" />
                    {msg.translated_body}
                    {msg.sender_language && (
                      <span className="ml-1 opacity-60">
                        ({LANGUAGES[msg.sender_language] ?? msg.sender_language})
                      </span>
                    )}
                  </div>
                )}

                <p className="text-[10px] text-gray-400 mt-0.5 px-1">
                  {new Date(msg.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 bg-white border-t border-gray-200">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2.5 bg-gray-100 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="w-10 h-10 rounded-full bg-rose-600 flex items-center justify-center text-white hover:bg-rose-700 transition disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-[70vh]">
          <div className="animate-pulse text-rose-600">Loading...</div>
        </div>
      }
    >
      <ChatContent />
    </Suspense>
  );
}

import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'wouter';
import {
  useSendAiCoachMessage,
  useGetAiCoachHistory,
  useGetMySubscription,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft,
  Bot,
  CheckCircle,
  ArrowUp,
  Loader2,
} from 'lucide-react';
import { Link } from 'wouter';

const QUICK_PROMPTS = [
  '🌍 Japanese etiquette',
  '💬 Practice Korean',
  '❓ Ask about culture',
  '💌 Help write a message',
  '🗺️ Travel tips',
];

const FEATURES = [
  'Cultural coaching tailored to your connections',
  'Language practice with real-time feedback',
  '24/7 AI-powered dating & communication tips',
];

export default function AiCoach() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: subscription } = useGetMySubscription();
  const { data: history, refetch } = useGetAiCoachHistory();
  const sendMutation = useSendAiCoachMessage();

  const isPremium = subscription?.status === 'active';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, sendMutation.isPending]);

  const handleSend = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || sendMutation.isPending) return;
    setInput('');
    await sendMutation.mutateAsync({ data: { message } });
    refetch();
  };

  const handlePromptClick = (prompt: string) => {
    setInput(prompt);
    handleSend(prompt);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col">
      {/* Header */}
      <div
        className="sticky top-0 z-40 px-4 py-3 flex items-center gap-3"
        style={{
          background: 'var(--nav-bg)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--nav-border)',
        }}
      >
        <button onClick={() => navigate('/coaches')} className="w-9 h-9 rounded-full glass flex items-center justify-center shrink-0">
          <ChevronLeft className="w-5 h-5 text-foreground" />
        </button>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center shrink-0">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-serif text-foreground text-lg leading-tight">Luna</h1>
            <p className="text-muted-foreground text-xs">AI Cultural Coach</p>
          </div>
        </div>
      </div>

      {!isPremium ? (
        /* Non-premium gate */
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="glass rounded-3xl p-8 max-w-sm w-full text-center">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center mx-auto mb-4">
              <Bot className="w-10 h-10 text-white" />
            </div>
            <h2 className="font-serif text-foreground text-2xl mb-2">Meet Luna, Your AI Coach</h2>
            <p className="text-muted-foreground text-sm mb-6">Unlock AI-powered cultural coaching with a premium plan.</p>
            <div className="space-y-3 mb-6 text-left">
              {FEATURES.map(f => (
                <div key={f} className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                  <span className="text-foreground text-sm">{f}</span>
                </div>
              ))}
            </div>
            <Link href="/premium">
              <button className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full">
                Upgrade to Chat
              </button>
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Quick Prompts */}
          <div className="px-4 py-3 overflow-x-auto">
            <div className="flex gap-2 w-max">
              {QUICK_PROMPTS.map(p => (
                <button
                  key={p}
                  onClick={() => handlePromptClick(p)}
                  className="glass border border-border rounded-full px-4 py-2 hover:glass-strong transition-all text-foreground text-sm whitespace-nowrap"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Chat Area */}
          <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3 pb-24">
            {/* Welcome if no history */}
            {(!history || history.length === 0) && !sendMutation.isPending && (
              <div className="flex justify-start">
                <div className="glass rounded-2xl rounded-tl-sm p-4 max-w-[80%]">
                  <p className="text-foreground text-sm">
                    Hi! I'm Luna, your AI Cultural Coach 🌸 Ask me about Japanese etiquette, help writing messages, language practice, or anything cross-cultural!
                  </p>
                  <p className="text-muted-foreground text-xs mt-1">Luna · now</p>
                </div>
              </div>
            )}

            {history?.map(msg => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' ? (
                  <div className="glass rounded-2xl rounded-tl-sm p-4 max-w-[80%]">
                    <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                    <p className="text-muted-foreground text-xs mt-1">
                      Luna · {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                ) : (
                  <div
                    className="rounded-2xl rounded-tr-sm p-4 max-w-[80%]"
                    style={{ background: 'linear-gradient(135deg, #FF2D7A, #8B5CF6)' }}
                  >
                    <p className="text-brand-surface-foreground text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                    <p className="text-brand-surface-foreground text-xs mt-1">
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                )}
              </div>
            ))}

            {/* Loading dots */}
            <AnimatePresence>
              {sendMutation.isPending && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="flex justify-start"
                >
                  <div className="glass rounded-2xl rounded-tl-sm p-4">
                    <div className="flex gap-1 items-center h-4">
                      {[0, 1, 2].map(i => (
                        <motion.div
                          key={i}
                          className="w-2 h-2 rounded-full bg-white/60"
                          animate={{ scale: [1, 1.4, 1], opacity: [0.5, 1, 0.5] }}
                          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                        />
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>

          {/* Bottom input bar */}
          <div
            className="fixed bottom-0 left-0 right-0 z-50 px-4 py-3 flex items-center gap-3"
            style={{
              background: 'var(--nav-bg)',
              backdropFilter: 'blur(20px)',
              borderTop: '1px solid var(--nav-border)',
            }}
          >
            <input
              type="text"
              placeholder="Ask Luna anything..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
              className="glass-input flex-1 rounded-full px-4 py-2 outline-none placeholder:text-placeholder placeholder:opacity-100 text-sm"
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || sendMutation.isPending}
              className="btn-glow w-10 h-10 rounded-full flex items-center justify-center shrink-0 disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
            >
              {sendMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowUp className="w-4 h-4" />
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

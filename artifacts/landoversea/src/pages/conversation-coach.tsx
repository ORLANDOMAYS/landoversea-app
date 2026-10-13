import { useState } from 'react';
import { useLocation } from 'wouter';
import {
  useSendAiCoachMessage,
  useGetAiCoachHistory,
} from '@workspace/api-client-react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, MessageSquare, Copy, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type Tone = 'Friendly' | 'Romantic' | 'Playful' | 'Professional';
const TONES: Tone[] = ['Friendly', 'Romantic', 'Playful', 'Professional'];

interface Suggestion {
  reply: string;
}

export default function ConversationCoach() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [pastedText, setPastedText] = useState('');
  const [tone, setTone] = useState<Tone>('Friendly');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [parseError, setParseError] = useState(false);

  const sendMutation = useSendAiCoachMessage();
  const { refetch: refetchHistory } = useGetAiCoachHistory();

  const handleGetSuggestions = async () => {
    if (!pastedText.trim()) return;
    setParseError(false);
    setSuggestions([]);

    const prompt = `Generate 3 ${tone} reply suggestions for this message received on a cross-cultural dating app: '${pastedText}'. Reply as JSON array [{reply:'...'},{reply:'...'},{reply:'...'}] ONLY.`;
    try {
      await sendMutation.mutateAsync({ data: { message: prompt } });
      const { data: historyData } = await refetchHistory();
      const messages = historyData || [];
      // Find the latest assistant message
      const latest = [...messages].reverse().find(m => m.role === 'assistant');
      if (!latest) throw new Error('No response');

      // Parse JSON from response
      const content = latest.content.trim();
      // Try to extract JSON array from the content
      const match = content.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('No JSON found');
      const parsed: Suggestion[] = JSON.parse(match[0]);
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Invalid format');
      setSuggestions(parsed.slice(0, 3));
    } catch {
      setParseError(true);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: 'Copied!' });
    });
  };

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      {/* Header */}
      <div
        className="sticky top-0 z-40 px-4 py-3 flex items-center gap-3"
        style={{
          background: 'var(--nav-bg)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--nav-border)',
        }}
      >
        <button onClick={() => navigate('/coaches')} className="w-9 h-9 rounded-full glass flex items-center justify-center">
          <ChevronLeft className="w-5 h-5 text-foreground" />
        </button>
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-primary" />
          <h1 className="font-serif text-xl text-foreground">Conversation Coach</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Subtitle */}
        <p className="text-muted-foreground text-sm">
          Paste a message and get 3 culturally-aware reply suggestions
        </p>

        {/* Paste textarea */}
        <div className="space-y-2">
          <label className="text-foreground text-sm font-medium">Their Message</label>
          <textarea
            rows={4}
            placeholder="Paste their message here..."
            value={pastedText}
            onChange={e => setPastedText(e.target.value)}
            className="glass-input rounded-2xl p-3 w-full resize-none outline-none placeholder:text-muted-foreground text-sm"
          />
        </div>

        {/* Tone selector */}
        <div className="space-y-2">
          <label className="text-foreground text-sm font-medium">Tone</label>
          <div className="flex flex-wrap gap-2">
            {TONES.map(t => (
              <button
                key={t}
                onClick={() => setTone(t)}
                className={`px-4 py-2 rounded-full text-sm transition-all ${
                  tone === t
                    ? 'bg-primary/20 border border-primary text-primary'
                    : 'glass border border-border text-foreground hover:glass-strong'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={handleGetSuggestions}
          disabled={!pastedText.trim() || sendMutation.isPending}
          className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
        >
          {sendMutation.isPending ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Generating...
            </span>
          ) : (
            'Get Suggestions'
          )}
        </button>

        {/* Loading skeletons */}
        {sendMutation.isPending && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="glass h-20 rounded-2xl animate-pulse" />
            ))}
          </div>
        )}

        {/* Error */}
        {parseError && !sendMutation.isPending && (
          <div className="glass rounded-2xl p-4 border border-red-500/30 text-center">
            <p className="text-red-400 text-sm mb-2">Couldn't parse suggestions. Please try again.</p>
            <button
              onClick={handleGetSuggestions}
              className="glass border border-border rounded-full px-4 py-2 text-foreground text-sm hover:glass-strong transition-all"
            >
              Retry
            </button>
          </div>
        )}

        {/* Results */}
        <AnimatePresence>
          {suggestions.length > 0 && !sendMutation.isPending && (
            <div className="space-y-3">
              {suggestions.map((s, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  transition={{ delay: i * 0.12 }}
                  className="glass-strong rounded-2xl p-4 relative"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-primary text-xs font-medium">Suggestion {i + 1}</span>
                    <button
                      onClick={() => handleCopy(s.reply)}
                      className="w-7 h-7 rounded-full glass flex items-center justify-center shrink-0"
                    >
                      <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  </div>
                  <p className="text-foreground text-sm leading-relaxed">{s.reply}</p>
                </motion.div>
              ))}
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

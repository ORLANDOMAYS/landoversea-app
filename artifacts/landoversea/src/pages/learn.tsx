import { useState, useRef, useEffect } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetLanguageStreak,
  useGetLanguageQuizzes,
  useGetMySubscription,
  useSendAiCoachMessage,
  useGetAiCoachHistory,
  getGetAiCoachHistoryQueryKey,
} from '@workspace/api-client-react';
import {
  BookOpen, Flame, Bot, Mic, Globe, Trophy, Loader2, Send, Lock,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const PRACTICE_TYPES = [
  { label: 'Vocabulary', icon: BookOpen, color: 'text-secondary', bg: 'bg-secondary/10', border: 'border-secondary/20', category: 'vocabulary' },
  { label: 'Pronunciation', icon: Mic, color: 'text-accent', bg: 'bg-accent/10', border: 'border-accent/20', category: 'comprehension' },
  { label: 'Grammar', icon: BookOpen, color: 'text-orange-400', bg: 'bg-orange-400/10', border: 'border-orange-400/20', category: 'grammar' },
  { label: 'Phrases', icon: Globe, color: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/20', category: 'cultural' },
];

function getDifficultyLabel(diff?: string) {
  if (diff === 'beginner') return { label: 'Beginner', color: 'text-green-400 bg-green-400/10 border-green-400/20' };
  if (diff === 'intermediate') return { label: 'Intermediate', color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' };
  if (diff === 'advanced') return { label: 'Advanced', color: 'text-red-400 bg-red-400/10 border-red-400/20' };
  return { label: 'Mixed', color: 'text-muted-foreground bg-muted border-border' };
}

export default function LearnPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const { data: streak, isLoading: streakLoading } = useGetLanguageStreak();
  const { data: quizzes, isLoading: quizzesLoading } = useGetLanguageQuizzes();
  const { data: subscription } = useGetMySubscription();
  const { data: history, isLoading: historyLoading } = useGetAiCoachHistory();

  const isPremium = (subscription as any)?.isPremium || (subscription as any)?.status === 'active';

  const sendMessage = useSendAiCoachMessage({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAiCoachHistoryQueryKey() });
        setChatInput('');
      },
      onError: () => {
        toast({ title: 'Error', description: 'Could not send message.', variant: 'destructive' });
      },
    },
  });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const xpTotal = streak?.xpTotal ?? 0;
  const xpProgress = xpTotal % 100;
  const quizzesArray = Array.isArray(quizzes) ? quizzes : [];
  const historyArray = Array.isArray(history) ? history : [];
  const firstQuizId = quizzesArray[0]?.id;

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    sendMessage.mutate({ data: { message: chatInput.trim() } });
  };

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      <div className="max-w-lg mx-auto px-4 pt-4 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="font-serif text-2xl text-foreground">Language Lab</h1>
          {streakLoading ? (
            <div className="glass rounded-full px-4 py-1.5 text-orange-400 text-sm flex items-center gap-1">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : (
            <div className="glass rounded-full px-4 py-1.5 text-orange-400 text-sm font-semibold flex items-center gap-1.5 border border-orange-400/20">
              <Flame className="w-4 h-4 fill-orange-400" />
              🔥 {streak?.currentStreak ?? 0} Day Streak
            </div>
          )}
        </div>

        {/* Daily Quiz */}
        <div
          className="glass-strong rounded-3xl p-5 relative overflow-hidden"
          style={{ borderLeft: '4px solid #FF2D7A' }}
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
          <div className="flex items-start gap-3 mb-4 relative z-10">
            <BookOpen className="w-8 h-8 text-primary flex-shrink-0" />
            <div>
              <h2 className="font-serif text-xl text-foreground">Daily Quiz</h2>
              <p className="text-muted-foreground text-sm">Earn XP • Beat your streak</p>
            </div>
          </div>
          {/* XP Progress */}
          <div className="relative z-10 mb-4">
            <div className="h-2 glass rounded-full overflow-hidden mb-1">
              <div
                className="h-2 rounded-full"
                style={{
                  width: `${xpProgress}%`,
                  background: 'linear-gradient(90deg, #FF2D7A, #63E6FF)',
                }}
              />
            </div>
            <p className="text-muted-foreground text-xs">{xpTotal} XP total</p>
          </div>
          <div className="relative z-10">
            {quizzesLoading ? (
              <div className="flex items-center justify-center py-2">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              </div>
            ) : firstQuizId ? (
              <Link
                href={`/learn/quiz/${firstQuizId}`}
                className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full inline-flex items-center justify-center"
              >
                Start Quiz →
              </Link>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-2">No daily quiz is available right now.</p>
            )}
          </div>
        </div>

        {/* Practice Types 2x2 */}
        <div>
          <h2 className="font-serif text-xl text-foreground mb-3">Practice Types</h2>
          <div className="grid grid-cols-2 gap-3">
            {PRACTICE_TYPES.map((type) => {
              const Icon = type.icon;
              const matchingQuiz = quizzesArray.find((q) => q.category === type.category);
              const content = (
                <>
                  <div className={`w-10 h-10 rounded-xl ${type.bg} flex items-center justify-center`}>
                    <Icon className={`w-5 h-5 ${type.color}`} />
                  </div>
                  <p className="text-foreground font-semibold text-sm">{type.label}</p>
                </>
              );
              return matchingQuiz ? (
                <Link
                  key={type.label}
                  href={`/learn/quiz/${matchingQuiz.id}`}
                  className={`glass rounded-2xl p-4 flex flex-col gap-2 text-left border ${type.border} hover:glass-strong transition-all`}
                  aria-label={`Start ${type.label} practice`}
                >
                  {content}
                </Link>
              ) : (
                <div
                  key={type.label}
                  className={`glass rounded-2xl p-4 flex flex-col gap-2 text-left border ${type.border} opacity-60`}
                >
                  {content}
                  <p className="text-muted-foreground text-xs">No practice available</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* AI Practice */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-serif text-xl text-foreground">Practice with AI</h2>
            <Bot className="w-5 h-5 text-secondary" />
          </div>

          {isPremium ? (
            <div className="glass rounded-2xl overflow-hidden">
              {/* Messages */}
              <div className="p-4 h-48 overflow-y-auto space-y-3">
                {historyLoading ? (
                  <div className="flex justify-center items-center h-full">
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  </div>
                ) : historyArray.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2">
                    <Bot className="w-8 h-8 text-secondary" />
                    <p className="text-muted-foreground text-sm text-center">Start a conversation with your AI language coach!</p>
                  </div>
                ) : (
                  <>
                    {historyArray.slice(-6).map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`rounded-2xl px-3 py-2 max-w-[80%] text-sm ${
                            msg.role === 'user'
                              ? 'btn-glow text-white'
                              : 'glass text-foreground'
                          }`}
                        >
                          {msg.content}
                        </div>
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </>
                )}
              </div>

              {/* Input row */}
              <div className="border-t border-border p-3 flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Type in any language..."
                  className="glass-input rounded-full px-4 py-2 flex-1 outline-none placeholder:text-muted-foreground text-sm"
                />
                <button
                  className="btn-glow w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                  onClick={handleSendMessage}
                  disabled={sendMessage.isPending || !chatInput.trim()}
                >
                  {sendMessage.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="glass rounded-2xl p-6 text-center">
              <div className="w-12 h-12 glass rounded-full flex items-center justify-center mx-auto mb-3">
                <Lock className="w-6 h-6 text-secondary" />
              </div>
              <h3 className="font-serif text-lg text-foreground mb-2">Premium Feature</h3>
              <p className="text-muted-foreground text-sm mb-4">
                Unlock AI-powered language coaching with a premium subscription.
              </p>
              <Link href="/premium" className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full inline-flex items-center justify-center">
                Upgrade to Premium
              </Link>
            </div>
          )}
        </div>

        {/* Quiz Library */}
        <div>
          <h2 className="font-serif text-xl text-foreground mb-3">Quiz Library</h2>
          {quizzesLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : quizzesArray.length === 0 ? (
            <div className="glass rounded-2xl p-6 text-center">
              <p className="text-muted-foreground text-sm">No quizzes available yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {quizzesArray.map((quiz) => {
                const diff = getDifficultyLabel(quiz.difficulty);
                return (
                  <div key={quiz.id} className="glass rounded-2xl p-3 flex gap-3 items-center">
                    <div className="w-10 h-10 glass rounded-xl flex items-center justify-center flex-shrink-0">
                      <BookOpen className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground font-semibold text-sm truncate">{quiz.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs border ${diff.color}`}>
                          {diff.label}
                        </span>
                        <span className="text-muted-foreground text-xs">{quiz.questionCount} questions</span>
                      </div>
                    </div>
                    <Link
                      href={`/learn/quiz/${quiz.id}`}
                      className="glass border border-border rounded-full px-3 py-1.5 text-foreground text-xs hover:glass-strong transition-all flex-shrink-0 inline-flex items-center"
                    >
                      Start
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Language Leaders link */}
        <Link href="/leaderboard">
          <div className="glass rounded-2xl p-4 flex items-center justify-between hover:glass-strong transition-all cursor-pointer">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 glass rounded-xl flex items-center justify-center">
                <Trophy className="w-5 h-5 text-yellow-400" />
              </div>
              <div>
                <p className="text-foreground font-semibold">Language Leaders 🏆</p>
                <p className="text-muted-foreground text-xs">See the global leaderboard</p>
              </div>
            </div>
            <span className="text-muted-foreground text-lg">›</span>
          </div>
        </Link>

      </div>
    </div>
  );
}

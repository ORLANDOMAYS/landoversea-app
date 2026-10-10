import { useState, useEffect } from 'react';
import { resolveMediaUrl } from '@/lib/media-url';
import { useLocation } from 'wouter';
import {
  useSendAiCoachMessage,
  useGetAiCoachHistory,
} from '@workspace/api-client-react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, UserCheck, Lightbulb, Loader2 } from 'lucide-react';
import { useLiveProfile } from '@/hooks/use-supabase-surfaces';

interface SectionFeedback {
  section: string;
  score: number;
  feedback: string;
}

interface ProfileAnalysis {
  grade: string;
  score: number;
  sections: SectionFeedback[];
  topTip: string;
}

const GRADE_COLORS: Record<string, string> = {
  A: 'text-cyan-400',
  B: 'text-primary',
  C: 'text-yellow-400',
  D: 'text-red-400',
};

function computeFallback(profile: any): ProfileAnalysis {
  const photosScore = Math.min(100, (profile?.photos?.length || 0) * 25);
  const bioScore = Math.min(100, (profile?.bio?.length || 0) / 2);
  const interestsScore = Math.min(100, (profile?.interests?.length || 0) * 12);
  const langScore = Math.min(100, ((profile?.otherLanguages?.length || 0) + 1) * 25);

  const total = Math.round((photosScore + bioScore + interestsScore + langScore) / 4);
  const grade = total >= 80 ? 'A' : total >= 65 ? 'B' : total >= 50 ? 'C' : 'D';

  return {
    grade,
    score: total,
    sections: [
      { section: 'Photos', score: photosScore, feedback: photosScore < 50 ? 'Add more photos to attract more connections.' : 'Great photo selection!' },
      { section: 'Bio', score: Math.round(bioScore), feedback: bioScore < 50 ? 'Write a longer, more personal bio.' : 'Your bio reads well!' },
      { section: 'Interests', score: interestsScore, feedback: interestsScore < 50 ? 'Add more cultural interests.' : 'Nice range of interests!' },
      { section: 'Languages', score: langScore, feedback: langScore < 50 ? 'List more languages you speak.' : 'Language skills are attractive!' },
    ],
    topTip: total < 70
      ? 'Complete your profile fully — profiles with photos and a detailed bio get 3x more matches.'
      : 'You have a strong profile! Keep adding cultural details to stand out.',
  };
}

export default function ProfileCoach() {
  const [, navigate] = useLocation();
  const [analyzed, setAnalyzed] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [analysis, setAnalysis] = useState<ProfileAnalysis | null>(null);

  const { data: profile } = useLiveProfile();
  const sendMutation = useSendAiCoachMessage();
  const { refetch: refetchHistory } = useGetAiCoachHistory();

  useEffect(() => {
    if (!analyzing) return;
    setProgress(0);
    const interval = setInterval(() => {
      setProgress(p => {
        if (p >= 90) { clearInterval(interval); return 90; }
        return p + Math.random() * 12;
      });
    }, 200);
    return () => clearInterval(interval);
  }, [analyzing]);

  const handleAnalyze = async () => {
    if (!profile) return;
    setAnalyzing(true);
    setAnalyzed(false);

    const prompt = `Analyze this dating profile and return JSON only: {"grade":"A/B/C/D","score":0-100,"sections":[{"section":"Photos","score":0-100,"feedback":"..."},{"section":"Bio","score":0-100,"feedback":"..."},{"section":"Interests","score":0-100,"feedback":"..."},{"section":"Languages","score":0-100,"feedback":"..."}],"topTip":"..."}.
Profile: Name: ${profile.name}, Age: ${profile.age || 'N/A'}, Bio: ${profile.bio || 'None'}, Interests: ${(profile.interests || []).join(', ') || 'None'}, Languages: ${[(profile.primaryLanguage || ''), ...(profile.otherLanguages || [])].filter(Boolean).join(', ') || 'None'}, Photos: ${profile.photos?.length || 0}, Country: ${profile.country || 'N/A'}.`;

    try {
      await sendMutation.mutateAsync({ data: { message: prompt } });
      const { data: historyData } = await refetchHistory();
      const messages = historyData || [];
      const latest = [...messages].reverse().find(m => m.role === 'assistant');
      if (!latest) throw new Error('No response');
      const match = latest.content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON');
      const parsed: ProfileAnalysis = JSON.parse(match[0]);
      setAnalysis(parsed);
    } catch {
      setAnalysis(computeFallback(profile));
    } finally {
      setProgress(100);
      setTimeout(() => {
        setAnalyzing(false);
        setAnalyzed(true);
      }, 500);
    }
  };

  const firstPhoto = profile?.photos?.[0]?.url;

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
          <UserCheck className="w-5 h-5 text-cyan-400" />
          <h1 className="font-serif text-xl text-foreground">Profile Coach</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Profile Preview */}
        <div className="glass rounded-3xl p-4">
          {firstPhoto ? (
            <img src={resolveMediaUrl(firstPhoto)} alt="profile" className="w-full h-36 rounded-2xl object-cover mb-3" />
          ) : (
            <div className="w-full h-36 rounded-2xl mb-3 bg-gradient-to-br from-violet-600/40 to-pink-600/40 flex items-center justify-center">
              <UserCheck className="w-10 h-10 text-muted-foreground" />
            </div>
          )}
          <div className="mb-2">
            <p className="font-serif text-foreground text-lg">
              {profile?.name || 'Your Name'}{profile?.age ? `, ${profile.age}` : ''}
            </p>
            {profile?.bio && (
              <p className="text-foreground text-sm line-clamp-2 mt-1">{profile.bio}</p>
            )}
          </div>
          {profile?.interests && profile.interests.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {profile.interests.slice(0, 5).map(interest => (
                <span key={interest} className="px-2 py-0.5 glass rounded-full text-xs text-muted-foreground border border-border">
                  {interest}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Analyze Button */}
        {!analyzed && (
          <button
            onClick={handleAnalyze}
            disabled={analyzing || !profile}
            className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
          >
            {analyzing ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Analyzing...
              </span>
            ) : 'Analyze My Profile'}
          </button>
        )}

        {/* Progress */}
        {analyzing && (
          <div className="glass rounded-2xl p-4 text-center space-y-3">
            <p className="text-foreground text-sm">Analyzing your profile...</p>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${progress}%`,
                  background: 'linear-gradient(90deg, #FF2D7A, #8B5CF6)',
                }}
              />
            </div>
            <p className="text-muted-foreground text-xs">{Math.round(progress)}%</p>
          </div>
        )}

        {/* Results */}
        <AnimatePresence>
          {analyzed && analysis && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              {/* Score Card */}
              <div className="glass-strong rounded-3xl p-6 text-center">
                <span className={`font-script text-6xl ${GRADE_COLORS[analysis.grade] || 'text-foreground'}`}>
                  {analysis.grade}
                </span>
                <p className="font-serif text-foreground text-xl mt-2">{analysis.score}/100</p>
                <p className="text-muted-foreground text-sm mt-1">Profile Score</p>
              </div>

              {/* Section Feedback */}
              {analysis.sections?.map((s, i) => (
                <motion.div
                  key={s.section}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="glass rounded-2xl p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-serif text-foreground text-base">{s.section}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      s.score >= 80 ? 'bg-cyan-500/20 text-cyan-400' :
                      s.score >= 60 ? 'bg-primary/20 text-primary' :
                      s.score >= 40 ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>
                      {s.score}/100
                    </span>
                  </div>
                  <p className="text-foreground text-sm">{s.feedback}</p>
                </motion.div>
              ))}

              {/* Top Tip */}
              {analysis.topTip && (
                <div className="glass-strong rounded-2xl p-4 border border-primary/40 glow-pink">
                  <div className="flex items-center gap-2 mb-2">
                    <Lightbulb className="w-5 h-5 text-yellow-400" />
                    <span className="font-serif text-foreground text-base">Top Tip</span>
                  </div>
                  <p className="text-foreground text-sm leading-relaxed">{analysis.topTip}</p>
                </div>
              )}

              {/* Re-analyze */}
              <div className="text-center">
                <button
                  onClick={() => { setAnalyzed(false); setAnalysis(null); }}
                  className="text-primary text-sm hover:text-primary transition-colors"
                >
                  Re-analyze
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useParams, Link } from 'wouter';
import { useGetLanguageQuiz, useSubmitQuizAttempt } from '@workspace/api-client-react';
import { Loader2, ChevronLeft, Trophy, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function QuizView() {
  const { quizId } = useParams<{ quizId: string }>();
  const id = parseInt(quizId ?? '', 10);
  const { data: quizData, isLoading, isError } = useGetLanguageQuiz(id);
  const submitMutation = useSubmitQuizAttempt();
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [result, setResult] = useState<any>(null);
  const questions = quizData?.questions ?? [];

  if (!Number.isInteger(id)) return <div className="glass rounded-2xl p-6 text-foreground">Invalid Quiz ID</div>;

  const handleSelect = (qId: number, answer: string) => {
    setAnswers(prev => ({ ...prev, [qId]: answer }));
  };

  const handleNext = () => {
    if (step < questions.length - 1) {
      setStep(s => s + 1);
    } else {
      // Submit
      submitMutation.mutate({
        quizId: id,
        data: {
          answers: Object.entries(answers).map(([qId, ans]) => ({ questionId: parseInt(qId), answer: ans as string }))
        }
      }, {
        onSuccess: (res) => {
          setResult(res);
        },
        onError: () => {
          toast({ title: 'Quiz submission failed', description: 'Your answers were not saved. Please try again.', variant: 'destructive' });
        }
      });
    }
  };

  if (isLoading) {
    return <div className="min-h-[50vh] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (isError || !quizData || questions.length === 0) {
    return (
      <div className="glass rounded-3xl p-8 text-center max-w-lg mx-auto">
        <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
        <h2 className="font-serif text-xl text-foreground mb-2">Quiz unavailable</h2>
        <p className="text-muted-foreground text-sm mb-5">This quiz could not be loaded. Choose another lesson and try again.</p>
        <Link href="/learn" className="btn-glow inline-flex px-6 py-2 rounded-full">Back to Lab</Link>
      </div>
    );
  }

  if (result) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6 animate-in zoom-in-95">
        <div className={`glass w-24 h-24 rounded-full flex items-center justify-center`}>
          {result.passed
            ? <Trophy className="w-12 h-12 text-cyan-400" />
            : <AlertCircle className="w-12 h-12 text-red-400" />}
        </div>
        <div>
          <h2 className="font-serif text-3xl text-foreground mb-2">
            {result.passed ? 'Quiz Passed!' : 'Keep Practicing!'}
          </h2>
          <p className="text-muted-foreground text-sm">You scored {result.score} out of {result.total}.</p>
        </div>
        {result.passed && (
          <div className="glass rounded-2xl px-5 py-3 inline-flex items-center gap-2">
            <span className="font-bold text-cyan-400">+{result.xpEarned} XP</span> Earned
          </div>
        )}
        <Link href="/learn">
          <button className="btn-glow px-8 py-3 text-white font-semibold rounded-full mt-8">
            Back to Lab
          </button>
        </Link>
      </div>
    );
  }

  const currentQ = questions[step];

  return (
    <div className="max-w-xl mx-auto px-4 space-y-8 pt-4 pb-24">
      {/* Progress row */}
      <div className="flex items-center gap-4">
        <Link href="/learn">
          <button className="w-9 h-9 rounded-full glass flex items-center justify-center">
            <ChevronLeft className="w-5 h-5 text-foreground" />
          </button>
        </Link>
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${(step / questions.length) * 100}%` }}
          />
        </div>
        <span className="text-sm text-muted-foreground">{step + 1}/{questions.length}</span>
      </div>

      {/* Question card */}
      <div className="glass rounded-3xl p-8 border border-border space-y-6">
        <h2 className="font-serif text-xl text-foreground text-center">{currentQ.text}</h2>

        <div className="space-y-3">
          {currentQ.options.map(opt => {
            const isSelected = answers[currentQ.id] === opt;
            return (
              <button
                key={opt}
                onClick={() => handleSelect(currentQ.id, opt)}
                aria-pressed={isSelected}
                className={`w-full p-4 rounded-2xl border-2 text-left transition-all text-sm ${
                  isSelected
                    ? 'border-primary bg-primary text-primary-foreground font-medium'
                    : 'glass border-border text-foreground hover:border-border'
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </div>

      {/* Next / Finish button */}
      <div className="flex justify-end">
        <button
          onClick={handleNext}
          disabled={!answers[currentQ.id] || submitMutation.isPending}
          className="btn-glow px-8 py-3 text-white font-semibold rounded-full disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none w-full"
        >
          {submitMutation.isPending
            ? <Loader2 className="w-5 h-5 animate-spin mx-auto" />
            : (step === questions.length - 1 ? 'Finish' : 'Next')}
        </button>
      </div>
    </div>
  );
}

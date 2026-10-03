import { useState, useEffect, useRef } from 'react';
import { useGetMyProfile, useUploadVoiceIntro, useDeleteVoiceIntro } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, Link } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, Mic, Loader2, PlayCircle, PauseCircle,
  Trash2, RefreshCw, Upload, AlertCircle
} from 'lucide-react';

type RecordState = 'idle' | 'recording' | 'recorded';

const MAX_SECONDS = 30;

export default function VoiceIntro() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: profile, isLoading } = useGetMyProfile();
  const uploadMutation = useUploadVoiceIntro();
  const deleteMutation = useDeleteVoiceIntro();

  const [state, setState] = useState<RecordState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [barHeights, setBarHeights] = useState<number[]>(Array(20).fill(4));

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobEvent['data'][]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const barAnimRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (barAnimRef.current) clearInterval(barAnimRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicDenied(false);
      chunksRef.current = [];
      setSeconds(0);

      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;

      mr.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        const b = new Blob(chunksRef.current, { type: 'audio/webm' });
        setBlob(b);
        const url = URL.createObjectURL(b);
        setAudioUrl(url);
        setState('recorded');
        stream.getTracks().forEach(t => t.stop());
      };

      mr.start(100);
      setState('recording');

      timerRef.current = setInterval(() => {
        setSeconds(s => {
          if (s + 1 >= MAX_SECONDS) {
            stopRecording();
            return MAX_SECONDS;
          }
          return s + 1;
        });
      }, 1000);

      barAnimRef.current = setInterval(() => {
        setBarHeights(Array(20).fill(0).map(() => Math.floor(Math.random() * 28) + 4));
      }, 100);
    } catch {
      setMicDenied(true);
    }
  };

  const stopRecording = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (barAnimRef.current) { clearInterval(barAnimRef.current); barAnimRef.current = null; }
    setBarHeights(Array(20).fill(4));
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleReRecord = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setBlob(null);
    setSeconds(0);
    setIsPlaying(false);
    setState('idle');
    setBarHeights(Array(20).fill(4));
  };

  const togglePlay = () => {
    if (!audioRef.current || !audioUrl) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleUpload = () => {
    if (!blob) return;
    const file = new File([blob], 'voice-intro.webm', { type: 'audio/webm' });
    uploadMutation.mutate(
      { data: { audio: file as unknown as string } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/profiles/me'] });
          toast({ title: 'Voice intro uploaded!' });
          setLocation('/profile');
        },
        onError: (err: any) => {
          toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
        },
      }
    );
  };

  const handleDelete = () => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/profiles/me'] });
        toast({ title: 'Voice intro deleted' });
      },
      onError: (err: any) => {
        toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
      },
    });
  };

  const formatTime = (s: number) => `0:${String(s).padStart(2, '0')}`;

  const existingVoiceUrl = profile?.voiceIntroUrl;

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      {/* Header */}
      <header
        className="sticky top-0 z-40 flex items-center gap-3 px-4 py-3"
        style={{
          background: 'var(--nav-bg)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--nav-border)',
        }}
      >
        <Link href="/profile">
          <button className="w-9 h-9 rounded-full glass flex items-center justify-center">
            <ChevronLeft className="w-5 h-5 text-foreground" />
          </button>
        </Link>
        <h1 className="font-serif text-xl text-foreground flex-1">Voice Introduction</h1>
        <Mic className="w-5 h-5 text-primary" />
      </header>

      <div className="max-w-lg mx-auto px-4 pt-6 space-y-6">
        {isLoading && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}

        {!isLoading && (
          <>
            {/* Explanation */}
            <p className="text-muted-foreground text-center text-sm px-4">
              Record up to 30 seconds introducing yourself. A great voice intro helps you stand out!
            </p>

            {/* Mic Permission Denied */}
            {micDenied && (
              <div className="glass rounded-2xl p-5 flex items-start gap-3 border border-red-500/30">
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-foreground font-medium">Microphone access denied</p>
                  <p className="text-muted-foreground text-sm mt-1">
                    Please allow microphone access in your browser settings, then try again.
                  </p>
                </div>
              </div>
            )}

            {/* Existing Voice Intro */}
            {existingVoiceUrl && state === 'idle' && (
              <div className="glass rounded-2xl p-5 space-y-3">
                <h2 className="font-serif text-lg text-foreground">Your Current Voice Intro</h2>
                <audio
                  ref={audioRef}
                  src={existingVoiceUrl}
                  onEnded={() => setIsPlaying(false)}
                  className="hidden"
                />
                <div className="flex items-center gap-3">
                  <button onClick={togglePlay} className="w-10 h-10 rounded-full glass-strong flex items-center justify-center">
                    {isPlaying
                      ? <PauseCircle className="w-6 h-6 text-foreground" />
                      : <PlayCircle className="w-6 h-6 text-foreground" />
                    }
                  </button>
                  <div className="flex-1 h-1 bg-muted rounded-full" />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleReRecord}
                    className="glass border border-border rounded-full px-4 py-2 hover:glass-strong transition-all text-foreground text-sm flex items-center gap-2 flex-1 justify-center"
                  >
                    <RefreshCw className="w-4 h-4" /> Replace
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleteMutation.isPending}
                    className="glass border border-red-500/40 text-red-400 rounded-full px-4 py-2 hover:bg-red-500/10 transition-all text-sm flex items-center gap-2 flex-1 justify-center disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
                  >
                    {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    Delete
                  </button>
                </div>
              </div>
            )}

            {/* Recording UI */}
            {(state === 'idle' || state === 'recording') && !existingVoiceUrl && (
              <div className="glass rounded-2xl p-6 flex flex-col items-center gap-6">
                {/* Waveform */}
                <div className="flex items-end gap-0.5 h-10">
                  {barHeights.map((h, i) => (
                    <div
                      key={i}
                      className="w-1 rounded-full bg-primary/60 transition-all duration-75"
                      style={{ height: `${h}px` }}
                    />
                  ))}
                </div>

                {/* Record Button */}
                <motion.button
                  onClick={state === 'idle' ? startRecording : stopRecording}
                  className={`w-28 h-28 rounded-full flex flex-col items-center justify-center gap-2 transition-all ${
                    state === 'recording'
                      ? 'bg-red-500/20 border border-red-500/40'
                      : 'glass-strong glow-pink'
                  }`}
                  animate={state === 'recording' ? { scale: [1, 1.05, 1] } : { scale: 1 }}
                  transition={state === 'recording' ? { repeat: Infinity, duration: 1 } : {}}
                >
                  <Mic className={`w-8 h-8 ${state === 'recording' ? 'text-red-400' : 'text-primary'}`} />
                  <span className={`text-xs font-medium ${state === 'recording' ? 'text-red-400' : 'text-foreground'}`}>
                    {state === 'recording' ? 'Tap to stop' : 'Tap to record'}
                  </span>
                </motion.button>

                {/* Timer */}
                <p className="font-mono text-muted-foreground text-lg">
                  {formatTime(seconds)} / {formatTime(MAX_SECONDS)}
                </p>
              </div>
            )}

            {/* Also show recording UI for existing when replacing */}
            {(state === 'idle' || state === 'recording') && existingVoiceUrl && (
              <div className="glass rounded-2xl p-6 flex flex-col items-center gap-6">
                <div className="flex items-end gap-0.5 h-10">
                  {barHeights.map((h, i) => (
                    <div
                      key={i}
                      className="w-1 rounded-full bg-primary/60 transition-all duration-75"
                      style={{ height: `${h}px` }}
                    />
                  ))}
                </div>

                <motion.button
                  onClick={state === 'idle' ? startRecording : stopRecording}
                  className={`w-28 h-28 rounded-full flex flex-col items-center justify-center gap-2 transition-all ${
                    state === 'recording'
                      ? 'bg-red-500/20 border border-red-500/40'
                      : 'glass-strong glow-pink'
                  }`}
                  animate={state === 'recording' ? { scale: [1, 1.05, 1] } : { scale: 1 }}
                  transition={state === 'recording' ? { repeat: Infinity, duration: 1 } : {}}
                >
                  <Mic className={`w-8 h-8 ${state === 'recording' ? 'text-red-400' : 'text-primary'}`} />
                  <span className={`text-xs font-medium ${state === 'recording' ? 'text-red-400' : 'text-foreground'}`}>
                    {state === 'recording' ? 'Tap to stop' : 'Record new'}
                  </span>
                </motion.button>

                <p className="font-mono text-muted-foreground text-lg">
                  {formatTime(seconds)} / {formatTime(MAX_SECONDS)}
                </p>
              </div>
            )}

            {/* Recorded / Playback State */}
            <AnimatePresence>
              {state === 'recorded' && blob && audioUrl && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="glass rounded-2xl p-5 space-y-4"
                >
                  <h2 className="font-serif text-lg text-foreground text-center">Preview</h2>

                  {/* Waveform static */}
                  <div className="flex items-end justify-center gap-0.5 h-10">
                    {Array(20).fill(0).map((_, i) => (
                      <div
                        key={i}
                        className="w-1 rounded-full bg-primary/40"
                        style={{ height: `${4 + (i % 5) * 5}px` }}
                      />
                    ))}
                  </div>

                  <audio
                    ref={audioRef}
                    src={audioUrl}
                    onEnded={() => setIsPlaying(false)}
                    className="hidden"
                  />

                  <div className="flex items-center gap-3">
                    <button
                      onClick={togglePlay}
                      className="w-11 h-11 rounded-full glass-strong flex items-center justify-center"
                    >
                      {isPlaying
                        ? <PauseCircle className="w-6 h-6 text-foreground" />
                        : <PlayCircle className="w-6 h-6 text-foreground" />
                      }
                    </button>
                    <span className="font-mono text-muted-foreground text-sm">{formatTime(seconds)}</span>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={handleReRecord}
                      className="glass border border-border rounded-full px-4 py-2.5 hover:glass-strong transition-all text-foreground text-sm flex items-center gap-2 flex-1 justify-center"
                    >
                      <RefreshCw className="w-4 h-4" /> Re-record
                    </button>
                    <button
                      onClick={handleUpload}
                      disabled={uploadMutation.isPending}
                      className="btn-glow px-4 py-2.5 text-white font-semibold rounded-full flex items-center gap-2 flex-1 justify-center disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
                    >
                      <Upload className="w-4 h-4" /> Upload
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Uploading overlay state */}
            {uploadMutation.isPending && (
              <div className="glass rounded-2xl p-6 flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-muted-foreground text-sm">Uploading your voice intro...</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

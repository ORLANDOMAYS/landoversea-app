import { useEffect, useState } from 'react';
import { PhoneOff, Video } from 'lucide-react';
import { useLocation } from 'wouter';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/i18n';
import {
  getLatestIncomingVideoCall,
  removeVideoCallChannel,
  setVideoCallStatus,
  subscribeToIncomingVideoCalls,
  type VideoCall,
} from '@/lib/video-calls';

export default function IncomingVideoCall() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [location, setLocation] = useLocation();
  const [incomingCall, setIncomingCall] = useState<VideoCall | null>(null);
  const [declining, setDeclining] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;

    void getLatestIncomingVideoCall(user.id)
      .then((call) => {
        if (active) setIncomingCall(call);
      })
      .catch((error: unknown) => {
        console.error('Could not check incoming video calls', error);
      });

    const channel = subscribeToIncomingVideoCalls(user.id, (call) => {
      if (!active) return;
      if (call.status === 'ringing') {
        setIncomingCall(call);
      } else {
        setIncomingCall((current) => (current?.id === call.id ? null : current));
      }
    });

    return () => {
      active = false;
      void removeVideoCallChannel(channel);
    };
  }, [user?.id]);

  if (!incomingCall || location.startsWith('/video-call/')) return null;

  const decline = async () => {
    if (declining) return;
    setDeclining(true);
    try {
      await setVideoCallStatus(incomingCall.id, 'declined');
      setIncomingCall(null);
    } catch (error) {
      console.error('Could not decline video call', error);
    } finally {
      setDeclining(false);
    }
  };

  return (
    <aside
      role="dialog"
      aria-label={t('videoCall.incomingTitle')}
      className="fixed inset-x-4 top-[max(1rem,env(safe-area-inset-top))] z-[80] mx-auto max-w-md rounded-2xl border border-cyan-400/30 bg-slate-950/95 p-4 text-white shadow-2xl shadow-cyan-950/50 backdrop-blur-2xl"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-cyan-400 shadow-lg shadow-cyan-500/20">
          <Video className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{t('videoCall.incomingTitle')}</h2>
          <p className="mt-0.5 text-sm text-slate-300">{t('videoCall.incomingBody')}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={decline}
          disabled={declining}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white/10 px-4 font-semibold text-white transition-colors hover:bg-white/15 disabled:opacity-50"
        >
          <PhoneOff className="h-4 w-4" />
          {t('videoCall.decline')}
        </button>
        <button
          type="button"
          onClick={() => setLocation(`/video-call/${incomingCall.id}`)}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 font-semibold text-slate-950 transition-colors hover:bg-cyan-300"
        >
          <Video className="h-4 w-4" />
          {t('videoCall.join')}
        </button>
      </div>
    </aside>
  );
}
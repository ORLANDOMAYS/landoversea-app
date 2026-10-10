import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Loader2, Mic, MicOff, PhoneOff } from 'lucide-react';
import { useLocation, useParams } from 'wouter';
import BrandLogo from '@/components/brand/BrandLogo';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth';
import {
  getVideoCall,
  listVideoCallSignals,
  removeVideoCallChannel,
  sendVideoCallSignal,
  setVideoCallStatus,
  subscribeToVideoCall,
  type VideoCall,
  type VideoCallSignal,
} from '@/lib/video-calls';

type CallPhase =
  | 'loading'
  | 'requesting_media'
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'declined'
  | 'ended'
  | 'missed'
  | 'error';

type SignalPayload = {
  sessionId?: unknown;
  type?: unknown;
  sdp?: unknown;
  candidate?: unknown;
  sdpMid?: unknown;
  sdpMLineIndex?: unknown;
  usernameFragment?: unknown;
};

type BufferedCandidate = {
  sessionId: string;
  candidate: RTCIceCandidateInit;
};

function makeSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function asCandidate(payload: SignalPayload): RTCIceCandidateInit | null {
  if (typeof payload.candidate !== 'string') return null;
  return {
    candidate: payload.candidate,
    sdpMid: typeof payload.sdpMid === 'string' ? payload.sdpMid : null,
    sdpMLineIndex:
      typeof payload.sdpMLineIndex === 'number' ? payload.sdpMLineIndex : null,
    usernameFragment:
      typeof payload.usernameFragment === 'string'
        ? payload.usernameFragment
        : null,
  };
}

export default function VideoCallPage() {
  const { callId } = useParams<{ callId: string }>();
  const { user } = useAuth();
  const { t } = useI18n();
  const [, setLocation] = useLocation();
  const translateRef = useRef(t);
  translateRef.current = t;

  const [call, setCall] = useState<VideoCall | null>(null);
  const [phase, setPhase] = useState<CallPhase>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [remoteVideoVisible, setRemoteVideoVisible] = useState(false);
  const [microphoneMuted, setMicrophoneMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const leavingRef = useRef(false);

  const stopPeerMedia = useCallback(() => {
    const connection = peerConnectionRef.current;
    if (connection) {
      connection.onicecandidate = null;
      connection.ontrack = null;
      connection.onconnectionstatechange = null;
      connection.close();
      peerConnectionRef.current = null;
    }
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setRemoteVideoVisible(false);
  }, []);

  useEffect(() => {
    if (!callId || !user?.id) return;
    let disposed = false;
    let currentCall: VideoCall | null = null;
    let channel: ReturnType<typeof subscribeToVideoCall> | null = null;
    let subscribedTimeout: number | null = null;
    const processedSignals = new Set<number>();
    const pendingRemoteCandidates: BufferedCandidate[] = [];
    const pendingLocalCandidates: BufferedCandidate[] = [];
    let currentSessionId: string | null = null;
    let localDescriptionPublished = false;
    let signalChain: Promise<void> = Promise.resolve();

    const failCall = (message: string) => {
      if (disposed) return;
      setErrorMessage(message);
      setPhase('error');
      stopPeerMedia();
    };

    const flushRemoteCandidates = async (
      connection: RTCPeerConnection,
      sessionId: string,
    ) => {
      const matches = pendingRemoteCandidates.filter(
        (entry) => entry.sessionId === sessionId,
      );
      for (const entry of matches) {
        await connection.addIceCandidate(entry.candidate);
      }
      for (let index = pendingRemoteCandidates.length - 1; index >= 0; index -= 1) {
        if (pendingRemoteCandidates[index].sessionId === sessionId) {
          pendingRemoteCandidates.splice(index, 1);
        }
      }
    };

    const publishLocalCandidate = async (entry: BufferedCandidate) => {
      await sendVideoCallSignal(callId, 'ice_candidate', {
        ...entry.candidate,
        sessionId: entry.sessionId,
      });
    };

    const markLocalDescriptionPublished = async (sessionId: string) => {
      localDescriptionPublished = true;
      const matches = pendingLocalCandidates.filter(
        (entry) => entry.sessionId === sessionId,
      );
      for (const entry of matches) await publishLocalCandidate(entry);
      for (let index = pendingLocalCandidates.length - 1; index >= 0; index -= 1) {
        if (pendingLocalCandidates[index].sessionId === sessionId) {
          pendingLocalCandidates.splice(index, 1);
        }
      }
    };

    const queueSignal = (
      signal: VideoCallSignal,
      connection: RTCPeerConnection,
      isCaller: boolean,
    ) => {
      if (processedSignals.has(signal.id) || signal.sender_id === user.id) return;
      processedSignals.add(signal.id);

      signalChain = signalChain.then(async () => {
        if (disposed) return;
        const payload = signal.payload as SignalPayload;
        const sessionId =
          typeof payload.sessionId === 'string' ? payload.sessionId : null;
        if (!sessionId) return;

        if (
          signal.signal_type === 'offer'
          && !isCaller
          && payload.type === 'offer'
          && typeof payload.sdp === 'string'
        ) {
          currentSessionId = sessionId;
          localDescriptionPublished = false;
          await connection.setRemoteDescription({
            type: 'offer',
            sdp: payload.sdp,
          });
          await flushRemoteCandidates(connection, sessionId);
          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);
          const localDescription = connection.localDescription;
          if (!localDescription) throw new Error('Could not create a call answer.');
          await sendVideoCallSignal(callId, 'answer', {
            type: localDescription.type,
            sdp: localDescription.sdp,
            sessionId,
          });
          await markLocalDescriptionPublished(sessionId);
          setPhase('connecting');
          return;
        }

        if (
          signal.signal_type === 'answer'
          && isCaller
          && sessionId === currentSessionId
          && payload.type === 'answer'
          && typeof payload.sdp === 'string'
        ) {
          await connection.setRemoteDescription({
            type: 'answer',
            sdp: payload.sdp,
          });
          await flushRemoteCandidates(connection, sessionId);
          setPhase('connecting');
          return;
        }

        if (signal.signal_type === 'ice_candidate') {
          const candidate = asCandidate(payload);
          if (!candidate) return;
          if (sessionId !== currentSessionId || !connection.remoteDescription) {
            pendingRemoteCandidates.push({ sessionId, candidate });
            return;
          }
          await connection.addIceCandidate(candidate);
        }
      }).catch((error: unknown) => {
        console.error('Video signal processing failed', error);
        failCall(translateRef.current('videoCall.failed'));
      });
    };

    const start = async () => {
      try {
        setPhase('loading');
        currentCall = await getVideoCall(callId);
        if (disposed) return;
        setCall(currentCall);

        if (
          currentCall.status === 'declined'
          || currentCall.status === 'ended'
          || currentCall.status === 'missed'
        ) {
          setPhase(currentCall.status);
          return;
        }

        if (
          !navigator.mediaDevices?.getUserMedia
          || typeof RTCPeerConnection === 'undefined'
        ) {
          throw new Error(translateRef.current('videoCall.unsupported'));
        }

        const isCaller = currentCall.caller_id === user.id;
        setPhase('requesting_media');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: true,
        });
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        const connection = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        peerConnectionRef.current = connection;
        stream.getTracks().forEach((track) => connection.addTrack(track, stream));

        connection.ontrack = (event) => {
          const [remoteStream] = event.streams;
          if (remoteStream && remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
            setRemoteVideoVisible(true);
          }
        };

        connection.onconnectionstatechange = () => {
          if (disposed) return;
          if (connection.connectionState === 'connected') {
            setPhase('connected');
          } else if (
            connection.connectionState === 'connecting'
            || connection.connectionState === 'disconnected'
          ) {
            setPhase('connecting');
          } else if (connection.connectionState === 'failed') {
            failCall(translateRef.current('videoCall.failed'));
          }
        };

        connection.onicecandidate = (event) => {
          if (!event.candidate || !currentSessionId) return;
          const entry = {
            sessionId: currentSessionId,
            candidate: event.candidate.toJSON(),
          };
          if (!localDescriptionPublished) {
            pendingLocalCandidates.push(entry);
          } else {
            void publishLocalCandidate(entry).catch((error: unknown) => {
              console.error('Could not publish ICE candidate', error);
              failCall(translateRef.current('videoCall.failed'));
            });
          }
        };

        const subscribed = new Promise<void>((resolve, reject) => {
          channel = subscribeToVideoCall(
            callId,
            (updatedCall) => {
              if (disposed) return;
              currentCall = updatedCall;
              setCall(updatedCall);
              if (
                updatedCall.status === 'declined'
                || updatedCall.status === 'ended'
                || updatedCall.status === 'missed'
              ) {
                setPhase(updatedCall.status);
                stopPeerMedia();
              } else if (updatedCall.status === 'active') {
                setPhase((current) =>
                  current === 'connected' ? current : 'connecting',
                );
              }
            },
            (signal) => queueSignal(signal, connection, isCaller),
            (status, error) => {
              if (status === 'SUBSCRIBED') resolve();
              if (
                status === 'CHANNEL_ERROR'
                || status === 'TIMED_OUT'
                || status === 'CLOSED'
              ) {
                reject(error ?? new Error('Video signaling connection failed.'));
              }
            },
          );
          subscribedTimeout = window.setTimeout(
            () => reject(new Error('Video signaling connection timed out.')),
            10_000,
          );
        });
        await subscribed;
        if (subscribedTimeout !== null) window.clearTimeout(subscribedTimeout);

        if (!isCaller && currentCall.status === 'ringing') {
          await setVideoCallStatus(callId, 'active');
          currentCall = { ...currentCall, status: 'active' };
          setCall(currentCall);
          setPhase('connecting');
        } else {
          setPhase(currentCall.status === 'active' ? 'connecting' : 'ringing');
        }

        const existingSignals = await listVideoCallSignals(callId);
        existingSignals.forEach((signal) => queueSignal(signal, connection, isCaller));
        await signalChain;

        if (isCaller) {
          currentSessionId = makeSessionId();
          localDescriptionPublished = false;
          const offer = await connection.createOffer();
          await connection.setLocalDescription(offer);
          const localDescription = connection.localDescription;
          if (!localDescription) throw new Error('Could not create a call offer.');
          await sendVideoCallSignal(callId, 'offer', {
            type: localDescription.type,
            sdp: localDescription.sdp,
            sessionId: currentSessionId,
          });
          await markLocalDescriptionPublished(currentSessionId);
        }
      } catch (error) {
        const message =
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? translateRef.current('videoCall.permissionError')
            : error instanceof Error
              ? error.message
              : translateRef.current('videoCall.failed');
        if (currentCall && currentCall.status !== 'declined' && currentCall.status !== 'ended') {
          const failedStatus =
            currentCall.receiver_id === user.id ? 'declined' : 'ended';
          void setVideoCallStatus(currentCall.id, failedStatus).catch(() => undefined);
        }
        failCall(message);
      }
    };

    void start();

    return () => {
      disposed = true;
      if (subscribedTimeout !== null) window.clearTimeout(subscribedTimeout);
      if (channel) void removeVideoCallChannel(channel);
      stopPeerMedia();
    };
  }, [callId, stopPeerMedia, user?.id]);

  useEffect(() => {
    if (
      (phase !== 'declined' && phase !== 'ended' && phase !== 'missed')
      || !call?.match_id
    ) return;
    const timer = window.setTimeout(
      () => setLocation(`/messages/${call.match_id}`),
      1_800,
    );
    return () => window.clearTimeout(timer);
  }, [call?.match_id, phase, setLocation]);

  const toggleMicrophone = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicrophoneMuted(!track.enabled);
  };

  const toggleCamera = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraOff(!track.enabled);
  };

  const returnToChat = () => {
    const destination = call?.match_id ? `/messages/${call.match_id}` : '/messages';
    setLocation(destination);
  };

  const endCall = async () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    try {
      if (
        call
        && call.status !== 'declined'
        && call.status !== 'ended'
        && call.status !== 'missed'
      ) {
        await setVideoCallStatus(call.id, 'ended');
      }
    } catch (error) {
      console.error('Could not update video call status', error);
    } finally {
      stopPeerMedia();
      returnToChat();
    }
  };

  const statusLabel =
    phase === 'ringing'
      ? t('videoCall.waiting')
      : phase === 'connected'
        ? t('videoCall.connected')
        : phase === 'declined'
          ? t('videoCall.declined')
          : phase === 'ended' || phase === 'missed'
            ? t('videoCall.ended')
            : t('videoCall.connecting');

  if (phase === 'loading' || phase === 'requesting_media') {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-slate-950 px-6 text-white">
        <BrandLogo className="mb-8 h-20 w-full max-w-xs" monochrome />
        <Loader2 className="h-8 w-8 animate-spin text-cyan-300" />
        <p className="mt-4 text-sm text-slate-300">
          {phase === 'requesting_media'
            ? t('videoCall.requestingMedia')
            : t('videoCall.connecting')}
        </p>
      </main>
    );
  }

  if (phase === 'error') {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-slate-950 px-6 text-center text-white">
        <CameraOff className="h-12 w-12 text-rose-400" />
        <h1 className="mt-5 text-2xl font-semibold">{t('videoCall.failed')}</h1>
        <p className="mt-2 max-w-md text-slate-300">{errorMessage}</p>
        <button
          type="button"
          onClick={returnToChat}
          className="mt-8 min-h-12 rounded-xl bg-white px-6 font-semibold text-slate-950"
        >
          {t('videoCall.returnToChat')}
        </button>
      </main>
    );
  }

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-slate-950 text-white">
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className={`absolute inset-0 h-full w-full object-cover transition-opacity ${
          remoteVideoVisible ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {!remoteVideoVisible && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_top,#164e63_0%,#020617_58%)] px-6 text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20">
            {phase === 'declined' || phase === 'ended' || phase === 'missed'
              ? <PhoneOff className="h-10 w-10 text-slate-300" />
              : <Loader2 className="h-10 w-10 animate-spin text-cyan-300" />}
          </div>
          <h1 className="mt-6 text-2xl font-semibold">{statusLabel}</h1>
          <p className="mt-2 max-w-sm text-sm text-slate-300">
            {t('videoCall.privateNotice')}
          </p>
        </div>
      )}

      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-5 pb-14 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <BrandLogo className="h-10 w-40" monochrome />
        <span className="rounded-full bg-black/45 px-3 py-1.5 text-xs font-semibold backdrop-blur-lg">
          {statusLabel}
        </span>
      </div>

      <video
        ref={localVideoRef}
        autoPlay
        muted
        playsInline
        className="absolute end-4 top-[max(5.5rem,calc(env(safe-area-inset-top)+4.5rem))] z-20 aspect-[3/4] w-28 rounded-2xl border border-white/20 bg-slate-900 object-cover shadow-2xl [transform:scaleX(-1)] sm:w-36"
      />

      <div className="absolute inset-x-0 bottom-0 z-30 flex items-center justify-center gap-4 bg-gradient-to-t from-black/80 to-transparent px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-20">
        <button
          type="button"
          onClick={toggleMicrophone}
          aria-label={microphoneMuted ? t('videoCall.unmute') : t('videoCall.mute')}
          className={`flex h-14 w-14 items-center justify-center rounded-full backdrop-blur-lg ${
            microphoneMuted ? 'bg-white text-slate-950' : 'bg-white/15 text-white'
          }`}
        >
          {microphoneMuted ? <MicOff /> : <Mic />}
        </button>
        <button
          type="button"
          onClick={() => void endCall()}
          aria-label={t('videoCall.end')}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-500 text-white shadow-xl shadow-rose-950/50"
        >
          <PhoneOff className="h-7 w-7" />
        </button>
        <button
          type="button"
          onClick={toggleCamera}
          aria-label={cameraOff ? t('videoCall.cameraOn') : t('videoCall.cameraOff')}
          className={`flex h-14 w-14 items-center justify-center rounded-full backdrop-blur-lg ${
            cameraOff ? 'bg-white text-slate-950' : 'bg-white/15 text-white'
          }`}
        >
          {cameraOff ? <CameraOff /> : <Camera />}
        </button>
      </div>
    </main>
  );
}
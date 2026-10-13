import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from './supabase';

export type VideoCallStatus =
  | 'ringing'
  | 'active'
  | 'declined'
  | 'ended'
  | 'missed';
export type VideoCallSignalType = 'offer' | 'answer' | 'ice_candidate';

export interface VideoCall {
  id: string;
  match_id: string;
  caller_id: string;
  receiver_id: string;
  status: VideoCallStatus;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  updated_at: string;
  expires_at: string;
}

export interface VideoCallSignal {
  id: number;
  call_id: string;
  sender_id: string;
  signal_type: VideoCallSignalType;
  payload: Record<string, unknown>;
  created_at: string;
}

const CALL_SELECT =
  'id,match_id,caller_id,receiver_id,status,created_at,started_at,ended_at,duration_seconds,updated_at,expires_at';
const SIGNAL_SELECT = 'id,call_id,sender_id,signal_type,payload,created_at';
const RINGING_TIMEOUT_MS = 5 * 60 * 1000;

async function requireUser(expectedId?: string) {
  const { data, error } = await getSupabase().auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Authentication required.');
  if (expectedId && data.user.id !== expectedId) {
    throw new Error('Authenticated user mismatch.');
  }
  return data.user;
}

function isStaleOpenCall(call: VideoCall): boolean {
  const expiresAt = new Date(call.expires_at).getTime();
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return true;
  return (
    call.status === 'ringing'
    && Date.now() - new Date(call.created_at).getTime() > RINGING_TIMEOUT_MS
  );
}

export async function setVideoCallStatus(
  callId: string,
  status: Exclude<VideoCallStatus, 'ringing'>,
): Promise<void> {
  await requireUser();
  const { error } = await getSupabase().rpc('set_video_call_status', {
    target_call_id: callId,
    next_status: status,
  });
  if (error) throw error;
}

export async function createVideoCall(
  matchId: string,
  receiverId: string,
): Promise<VideoCall> {
  const user = await requireUser();
  if (receiverId === user.id) throw new Error('You cannot call yourself.');

  const client = getSupabase();
  const { data: openCall, error: openCallError } = await client
    .from('video_calls')
    .select(CALL_SELECT)
    .eq('match_id', matchId)
    .in('status', ['ringing', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (openCallError) throw openCallError;

  if (openCall) {
    const typedOpenCall = openCall as VideoCall;
    if (!isStaleOpenCall(typedOpenCall)) return typedOpenCall;
    await setVideoCallStatus(typedOpenCall.id, 'ended');
  }

  const { data, error } = await client
    .from('video_calls')
    .insert({
      match_id: matchId,
      caller_id: user.id,
      receiver_id: receiverId,
    })
    .select(CALL_SELECT)
    .single();

  if (!error && data) return data as VideoCall;
  if (error?.code !== '23505') throw error;

  const { data: racedCall, error: racedCallError } = await client
    .from('video_calls')
    .select(CALL_SELECT)
    .eq('match_id', matchId)
    .in('status', ['ringing', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (racedCallError) throw racedCallError;
  return racedCall as VideoCall;
}

export async function getVideoCall(callId: string): Promise<VideoCall> {
  await requireUser();
  const { data, error } = await getSupabase()
    .from('video_calls')
    .select(CALL_SELECT)
    .eq('id', callId)
    .single();
  if (error) throw error;
  return data as VideoCall;
}

export async function getLatestIncomingVideoCall(
  userId: string,
): Promise<VideoCall | null> {
  await requireUser(userId);
  const notBefore = new Date(Date.now() - RINGING_TIMEOUT_MS).toISOString();
  const { data, error } = await getSupabase()
    .from('video_calls')
    .select(CALL_SELECT)
    .eq('receiver_id', userId)
    .eq('status', 'ringing')
    .gte('created_at', notBefore)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as VideoCall | null) ?? null;
}

export async function listVideoCallSignals(
  callId: string,
): Promise<VideoCallSignal[]> {
  await requireUser();
  const { data, error } = await getSupabase()
    .from('video_call_signals')
    .select(SIGNAL_SELECT)
    .eq('call_id', callId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return (data ?? []) as VideoCallSignal[];
}

export async function sendVideoCallSignal(
  callId: string,
  signalType: VideoCallSignalType,
  payload: Record<string, unknown>,
): Promise<void> {
  const user = await requireUser();
  const { error } = await getSupabase().from('video_call_signals').insert({
    call_id: callId,
    sender_id: user.id,
    signal_type: signalType,
    payload,
  });
  if (error) throw error;
}

export function subscribeToIncomingVideoCalls(
  userId: string,
  onCall: (call: VideoCall) => void,
  onStatus?: (status: string, error?: Error) => void,
): RealtimeChannel {
  return getSupabase()
    .channel(`incoming-video-calls:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'video_calls',
        filter: `receiver_id=eq.${userId}`,
      },
      (payload) => onCall(payload.new as VideoCall),
    )
    .subscribe((status, error) => onStatus?.(status, error));
}

export function subscribeToVideoCall(
  callId: string,
  onCall: (call: VideoCall) => void,
  onSignal: (signal: VideoCallSignal) => void,
  onStatus?: (status: string, error?: Error) => void,
): RealtimeChannel {
  return getSupabase()
    .channel(`video-call:${callId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'video_calls',
        filter: `id=eq.${callId}`,
      },
      (payload) => onCall(payload.new as VideoCall),
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'video_call_signals',
        filter: `call_id=eq.${callId}`,
      },
      (payload) => onSignal(payload.new as VideoCallSignal),
    )
    .subscribe((status, error) => onStatus?.(status, error));
}

export async function removeVideoCallChannel(
  channel: RealtimeChannel,
): Promise<void> {
  await getSupabase().removeChannel(channel);
}
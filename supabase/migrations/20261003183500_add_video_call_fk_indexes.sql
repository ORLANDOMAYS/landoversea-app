-- Cover the participant foreign keys introduced by secure video signaling.
-- Kept as a forward migration because add_secure_video_calls is already live.

create index if not exists video_calls_caller_id_idx
  on public.video_calls (caller_id);

create index if not exists video_call_signals_sender_id_idx
  on public.video_call_signals (sender_id);
-- Participant-scoped WebRTC signaling for matched LandOverSEA members.
-- Media remains peer-to-peer; Supabase stores only short signaling messages.
-- The video_calls table predates this feature, so this migration extends its
-- receiver_id/active contract without replacing or rewriting legacy call rows.

create table if not exists public.video_calls (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  caller_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'ringing'
    check (status in ('ringing', 'active', 'ended', 'missed', 'declined')),
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 hour'),
  check (caller_id <> receiver_id)
);

alter table public.video_calls
  add column if not exists updated_at timestamptz not null default now();

alter table public.video_calls
  add column if not exists expires_at timestamptz;

update public.video_calls
set expires_at = created_at + interval '1 hour'
where expires_at is null;

alter table public.video_calls
  alter column expires_at set default (now() + interval '1 hour'),
  alter column expires_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.video_calls'::regclass
      and conname = 'video_calls_distinct_participants_check'
  ) then
    alter table public.video_calls
      add constraint video_calls_distinct_participants_check
      check (caller_id <> receiver_id) not valid;
  end if;
end
$$;

create unique index if not exists video_calls_one_open_per_match
  on public.video_calls (match_id)
  where status in ('ringing', 'active');

create index if not exists video_calls_receiver_status_created_idx
  on public.video_calls (receiver_id, status, created_at desc);

create table if not exists public.video_call_signals (
  id bigint generated always as identity primary key,
  call_id uuid not null references public.video_calls(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  signal_type text not null
    check (signal_type in ('offer', 'answer', 'ice_candidate')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  check (octet_length(payload::text) <= 65536)
);

create index if not exists video_call_signals_call_created_idx
  on public.video_call_signals (call_id, created_at, id);

create or replace function public.validate_video_call_participants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.match_id is distinct from old.match_id
    or new.caller_id is distinct from old.caller_id
    or new.receiver_id is distinct from old.receiver_id
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Video call identity fields are immutable'
      using errcode = '22023';
  end if;

  if new.caller_id = new.receiver_id then
    raise exception 'Video call participants must be distinct'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.matches as matched_pair
    where matched_pair.id = new.match_id
      and (
        (
          matched_pair.user1_id = new.caller_id
          and matched_pair.user2_id = new.receiver_id
        )
        or (
          matched_pair.user2_id = new.caller_id
          and matched_pair.user1_id = new.receiver_id
        )
      )
  ) then
    raise exception 'Video call participants must belong to the match'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_video_call_participants
  on public.video_calls;
create trigger validate_video_call_participants
before insert or update on public.video_calls
for each row execute function public.validate_video_call_participants();

alter table public.video_calls enable row level security;
alter table public.video_call_signals enable row level security;

drop policy if exists "Call participants can view" on public.video_calls;
drop policy if exists "Participants can update calls" on public.video_calls;
drop policy if exists "Users can initiate calls" on public.video_calls;
drop policy if exists unavailable_feature_delete_guard on public.video_calls;
drop policy if exists unavailable_feature_insert_guard on public.video_calls;
drop policy if exists unavailable_feature_update_guard on public.video_calls;
drop policy if exists video_calls_read_participant on public.video_calls;
drop policy if exists video_calls_insert_matched_caller on public.video_calls;

create policy video_calls_read_participant
  on public.video_calls
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) in (caller_id, receiver_id)
  );

create policy video_calls_insert_matched_caller
  on public.video_calls
  for insert
  to authenticated
  with check (
    (select auth.uid()) is not null
    and (select auth.uid()) = caller_id
    and status = 'ringing'
    and started_at is null
    and ended_at is null
    and duration_seconds is null
    and exists (
      select 1
      from public.matches as matched_pair
      where matched_pair.id = video_calls.match_id
        and (
          (
            matched_pair.user1_id = video_calls.caller_id
            and matched_pair.user2_id = video_calls.receiver_id
          )
          or (
            matched_pair.user2_id = video_calls.caller_id
            and matched_pair.user1_id = video_calls.receiver_id
          )
        )
    )
  );

drop policy if exists video_call_signals_read_participant
  on public.video_call_signals;
drop policy if exists video_call_signals_insert_participant
  on public.video_call_signals;

create policy video_call_signals_read_participant
  on public.video_call_signals
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.video_calls as participant_call
      where participant_call.id = video_call_signals.call_id
        and (select auth.uid()) in (
          participant_call.caller_id,
          participant_call.receiver_id
        )
    )
  );

create policy video_call_signals_insert_participant
  on public.video_call_signals
  for insert
  to authenticated
  with check (
    (select auth.uid()) is not null
    and (select auth.uid()) = sender_id
    and exists (
      select 1
      from public.video_calls as participant_call
      where participant_call.id = video_call_signals.call_id
        and participant_call.status in ('ringing', 'active')
        and (select auth.uid()) in (
          participant_call.caller_id,
          participant_call.receiver_id
        )
        and (
          video_call_signals.signal_type = 'ice_candidate'
          or (
            video_call_signals.signal_type = 'offer'
            and (select auth.uid()) = participant_call.caller_id
          )
          or (
            video_call_signals.signal_type = 'answer'
            and participant_call.status = 'active'
            and (select auth.uid()) = participant_call.receiver_id
          )
        )
    )
  );

create or replace function public.set_video_call_status(
  target_call_id uuid,
  next_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_call public.video_calls%rowtype;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select *
  into current_call
  from public.video_calls
  where id = target_call_id
  for update;

  if not found
    or current_user_id not in (
      current_call.caller_id,
      current_call.receiver_id
    )
  then
    raise exception 'Video call not found' using errcode = 'P0002';
  end if;

  if current_call.status = next_status then
    return;
  end if;

  if current_call.status = 'ringing'
    and next_status = 'active'
    and current_user_id = current_call.receiver_id
  then
    null;
  elsif current_call.status = 'ringing'
    and next_status = 'declined'
    and current_user_id = current_call.receiver_id
  then
    null;
  elsif current_call.status = 'ringing'
    and next_status in ('ended', 'missed')
  then
    null;
  elsif current_call.status = 'active'
    and next_status = 'ended'
  then
    null;
  else
    raise exception 'Invalid video call status transition'
      using errcode = '22023';
  end if;

  update public.video_calls
  set
    status = next_status,
    started_at = case
      when next_status = 'active' then coalesce(started_at, now())
      else started_at
    end,
    ended_at = case
      when next_status in ('declined', 'ended', 'missed')
        then coalesce(ended_at, now())
      else ended_at
    end,
    duration_seconds = case
      when next_status in ('ended', 'missed') and started_at is not null
        then greatest(0, floor(extract(epoch from (now() - started_at)))::integer)
      else duration_seconds
    end,
    updated_at = now()
  where id = target_call_id;
end;
$$;

revoke all on table public.video_calls from anon, public, authenticated;
revoke all on table public.video_call_signals from anon, public, authenticated;
revoke all on function public.set_video_call_status(uuid, text) from public;
revoke all on function public.set_video_call_status(uuid, text) from anon;
revoke all on function public.validate_video_call_participants() from public;

grant select on table public.video_calls to authenticated;
grant insert (match_id, caller_id, receiver_id)
  on table public.video_calls to authenticated;
grant select on table public.video_call_signals to authenticated;
grant insert (call_id, sender_id, signal_type, payload)
  on table public.video_call_signals to authenticated;
grant usage, select on sequence public.video_call_signals_id_seq
  to authenticated;
grant execute on function public.set_video_call_status(uuid, text)
  to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'video_calls'
  ) then
    alter publication supabase_realtime add table public.video_calls;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'video_call_signals'
  ) then
    alter publication supabase_realtime add table public.video_call_signals;
  end if;
end
$$;
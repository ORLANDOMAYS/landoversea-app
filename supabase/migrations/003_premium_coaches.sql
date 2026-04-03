-- Migration 003: Premium subscriptions, dating coaches, video chat, boosts, analytics
-- ============================================================================

-- 1. Subscriptions table
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  tier text not null check (tier in ('weekly', 'monthly', 'yearly')),
  status text not null default 'active' check (status in ('active', 'canceled', 'expired', 'past_due')),
  price numeric(10,2) not null,
  start_date timestamptz not null default now(),
  end_date timestamptz not null,
  created_at timestamptz not null default now()
);

-- 2. Coaches table
create table if not exists public.coaches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null unique,
  display_name text not null,
  bio text,
  specialties text[] default '{}',
  hourly_rate numeric(10,2) not null default 50.00,
  rating numeric(3,2) default 0,
  total_reviews int default 0,
  total_sessions int default 0,
  verified boolean default false,
  active boolean default true,
  monthly_fee_paid boolean default false,
  monthly_fee_amount numeric(10,2) default 50.00,
  platform_fee_percent numeric(5,2) default 20.00,
  avatar_url text,
  languages text[] default '{en}',
  created_at timestamptz not null default now()
);

-- 3. Coach sessions (bookings)
create table if not exists public.coach_sessions (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references public.coaches(id) on delete cascade not null,
  client_id uuid references public.profiles(id) on delete cascade not null,
  scheduled_at timestamptz not null,
  duration_minutes int not null default 60,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'completed', 'canceled')),
  amount numeric(10,2) not null,
  platform_fee numeric(10,2) not null,
  coach_payout numeric(10,2) not null,
  notes text,
  created_at timestamptz not null default now()
);

-- 4. Coach reviews
create table if not exists public.coach_reviews (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references public.coaches(id) on delete cascade not null,
  client_id uuid references public.profiles(id) on delete cascade not null,
  session_id uuid references public.coach_sessions(id) on delete set null,
  rating int not null check (rating >= 1 and rating <= 5),
  review text,
  created_at timestamptz not null default now(),
  unique(session_id, client_id)
);

-- 5. Boosts table
create table if not exists public.boosts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  started_at timestamptz not null default now(),
  duration_minutes int not null default 30,
  active boolean default true,
  created_at timestamptz not null default now()
);

-- 6. Profile views (who viewed/liked your profile)
create table if not exists public.profile_views (
  id uuid primary key default gen_random_uuid(),
  viewer_id uuid references public.profiles(id) on delete cascade not null,
  viewed_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz not null default now()
);

-- 7. Video calls table
create table if not exists public.video_calls (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references public.matches(id) on delete cascade not null,
  caller_id uuid references public.profiles(id) on delete cascade not null,
  receiver_id uuid references public.profiles(id) on delete cascade not null,
  status text not null default 'ringing' check (status in ('ringing', 'active', 'ended', 'missed', 'declined')),
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds int,
  created_at timestamptz not null default now()
);

-- 8. Add daily_swipes_used and last_swipe_reset to profiles
alter table public.profiles add column if not exists daily_swipes_used int default 0;
alter table public.profiles add column if not exists last_swipe_reset date default current_date;
alter table public.profiles add column if not exists boost_active boolean default false;
alter table public.profiles add column if not exists subscription_tier text;

-- ============================================================================
-- RLS Policies
-- ============================================================================

alter table public.subscriptions enable row level security;
alter table public.coaches enable row level security;
alter table public.coach_sessions enable row level security;
alter table public.coach_reviews enable row level security;
alter table public.boosts enable row level security;
alter table public.profile_views enable row level security;
alter table public.video_calls enable row level security;

-- Subscriptions: users can read their own, admins can manage
create policy "Users can view own subscriptions"
  on public.subscriptions for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own subscriptions"
  on public.subscriptions for insert
  to authenticated
  with check (user_id = auth.uid());

-- Coaches: everyone can browse, coaches can edit own
create policy "Anyone can view active coaches"
  on public.coaches for select
  to authenticated
  using (active = true);

create policy "Coaches can update own profile"
  on public.coaches for update
  to authenticated
  using (user_id = auth.uid());

create policy "Users can apply as coach"
  on public.coaches for insert
  to authenticated
  with check (user_id = auth.uid());

-- Coach sessions: coach and client can view
create policy "Users can view own sessions"
  on public.coach_sessions for select
  to authenticated
  using (client_id = auth.uid() or coach_id in (
    select id from public.coaches where user_id = auth.uid()
  ));

create policy "Clients can book sessions"
  on public.coach_sessions for insert
  to authenticated
  with check (client_id = auth.uid());

create policy "Session participants can update"
  on public.coach_sessions for update
  to authenticated
  using (client_id = auth.uid() or coach_id in (
    select id from public.coaches where user_id = auth.uid()
  ));

-- Coach reviews: anyone can read, clients can write
create policy "Anyone can read reviews"
  on public.coach_reviews for select
  to authenticated
  using (true);

create policy "Clients can write reviews"
  on public.coach_reviews for insert
  to authenticated
  with check (client_id = auth.uid());

-- Boosts: users manage own
create policy "Users can view own boosts"
  on public.boosts for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can create own boosts"
  on public.boosts for insert
  to authenticated
  with check (user_id = auth.uid());

-- Profile views: users can see who viewed them
create policy "Users can see own profile views"
  on public.profile_views for select
  to authenticated
  using (viewed_id = auth.uid());

create policy "Users can record profile views"
  on public.profile_views for insert
  to authenticated
  with check (viewer_id = auth.uid());

-- Video calls: participants only
create policy "Call participants can view"
  on public.video_calls for select
  to authenticated
  using (caller_id = auth.uid() or receiver_id = auth.uid());

create policy "Users can initiate calls"
  on public.video_calls for insert
  to authenticated
  with check (caller_id = auth.uid());

create policy "Participants can update calls"
  on public.video_calls for update
  to authenticated
  using (caller_id = auth.uid() or receiver_id = auth.uid());

-- ============================================================================
-- Functions
-- ============================================================================

-- Function to check and reset daily swipes
create or replace function public.check_swipe_limit()
returns boolean
language plpgsql
security definer
as $$
declare
  profile_rec record;
  is_premium boolean;
begin
  select p.*, 
    exists(select 1 from public.subscriptions s 
           where s.user_id = p.id and s.status = 'active' and s.end_date > now()) as has_active_sub
  into profile_rec
  from public.profiles p
  where p.id = auth.uid();
  
  if not found then return false; end if;
  
  is_premium := profile_rec.has_active_sub or profile_rec.premium;
  
  -- Premium users have unlimited swipes
  if is_premium then return true; end if;
  
  -- Reset daily counter if new day
  if profile_rec.last_swipe_reset < current_date then
    update public.profiles 
    set daily_swipes_used = 0, last_swipe_reset = current_date 
    where id = auth.uid();
    return true;
  end if;
  
  -- Free users get 20 swipes per day
  if profile_rec.daily_swipes_used >= 20 then return false; end if;
  
  return true;
end;
$$;

-- Function to increment swipe count
create or replace function public.increment_swipe_count()
returns void
language plpgsql
security definer
as $$
begin
  update public.profiles 
  set daily_swipes_used = daily_swipes_used + 1 
  where id = auth.uid();
end;
$$;

-- Function to activate a boost
create or replace function public.activate_boost(duration int default 30)
returns uuid
language plpgsql
security definer
as $$
declare
  boost_id uuid;
begin
  -- Check if user is premium
  if not exists(
    select 1 from public.subscriptions 
    where user_id = auth.uid() and status = 'active' and end_date > now()
  ) and not exists(
    select 1 from public.profiles where id = auth.uid() and premium = true
  ) then
    raise exception 'Premium subscription required for boosts';
  end if;
  
  -- Deactivate any existing boosts
  update public.boosts set active = false where user_id = auth.uid() and active = true;
  
  -- Create new boost
  insert into public.boosts (user_id, duration_minutes)
  values (auth.uid(), duration)
  returning id into boost_id;
  
  -- Mark profile as boosted
  update public.profiles set boost_active = true where id = auth.uid();
  
  return boost_id;
end;
$$;

-- Function to undo last swipe (premium only)
create or replace function public.undo_last_swipe()
returns json
language plpgsql
security definer
as $$
declare
  last_swipe record;
begin
  -- Check premium
  if not exists(
    select 1 from public.subscriptions 
    where user_id = auth.uid() and status = 'active' and end_date > now()
  ) and not exists(
    select 1 from public.profiles where id = auth.uid() and premium = true
  ) then
    raise exception 'Premium subscription required for undo';
  end if;
  
  -- Get last swipe
  select * into last_swipe from public.swipes 
  where swiper_id = auth.uid() 
  order by created_at desc limit 1;
  
  if not found then
    return json_build_object('success', false, 'message', 'No swipes to undo');
  end if;
  
  -- Delete the swipe
  delete from public.swipes where id = last_swipe.id;
  
  -- Delete any match that was created from this swipe
  delete from public.matches 
  where (user1_id = least(last_swipe.swiper_id, last_swipe.swiped_id) 
    and user2_id = greatest(last_swipe.swiper_id, last_swipe.swiped_id));
  
  return json_build_object(
    'success', true, 
    'undone_profile_id', last_swipe.swiped_id,
    'direction', last_swipe.direction
  );
end;
$$;

-- Function to get who liked you (premium only)
create or replace function public.get_who_liked_me()
returns setof json
language plpgsql
security definer
as $$
begin
  -- Check premium
  if not exists(
    select 1 from public.subscriptions 
    where user_id = auth.uid() and status = 'active' and end_date > now()
  ) and not exists(
    select 1 from public.profiles where id = auth.uid() and premium = true
  ) then
    raise exception 'Premium subscription required';
  end if;
  
  return query
  select json_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'avatar_url', p.avatar_url,
    'age', p.age,
    'city', p.city,
    'swiped_at', s.created_at
  )
  from public.swipes s
  join public.profiles p on p.id = s.swiper_id
  where s.swiped_id = auth.uid()
    and s.direction in ('like', 'superlike')
    and not exists(
      select 1 from public.swipes s2 
      where s2.swiper_id = auth.uid() and s2.swiped_id = s.swiper_id
    )
  order by s.created_at desc;
end;
$$;

-- Enable realtime on video_calls for signaling
alter publication supabase_realtime add table public.video_calls;

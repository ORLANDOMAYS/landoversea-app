-- ============================================================
-- LandOverSea Dating App – Full Schema
-- ============================================================

-- 1. Extend profiles table
alter table public.profiles
  add column if not exists avatar_url text,
  add column if not exists age integer,
  add column if not exists gender text,
  add column if not exists interested_in text,
  add column if not exists language text default 'en',
  add column if not exists verified boolean default false,
  add column if not exists premium boolean default false,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists city text,
  add column if not exists country text;

-- 2. User photos
create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  position integer default 0,
  created_at timestamptz default now()
);

alter table public.photos enable row level security;

create policy photos_read_all on public.photos
  for select using (true);

create policy photos_insert_self on public.photos
  for insert with check (auth.uid() = user_id);

create policy photos_delete_self on public.photos
  for delete using (auth.uid() = user_id);

-- 3. Swipes
create table if not exists public.swipes (
  id uuid primary key default gen_random_uuid(),
  swiper_id uuid not null references auth.users(id) on delete cascade,
  swiped_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('like', 'pass', 'superlike')),
  created_at timestamptz default now(),
  unique (swiper_id, swiped_id)
);

alter table public.swipes enable row level security;

create policy swipes_insert_self on public.swipes
  for insert with check (auth.uid() = swiper_id);

create policy swipes_read_self on public.swipes
  for select using (auth.uid() = swiper_id or auth.uid() = swiped_id);

-- 4. Matches
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  user1_id uuid not null references auth.users(id) on delete cascade,
  user2_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  unique (user1_id, user2_id)
);

alter table public.matches enable row level security;

create policy matches_read_self on public.matches
  for select using (auth.uid() = user1_id or auth.uid() = user2_id);

-- 5. Messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  translated_body text,
  sender_language text,
  created_at timestamptz default now()
);

alter table public.messages enable row level security;

create policy messages_read_match on public.messages
  for select using (
    exists (
      select 1 from public.matches m
      where m.id = match_id
        and (m.user1_id = auth.uid() or m.user2_id = auth.uid())
    )
  );

create policy messages_insert_self on public.messages
  for insert with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.matches m
      where m.id = match_id
        and (m.user1_id = auth.uid() or m.user2_id = auth.uid())
    )
  );

-- 6. Premium user locations (up to 3)
create table if not exists public.user_locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  city text not null,
  country text not null,
  latitude double precision,
  longitude double precision,
  active boolean default true,
  created_at timestamptz default now()
);

alter table public.user_locations enable row level security;

create policy locations_read_all on public.user_locations
  for select using (true);

create policy locations_insert_self on public.user_locations
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.premium = true
    )
    and (
      select count(*) from public.user_locations ul
      where ul.user_id = auth.uid()
    ) < 3
  );

create policy locations_update_self on public.user_locations
  for update using (auth.uid() = user_id);

create policy locations_delete_self on public.user_locations
  for delete using (auth.uid() = user_id);

-- 7. Function: create match when both users like each other
create or replace function public.check_match()
returns trigger
language plpgsql
security definer
as $$
declare
  other_swipe record;
  match_exists boolean;
  uid1 uuid;
  uid2 uuid;
begin
  if new.direction = 'like' or new.direction = 'superlike' then
    select * into other_swipe from public.swipes
    where swiper_id = new.swiped_id
      and swiped_id = new.swiper_id
      and (direction = 'like' or direction = 'superlike');

    if found then
      uid1 := least(new.swiper_id, new.swiped_id);
      uid2 := greatest(new.swiper_id, new.swiped_id);

      select exists(
        select 1 from public.matches
        where user1_id = uid1 and user2_id = uid2
      ) into match_exists;

      if not match_exists then
        insert into public.matches (user1_id, user2_id)
        values (uid1, uid2);
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_swipe_check_match on public.swipes;
create trigger on_swipe_check_match
after insert on public.swipes
for each row execute procedure public.check_match();

-- 8. Protect verified and premium columns from direct client updates
create or replace function public.protect_privileged_columns()
returns trigger
language plpgsql
as $$
begin
  -- Allow changes only when the trusted flag is set by a security-definer function.
  if coalesce(current_setting('app.trusted_update', true), '') != 'true' then
    if new.verified is distinct from old.verified then
      new.verified := old.verified;
    end if;
    if new.premium is distinct from old.premium then
      new.premium := old.premium;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_privileged_cols on public.profiles;
create trigger protect_privileged_cols
before update on public.profiles
for each row
execute procedure public.protect_privileged_columns();

-- 9. Server-side verification function (prevents client from setting verified=true directly)
create or replace function public.verify_profile(user_uuid uuid)
returns void
language plpgsql
security definer
as $$
begin
  if user_uuid != auth.uid() then
    raise exception 'You can only verify your own profile';
  end if;
  -- Set the trusted flag so the trigger allows the verified column update
  perform set_config('app.trusted_update', 'true', true);
  update public.profiles set verified = true where id = user_uuid;
end;
$$;

-- 10. Enable realtime on messages
alter publication supabase_realtime add table public.messages;

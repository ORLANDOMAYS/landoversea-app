-- Forward-only platform hardening: private photos, complete mutation RLS, and coaches.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos',
  'photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists photos_objects_read_authenticated on storage.objects;
drop policy if exists photos_objects_insert_owner on storage.objects;
drop policy if exists photos_objects_update_owner on storage.objects;
drop policy if exists photos_objects_delete_owner on storage.objects;
drop policy if exists photos_objects_read_guard on storage.objects;
drop policy if exists photos_objects_insert_guard on storage.objects;
drop policy if exists photos_objects_update_guard on storage.objects;
drop policy if exists photos_objects_delete_guard on storage.objects;
create policy photos_objects_read_authenticated on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and auth.uid() is not null);
create policy photos_objects_insert_owner on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy photos_objects_update_owner on storage.objects
  for update to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy photos_objects_delete_owner on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Restrictive policies are ANDed with every permissive policy. These guards
-- neutralize legacy policies that grant public or bucket-wide access while
-- leaving policies for unrelated storage buckets intact.
create policy photos_objects_read_guard on storage.objects
  as restrictive for select to public
  using (bucket_id <> 'photos' or auth.uid() is not null);
create policy photos_objects_insert_guard on storage.objects
  as restrictive for insert to public
  with check (
    bucket_id <> 'photos'
    or (
      auth.uid() is not null
      and (storage.foldername(name))[1] = auth.uid()::text
    )
  );
create policy photos_objects_update_guard on storage.objects
  as restrictive for update to public
  using (
    bucket_id <> 'photos'
    or (
      auth.uid() is not null
      and (storage.foldername(name))[1] = auth.uid()::text
    )
  )
  with check (
    bucket_id <> 'photos'
    or (
      auth.uid() is not null
      and (storage.foldername(name))[1] = auth.uid()::text
    )
  );
create policy photos_objects_delete_guard on storage.objects
  as restrictive for delete to public
  using (
    bucket_id <> 'photos'
    or (
      auth.uid() is not null
      and (storage.foldername(name))[1] = auth.uid()::text
    )
  );

create or replace function public.enforce_photo_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.user_id is distinct from auth.uid() then
    raise exception 'Photo owner mismatch';
  end if;
  if new.url not like new.user_id::text || '/%' or new.url like '%..%' then
    raise exception 'Photos must use an owner-scoped storage path';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  if tg_op = 'INSERT' and (
    select count(*) from public.photos where user_id = new.user_id
  ) >= 6 then
    raise exception 'A profile can have at most six photos';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_photo_write_trigger on public.photos;
create trigger enforce_photo_write_trigger
before insert or update on public.photos
for each row execute procedure public.enforce_photo_write();

drop policy if exists profiles_insert_self on public.profiles;
drop policy if exists profiles_update_self on public.profiles;
drop policy if exists profiles_delete_self on public.profiles;
create policy profiles_insert_self on public.profiles for insert to authenticated
  with check (auth.uid() is not null and auth.uid() = id);
create policy profiles_update_self on public.profiles for update to authenticated
  using (auth.uid() is not null and auth.uid() = id)
  with check (auth.uid() = id);
create policy profiles_delete_self on public.profiles for delete to authenticated
  using (auth.uid() is not null and auth.uid() = id);

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'photos'
  loop
    execute pg_catalog.format(
      'drop policy if exists %I on public.photos',
      existing_policy.policyname
    );
  end loop;
end;
$$;
create policy photos_read_authenticated on public.photos for select to authenticated
  using (auth.uid() is not null);
create policy photos_insert_self on public.photos for insert to authenticated
  with check (auth.uid() is not null and auth.uid() = user_id);
create policy photos_update_self on public.photos for update to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy photos_delete_self on public.photos for delete to authenticated
  using (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists swipes_insert_self on public.swipes;
drop policy if exists swipes_update_self on public.swipes;
drop policy if exists swipes_delete_self on public.swipes;
create policy swipes_insert_self on public.swipes for insert to authenticated
  with check (auth.uid() is not null and auth.uid() = swiper_id);
create policy swipes_update_self on public.swipes for update to authenticated
  using (auth.uid() is not null and auth.uid() = swiper_id)
  with check (auth.uid() = swiper_id);
create policy swipes_delete_self on public.swipes for delete to authenticated
  using (auth.uid() is not null and auth.uid() = swiper_id);

drop policy if exists messages_insert_self on public.messages;
drop policy if exists messages_update_self on public.messages;
drop policy if exists messages_delete_self on public.messages;
create policy messages_insert_self on public.messages for insert to authenticated
  with check (
    auth.uid() is not null and auth.uid() = sender_id and exists (
      select 1 from public.matches m where m.id = match_id
      and auth.uid() in (m.user1_id, m.user2_id)
    )
  );
create policy messages_update_self on public.messages for update to authenticated
  using (auth.uid() is not null and auth.uid() = sender_id)
  with check (
    auth.uid() = sender_id and exists (
      select 1 from public.matches m where m.id = match_id
      and auth.uid() in (m.user1_id, m.user2_id)
    )
  );
create policy messages_delete_self on public.messages for delete to authenticated
  using (auth.uid() is not null and auth.uid() = sender_id);

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'user_locations'
  loop
    execute pg_catalog.format(
      'drop policy if exists %I on public.user_locations',
      existing_policy.policyname
    );
  end loop;
end;
$$;
create policy locations_read_self on public.user_locations for select to authenticated
  using (auth.uid() is not null and auth.uid() = user_id);
create policy locations_insert_self on public.user_locations for insert to authenticated
  with check (
    auth.uid() is not null and auth.uid() = user_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.premium)
    and (select count(*) from public.user_locations ul where ul.user_id = auth.uid()) < 3
  );
create policy locations_update_self on public.user_locations for update to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy locations_delete_self on public.user_locations for delete to authenticated
  using (auth.uid() is not null and auth.uid() = user_id);

-- The hosted LandOverSEA database may already contain a legacy coaches table
-- whose integer IDs and user references are used by existing bookings. Never
-- drop or recreate it: add the Supabase-facing columns in place.
create table if not exists public.coaches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  owner_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  avatar_url text,
  bio text,
  languages text[] not null default '{}',
  specialties text[] not null default '{}',
  hourly_rate integer not null default 0 check (hourly_rate >= 0),
  platform_fee_percent integer not null default 0 check (platform_fee_percent between 0 and 100),
  rating double precision not null default 0 check (rating between 0 and 5),
  total_reviews integer not null default 0 check (total_reviews >= 0),
  total_sessions integer not null default 0 check (total_sessions >= 0),
  verified boolean not null default false,
  approved boolean not null default false,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.coaches
  add column if not exists user_id uuid,
  add column if not exists owner_id uuid,
  add column if not exists display_name text,
  add column if not exists avatar_url text,
  add column if not exists bio text,
  add column if not exists languages text[],
  add column if not exists specialties text[],
  add column if not exists hourly_rate integer,
  add column if not exists platform_fee_percent integer,
  add column if not exists rating double precision,
  add column if not exists total_reviews integer,
  add column if not exists total_sessions integer,
  add column if not exists verified boolean,
  add column if not exists approved boolean,
  add column if not exists active boolean,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

-- Existing integer user_id values belong to the legacy application and cannot
-- be cast to Supabase auth UUIDs. owner_id is the new authorization boundary;
-- UUID/text UUID legacy owners can be linked without changing user_id.
alter table public.coaches alter column user_id drop not null;

do $$
declare
  legacy_user_id_type text;
begin
  select data_type
  into legacy_user_id_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'coaches'
    and column_name = 'user_id';

  if legacy_user_id_type = 'uuid' then
    update public.coaches
    set owner_id = user_id
    where owner_id is null and user_id is not null;
  elsif legacy_user_id_type in ('text', 'character varying', 'character') then
    execute $link_text_owners$
      update public.coaches
      set owner_id = user_id::text::uuid
      where owner_id is null
        and user_id is not null
        and user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    $link_text_owners$;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'coaches' and column_name = 'photo_url'
  ) then
    execute $backfill_avatar$
      update public.coaches
      set avatar_url = photo_url
      where avatar_url is null and photo_url is not null
    $backfill_avatar$;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'coaches' and column_name = 'rates_per_hour'
  ) then
    execute $backfill_rate$
      update public.coaches
      set hourly_rate = case
        when rates_per_hour >= 0 and rates_per_hour <= 2147483647
          then round(rates_per_hour)::integer
        else 0
      end
      where hourly_rate is null
    $backfill_rate$;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'coaches' and column_name = 'review_count'
  ) then
    execute $backfill_reviews$
      update public.coaches
      set total_reviews = greatest(coalesce(review_count, 0), 0)
      where total_reviews is null
    $backfill_reviews$;
  end if;

  -- Only trusted legacy verification signals promote an existing coach.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'coaches' and column_name = 'is_verified'
  ) then
    execute $backfill_verified_flag$
      update public.coaches
      set verified = true
      where verified is null and is_verified is true
    $backfill_verified_flag$;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'coaches' and column_name = 'verification_status'
  ) then
    execute $backfill_verified_status$
      update public.coaches
      set verified = true
      where verified is null
        and lower(coalesce(verification_status, '')) in ('approved', 'verified')
    $backfill_verified_status$;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'coaches' and column_name = 'is_active'
  ) then
    execute $backfill_active$
      update public.coaches
      set active = is_active
      where active is null and is_active is not null
    $backfill_active$;
  end if;
end;
$$;

update public.coaches
set
  languages = coalesce(languages, '{}'),
  specialties = coalesce(specialties, '{}'),
  hourly_rate = greatest(coalesce(hourly_rate, 0), 0),
  platform_fee_percent = least(greatest(coalesce(platform_fee_percent, 0), 0), 100),
  rating = least(greatest(coalesce(rating, 0), 0), 5),
  total_reviews = greatest(coalesce(total_reviews, 0), 0),
  total_sessions = greatest(coalesce(total_sessions, 0), 0),
  verified = coalesce(verified, false),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, created_at, now());

update public.coaches
set approved = coalesce(approved, verified, false);

update public.coaches
set active = coalesce(active, approved, false);

-- An active listing must remain both approved and verified, including legacy
-- rows that previously used an unrestricted is_active flag.
update public.coaches
set active = false
where active and (not approved or not verified);

alter table public.coaches
  alter column languages set default '{}',
  alter column languages set not null,
  alter column specialties set default '{}',
  alter column specialties set not null,
  alter column hourly_rate set default 0,
  alter column hourly_rate set not null,
  alter column platform_fee_percent set default 0,
  alter column platform_fee_percent set not null,
  alter column rating set default 0,
  alter column rating set not null,
  alter column total_reviews set default 0,
  alter column total_reviews set not null,
  alter column total_sessions set default 0,
  alter column total_sessions set not null,
  alter column verified set default false,
  alter column verified set not null,
  alter column approved set default false,
  alter column approved set not null,
  alter column active set default false,
  alter column active set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.coaches'::regclass
      and conname = 'coaches_owner_id_fkey'
  ) then
    alter table public.coaches
      add constraint coaches_owner_id_fkey
      foreign key (owner_id) references auth.users(id)
      on delete set null
      not valid;
  end if;
end;
$$;

alter table public.coaches enable row level security;

create or replace function public.protect_coach_moderation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if tg_op = 'INSERT' then
      if auth.uid() is null then
        raise exception 'Authentication required';
      end if;
      new.user_id := null;
      new.owner_id := auth.uid();
      new.approved := false;
      new.active := false;
      new.verified := false;
      new.rating := 0;
      new.total_reviews := 0;
      new.total_sessions := 0;
      new.platform_fee_percent := 0;
      new.created_at := coalesce(new.created_at, now());
    elsif tg_op = 'UPDATE' then
      new.id := old.id;
      new.user_id := old.user_id;
      new.owner_id := old.owner_id;
      new.approved := old.approved;
      new.active := old.active;
      new.verified := old.verified;
      new.rating := old.rating;
      new.total_reviews := old.total_reviews;
      new.total_sessions := old.total_sessions;
      new.platform_fee_percent := old.platform_fee_percent;
      new.created_at := old.created_at;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists protect_coach_moderation_trigger on public.coaches;
create trigger protect_coach_moderation_trigger
before insert or update on public.coaches
for each row execute procedure public.protect_coach_moderation();

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'coaches'
  loop
    execute pg_catalog.format(
      'drop policy if exists %I on public.coaches',
      existing_policy.policyname
    );
  end loop;
end;
$$;

create policy coaches_read_approved on public.coaches for select to authenticated
  using (auth.uid() is not null and verified and approved and active);
create policy coaches_read_self on public.coaches for select to authenticated
  using (auth.uid() is not null and auth.uid() = owner_id);
create policy coaches_insert_self_unapproved on public.coaches for insert to authenticated
  with check (
    auth.uid() is not null and auth.uid() = owner_id
    and approved = false and active = false and verified = false
    and rating = 0 and total_reviews = 0 and total_sessions = 0
    and platform_fee_percent = 0
  );
create policy coaches_update_self on public.coaches for update to authenticated
  using (auth.uid() is not null and auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
create policy coaches_delete_self on public.coaches for delete to authenticated
  using (auth.uid() is not null and auth.uid() = owner_id);

revoke all on table public.profiles, public.photos, public.swipes, public.matches,
  public.messages, public.user_locations, public.coaches from public, anon;
revoke all on table public.profiles, public.photos, public.swipes, public.matches,
  public.messages, public.user_locations, public.coaches from authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.photos to authenticated;
grant select, insert, update, delete on public.swipes to authenticated;
grant select on public.matches to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
grant select, insert, update, delete on public.user_locations to authenticated;
grant select, insert, update, delete on public.coaches to authenticated;

-- Legacy coaches tables may use serial/integer IDs. Allow authenticated coach
-- applications to consume only that owned sequence; UUID-based tables have no
-- sequence and skip this block.
do $$
declare
  coach_id_sequence text := pg_catalog.pg_get_serial_sequence('public.coaches', 'id');
begin
  if coach_id_sequence is not null then
    execute pg_catalog.format(
      'revoke all on sequence %s from public, anon',
      coach_id_sequence
    );
    execute pg_catalog.format(
      'grant usage, select on sequence %s to authenticated',
      coach_id_sequence
    );
  end if;
end;
$$;

revoke all on function public.verify_profile(uuid) from public, anon, authenticated;
revoke all on function public.upgrade_to_premium() from public, anon, authenticated;
grant execute on function public.verify_profile(uuid) to service_role;
grant execute on function public.upgrade_to_premium() to service_role;
revoke all on function public.ensure_profile() from public, anon, authenticated;
revoke all on function public.check_match() from public, anon, authenticated;
revoke all on function public.protect_privileged_columns() from public, anon, authenticated;
revoke all on function public.enforce_photo_write() from public, anon, authenticated;
revoke all on function public.protect_coach_moderation() from public, anon, authenticated;
grant execute on function public.ensure_profile() to service_role;
grant execute on function public.check_match() to service_role;
grant execute on function public.protect_privileged_columns() to service_role;
grant execute on function public.enforce_photo_write() to service_role;
grant execute on function public.protect_coach_moderation() to service_role;
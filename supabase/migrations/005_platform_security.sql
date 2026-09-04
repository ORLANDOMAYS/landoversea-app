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

drop policy if exists photos_insert_self on public.photos;
drop policy if exists photos_update_self on public.photos;
drop policy if exists photos_delete_self on public.photos;
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

drop policy if exists locations_insert_self on public.user_locations;
drop policy if exists locations_update_self on public.user_locations;
drop policy if exists locations_delete_self on public.user_locations;
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

create table public.coaches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
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
alter table public.coaches enable row level security;

create or replace function public.protect_coach_moderation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and coalesce(auth.role(), '') <> 'service_role' then
    new.id := old.id;
    new.user_id := old.user_id;
    new.approved := old.approved;
    new.active := old.active;
    new.verified := old.verified;
    new.rating := old.rating;
    new.total_reviews := old.total_reviews;
    new.total_sessions := old.total_sessions;
    new.platform_fee_percent := old.platform_fee_percent;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger protect_coach_moderation_trigger
before update on public.coaches
for each row execute procedure public.protect_coach_moderation();

create policy coaches_read_approved on public.coaches for select to authenticated
  using (auth.uid() is not null and approved and active);
create policy coaches_insert_self_unapproved on public.coaches for insert to authenticated
  with check (
    auth.uid() is not null and auth.uid() = user_id
    and approved = false and active = false and verified = false
    and rating = 0 and total_reviews = 0 and total_sessions = 0
    and platform_fee_percent = 0
  );
create policy coaches_update_self on public.coaches for update to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy coaches_delete_self on public.coaches for delete to authenticated
  using (auth.uid() is not null and auth.uid() = user_id);

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
-- Forward-only hardening for the remaining valid live Supabase advisor
-- findings. Preserve authenticated product behavior while removing anonymous
-- and unnecessary access.

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Prevent
-- future migration-created functions owned by the migration role from
-- inheriting that exposure.
alter default privileges
  revoke execute on functions from public;

-- Fix mutable search paths on every application-owned public function and
-- make SECURITY DEFINER functions private by default. Extension-owned
-- functions are excluded so this migration does not alter third-party code.
do $$
declare
  target_function record;
  function_identity text;
begin
  for target_function in
    select
      p.oid,
      n.nspname,
      p.proname,
      p.prosecdef,
      pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1
        from pg_catalog.pg_depend d
        where d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
          and d.objid = p.oid
          and d.deptype = 'e'
      )
  loop
    function_identity := pg_catalog.format(
      '%I.%I(%s)',
      target_function.nspname,
      target_function.proname,
      target_function.identity_arguments
    );

    execute pg_catalog.format(
      'alter function %s set search_path = pg_catalog, public',
      function_identity
    );

    if target_function.prosecdef then
      execute pg_catalog.format(
        'revoke all on function %s from public, anon, authenticated',
        function_identity
      );
      execute pg_catalog.format(
        'grant execute on function %s to service_role',
        function_identity
      );
    end if;
  end loop;
end;
$$;

-- Enforce premium access and the three-location limit without querying
-- user_locations from its own RLS policy, which would recurse. The advisory
-- lock makes concurrent inserts for one user observe a stable count.
create or replace function public.enforce_location_write()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if current_user_id is null or new.user_id is distinct from current_user_id then
    raise exception 'Location owner mismatch';
  end if;

  if tg_op = 'INSERT' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('location:' || current_user_id::text, 0)
    );

    if not exists (
      select 1
      from public.profiles p
      where p.id = current_user_id
        and p.premium
    ) then
      raise exception 'Premium is required for saved locations';
    end if;

    if (
      select count(*)
      from public.user_locations ul
      where ul.user_id = current_user_id
    ) >= 3 then
      raise exception 'A profile can have at most three saved locations';
    end if;
  end if;

  return new;
end;
$$;

-- This is the one SECURITY DEFINER RPC intentionally used by authenticated
-- web and mobile clients. Its body rejects missing users and only creates a
-- match after reciprocal like/superlike rows exist.
revoke all on function public.ensure_match(uuid)
  from public, anon, authenticated;
grant execute on function public.ensure_match(uuid) to authenticated;

-- Trigger helpers and privileged verification/premium mutations are not
-- client RPCs. Keep them unavailable to anonymous and authenticated callers.
revoke all on function public.ensure_profile()
  from public, anon, authenticated;
revoke all on function public.check_match()
  from public, anon, authenticated;
revoke all on function public.protect_privileged_columns()
  from public, anon, authenticated;
revoke all on function public.verify_profile(uuid)
  from public, anon, authenticated;
revoke all on function public.upgrade_to_premium()
  from public, anon, authenticated;
revoke all on function public.enforce_photo_write()
  from public, anon, authenticated;
revoke all on function public.enforce_location_write()
  from public, anon, authenticated;
revoke all on function public.protect_coach_moderation()
  from public, anon, authenticated;

grant execute on function public.ensure_profile() to service_role;
grant execute on function public.check_match() to service_role;
grant execute on function public.protect_privileged_columns() to service_role;
grant execute on function public.verify_profile(uuid) to service_role;
grant execute on function public.upgrade_to_premium() to service_role;
grant execute on function public.enforce_photo_write() to service_role;
grant execute on function public.enforce_location_write() to service_role;
grant execute on function public.protect_coach_moderation() to service_role;

-- Dedicated LandOverSEA tables have one canonical policy set. Remove every
-- legacy policy name first so permissive duplicates cannot survive.
do $$
declare
  target_table text;
  existing_policy record;
begin
  foreach target_table in array array[
    'profiles',
    'photos',
    'swipes',
    'matches',
    'messages',
    'user_locations',
    'coaches'
  ]
  loop
    for existing_policy in
      select policyname
      from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = target_table
    loop
      execute pg_catalog.format(
        'drop policy if exists %I on public.%I',
        existing_policy.policyname,
        target_table
      );
    end loop;
  end loop;
end;
$$;

alter table public.profiles enable row level security;
alter table public.photos enable row level security;
alter table public.swipes enable row level security;
alter table public.matches enable row level security;
alter table public.messages enable row level security;
alter table public.user_locations enable row level security;
alter table public.coaches enable row level security;

drop trigger if exists enforce_location_write_trigger on public.user_locations;
create trigger enforce_location_write_trigger
before insert or update on public.user_locations
for each row execute procedure public.enforce_location_write();

-- Profiles remain discoverable to signed-in members. Exact coordinates were
-- removed from this table in migration 006.
create policy profiles_read_authenticated
  on public.profiles for select to authenticated
  using ((select auth.uid()) is not null);
create policy profiles_insert_self
  on public.profiles for insert to authenticated
  with check (
    (select auth.uid()) is not null
    and (select auth.uid()) = id
  );
create policy profiles_update_self
  on public.profiles for update to authenticated
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) = id
  )
  with check ((select auth.uid()) = id);
create policy profiles_delete_self
  on public.profiles for delete to authenticated
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) = id
  );

-- Photo metadata remains member-readable for discovery; storage objects stay
-- in the private bucket and mutations remain owner scoped.
create policy photos_read_authenticated
  on public.photos for select to authenticated
  using ((select auth.uid()) is not null);
create policy photos_insert_self
  on public.photos for insert to authenticated
  with check (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
  );
create policy photos_update_self
  on public.photos for update to authenticated
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
  )
  with check ((select auth.uid()) = user_id);
create policy photos_delete_self
  on public.photos for delete to authenticated
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
  );

create policy swipes_read_participant
  on public.swipes for select to authenticated
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) in (swiper_id, swiped_id)
  );
create policy swipes_insert_self
  on public.swipes for insert to authenticated
  with check (
    (select auth.uid()) is not null
    and (select auth.uid()) = swiper_id
  );
create policy swipes_update_self
  on public.swipes for update to authenticated
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) = swiper_id
  )
  with check ((select auth.uid()) = swiper_id);
create policy swipes_delete_self
  on public.swipes for delete to authenticated
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) = swiper_id
  );

create policy matches_read_participant
  on public.matches for select to authenticated
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) in (user1_id, user2_id)
  );

create policy messages_read_participant
  on public.messages for select to authenticated
  using (
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.matches m
      where m.id = match_id
        and (select auth.uid()) in (m.user1_id, m.user2_id)
    )
  );
create policy messages_insert_self
  on public.messages for insert to authenticated
  with check (
    (select auth.uid()) is not null
    and (select auth.uid()) = sender_id
    and exists (
      select 1
      from public.matches m
      where m.id = match_id
        and (select auth.uid()) in (m.user1_id, m.user2_id)
    )
  );
create policy messages_update_self
  on public.messages for update to authenticated
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) = sender_id
  )
  with check (
    (select auth.uid()) = sender_id
    and exists (
      select 1
      from public.matches m
      where m.id = match_id
        and (select auth.uid()) in (m.user1_id, m.user2_id)
    )
  );
create policy messages_delete_self
  on public.messages for delete to authenticated
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) = sender_id
  );

create policy locations_read_self
  on public.user_locations for select to authenticated
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
  );
create policy locations_insert_self
  on public.user_locations for insert to authenticated
  with check (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
  );
create policy locations_update_self
  on public.user_locations for update to authenticated
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
  )
  with check ((select auth.uid()) = user_id);
create policy locations_delete_self
  on public.user_locations for delete to authenticated
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
  );

-- One SELECT policy avoids duplicate permissive policy evaluation while
-- retaining public marketplace reads and owner access to pending applications.
create policy coaches_read_allowed
  on public.coaches for select to authenticated
  using (
    (select auth.uid()) is not null
    and (
      (verified and approved and active)
      or (select auth.uid()) = owner_id
    )
  );
create policy coaches_insert_self_unapproved
  on public.coaches for insert to authenticated
  with check (
    (select auth.uid()) is not null
    and (select auth.uid()) = owner_id
    and approved = false
    and active = false
    and verified = false
    and rating = 0
    and total_reviews = 0
    and total_sessions = 0
    and platform_fee_percent = 0
  );
create policy coaches_update_self
  on public.coaches for update to authenticated
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) = owner_id
  )
  with check ((select auth.uid()) = owner_id);
create policy coaches_delete_self
  on public.coaches for delete to authenticated
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) = owner_id
  );

-- Remove anonymous table access and grant authenticated users only the
-- operations supported by the canonical policies.
revoke all on table public.profiles, public.photos, public.swipes,
  public.matches, public.messages, public.user_locations, public.coaches
  from public, anon;
revoke all on table public.profiles, public.photos, public.swipes,
  public.matches, public.messages, public.user_locations, public.coaches
  from authenticated;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.photos to authenticated;
grant select, insert, update, delete on public.swipes to authenticated;
grant select on public.matches to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
grant select, insert, update, delete on public.user_locations to authenticated;
grant select, insert, update, delete on public.coaches to authenticated;

-- Preserve the private photo-bucket behavior while optimizing auth lookups.
-- Unknown storage policies remain intact for unrelated buckets; restrictive
-- guards continue to neutralize them for the photos bucket.
drop policy if exists photos_objects_read_authenticated on storage.objects;
drop policy if exists photos_objects_insert_owner on storage.objects;
drop policy if exists photos_objects_update_owner on storage.objects;
drop policy if exists photos_objects_delete_owner on storage.objects;
drop policy if exists photos_objects_read_guard on storage.objects;
drop policy if exists photos_objects_insert_guard on storage.objects;
drop policy if exists photos_objects_update_guard on storage.objects;
drop policy if exists photos_objects_delete_guard on storage.objects;

create policy photos_objects_read_authenticated
  on storage.objects for select to authenticated
  using (
    bucket_id = 'photos'
    and (select auth.uid()) is not null
  );
create policy photos_objects_insert_owner
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy photos_objects_update_owner
  on storage.objects for update to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy photos_objects_delete_owner
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy photos_objects_read_guard
  on storage.objects as restrictive for select to public
  using (
    bucket_id <> 'photos'
    or (select auth.uid()) is not null
  );
create policy photos_objects_insert_guard
  on storage.objects as restrictive for insert to public
  with check (
    bucket_id <> 'photos'
    or (
      (select auth.uid()) is not null
      and (storage.foldername(name))[1] = (select auth.uid())::text
    )
  );
create policy photos_objects_update_guard
  on storage.objects as restrictive for update to public
  using (
    bucket_id <> 'photos'
    or (
      (select auth.uid()) is not null
      and (storage.foldername(name))[1] = (select auth.uid())::text
    )
  )
  with check (
    bucket_id <> 'photos'
    or (
      (select auth.uid()) is not null
      and (storage.foldername(name))[1] = (select auth.uid())::text
    )
  );
create policy photos_objects_delete_guard
  on storage.objects as restrictive for delete to public
  using (
    bucket_id <> 'photos'
    or (
      (select auth.uid()) is not null
      and (storage.foldername(name))[1] = (select auth.uid())::text
    )
  );

-- Add only indexes that support known foreign keys and hot participant/owner
-- lookups. Existing primary/unique indexes already cover the complementary
-- columns.
create index if not exists photos_user_id_idx
  on public.photos (user_id);
create index if not exists swipes_swiped_id_swiper_id_idx
  on public.swipes (swiped_id, swiper_id);
create index if not exists matches_user2_id_user1_id_idx
  on public.matches (user2_id, user1_id);
create index if not exists messages_match_id_created_at_idx
  on public.messages (match_id, created_at);
create index if not exists messages_sender_id_idx
  on public.messages (sender_id);
create index if not exists user_locations_user_id_idx
  on public.user_locations (user_id);
create index if not exists coaches_owner_id_idx
  on public.coaches (owner_id);
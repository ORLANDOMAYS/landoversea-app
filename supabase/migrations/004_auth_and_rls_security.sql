-- Forward-only security hardening. Do not re-enable these RPC grants without a
-- trusted server-side verification or billing integration.

revoke all on function public.verify_profile(uuid) from public, anon, authenticated;
revoke all on function public.upgrade_to_premium() from public, anon, authenticated;
grant execute on function public.verify_profile(uuid) to service_role;
grant execute on function public.upgrade_to_premium() to service_role;

alter function public.ensure_profile() set search_path = pg_catalog, public;
alter function public.check_match() set search_path = pg_catalog, public;
alter function public.ensure_match(uuid) set search_path = pg_catalog, public;
alter function public.protect_privileged_columns() set search_path = pg_catalog, public;
alter function public.verify_profile(uuid) set search_path = pg_catalog, public;
alter function public.upgrade_to_premium() set search_path = pg_catalog, public;

create or replace function public.ensure_match(other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  me uuid := auth.uid();
  uid1 uuid;
  uid2 uuid;
  found_match uuid;
begin
  if me is null then
    raise exception 'Authentication required';
  end if;
  if other_user is null or other_user = me then
    raise exception 'A different user is required';
  end if;

  uid1 := least(me, other_user);
  uid2 := greatest(me, other_user);

  if exists (
    select 1 from public.swipes
    where swiper_id = me and swiped_id = other_user
      and direction in ('like','superlike')
  ) and exists (
    select 1 from public.swipes
    where swiper_id = other_user and swiped_id = me
      and direction in ('like','superlike')
  ) then
    insert into public.matches (user1_id, user2_id)
    values (uid1, uid2)
    on conflict (user1_id, user2_id) do nothing;
  end if;

  select id into found_match from public.matches
  where user1_id = uid1 and user2_id = uid2;
  return found_match;
end;
$$;

revoke all on function public.ensure_match(uuid) from public, anon;
grant execute on function public.ensure_match(uuid) to authenticated;

create or replace function public.verify_profile(user_uuid uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or user_uuid is distinct from auth.uid() then
    raise exception 'Authenticated user mismatch';
  end if;
  perform set_config('app.trusted_update', 'true', true);
  update public.profiles set verified = true where id = auth.uid();
end;
$$;

create or replace function public.upgrade_to_premium()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  perform set_config('app.trusted_update', 'true', true);
  update public.profiles set premium = true where id = auth.uid();
end;
$$;

-- CREATE OR REPLACE resets neither existing ACLs nor our desired restriction.
revoke all on function public.verify_profile(uuid) from public, anon, authenticated;
revoke all on function public.upgrade_to_premium() from public, anon, authenticated;
grant execute on function public.verify_profile(uuid) to service_role;
grant execute on function public.upgrade_to_premium() to service_role;

drop policy if exists profiles_read_all on public.profiles;
create policy profiles_read_authenticated on public.profiles
  for select to authenticated
  using (auth.uid() is not null);

drop policy if exists photos_read_all on public.photos;
create policy photos_read_authenticated on public.photos
  for select to authenticated
  using (auth.uid() is not null);

drop policy if exists locations_read_all on public.user_locations;
create policy locations_read_self on public.user_locations
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists locations_update_self on public.user_locations;
create policy locations_update_self on public.user_locations
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
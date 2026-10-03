alter table public.profiles
  add column if not exists updated_at timestamptz;

alter default privileges revoke execute on functions from public;

update public.profiles
set updated_at = coalesce(created_at, now())
where updated_at is null;

alter table public.profiles
  alter column updated_at set default now(),
  alter column updated_at set not null,
  alter column relocation_openness drop default,
  alter column long_distance drop default;

create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_profiles_updated_at();

revoke all on function public.set_profiles_updated_at() from public, anon, authenticated;

grant select (updated_at) on table public.profiles to authenticated;
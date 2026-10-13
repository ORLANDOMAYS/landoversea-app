alter table public.profiles
  add column if not exists onboarding_completed_at timestamptz;

update public.profiles
set onboarding_completed_at = coalesce(updated_at, created_at, now())
where onboarding_completed_at is null
  and nullif(btrim(display_name), '') is not null
  and age >= 18
  and nullif(btrim(gender), '') is not null;

create or replace function public.preserve_profile_onboarding_completion()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and old.onboarding_completed_at is not null then
    new.onboarding_completed_at := old.onboarding_completed_at;
  elsif nullif(btrim(new.display_name), '') is not null
    and new.age >= 18
    and nullif(btrim(new.gender), '') is not null
  then
    new.onboarding_completed_at := coalesce(new.onboarding_completed_at, now());
  else
    new.onboarding_completed_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists preserve_profile_onboarding_completion on public.profiles;
create trigger preserve_profile_onboarding_completion
before insert or update on public.profiles
for each row
execute function public.preserve_profile_onboarding_completion();

revoke all on function public.preserve_profile_onboarding_completion() from public, anon, authenticated;
revoke insert (onboarding_completed_at), update (onboarding_completed_at)
  on table public.profiles from anon, authenticated;
grant select (onboarding_completed_at) on table public.profiles to authenticated;
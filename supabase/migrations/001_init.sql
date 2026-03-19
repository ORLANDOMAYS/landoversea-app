create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  bio text,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy profiles_read_all on public.profiles
for select using (true);

create policy profiles_insert_self on public.profiles
for insert with check (auth.uid() = id);

create policy profiles_update_self on public.profiles
for update using (auth.uid() = id) with check (auth.uid() = id);

create or replace function public.ensure_profile()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(split_part(new.email, '@', 1), 'User'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.ensure_profile();

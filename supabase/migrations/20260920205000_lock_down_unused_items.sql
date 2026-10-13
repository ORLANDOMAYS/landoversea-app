drop policy if exists "Anyone can view items" on public.items;
drop policy if exists "Public read access" on public.items;
drop policy if exists "Anyone can insert items" on public.items;
drop policy if exists "Authenticated users can insert items" on public.items;
drop policy if exists "Users can update own items" on public.items;

revoke all privileges on table public.items from anon;
revoke all privileges on table public.items from authenticated;
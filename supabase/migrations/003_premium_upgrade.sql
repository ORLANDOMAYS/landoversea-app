-- Server-side premium upgrade function (bypasses protect_privileged_columns trigger)
-- Follows the same pattern as verify_profile in 002_dating_app.sql
create or replace function public.upgrade_to_premium()
returns void
language plpgsql
security definer
as $$
begin
  -- Set the trusted flag so the trigger allows the premium column update
  perform set_config('app.trusted_update', 'true', true);
  update public.profiles set premium = true where id = auth.uid();
end;
$$;

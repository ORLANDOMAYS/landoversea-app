-- Forward-only cleanup for legacy photo URLs and exact profile coordinates.

create or replace function public.decode_legacy_url_path(encoded text)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
  output bytea := ''::bytea;
  index integer := 1;
  character text;
begin
  while index <= length(encoded) loop
    character := substr(encoded, index, 1);
    if character = '%' then
      if index + 2 > length(encoded)
        or substr(encoded, index + 1, 2) !~ '^[0-9A-Fa-f]{2}$' then
        return null;
      end if;
      output := output || decode(substr(encoded, index + 1, 2), 'hex');
      index := index + 3;
    else
      output := output || convert_to(character, 'UTF8');
      index := index + 1;
    end if;
  end loop;
  return convert_from(output, 'UTF8');
exception when others then
  return null;
end;
$$;

alter table public.photos disable trigger enforce_photo_write_trigger;

with legacy_paths as (
  select
    p.id,
    p.user_id,
    public.decode_legacy_url_path(
      (regexp_match(
        p.url,
        '/storage/v1/object/(public|sign|authenticated)/photos/([^?#]+)'
      ))[2]
    ) as object_path
  from public.photos p
  where p.url ~ '^https?://'
)
update public.photos p
set url = legacy_paths.object_path
from legacy_paths
where p.id = legacy_paths.id
  and legacy_paths.object_path is not null
  and split_part(legacy_paths.object_path, '/', 1) = p.user_id::text
  and legacy_paths.object_path ~ '^[0-9A-Fa-f-]+/[^/].*$'
  and legacy_paths.object_path !~ '(^|/)\.\.?(/|$)'
  and legacy_paths.object_path !~ E'[\\\\[:cntrl:]]';

alter table public.photos enable trigger enforce_photo_write_trigger;

drop function public.decode_legacy_url_path(text);

-- Existing profile coordinates become owner-only location records. Nullable
-- labels preserve the original data without inventing a city or country.
alter table public.user_locations
  alter column city drop not null,
  alter column country drop not null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'latitude'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'longitude'
  ) then
    execute $move$
      insert into public.user_locations (
        user_id, city, country, latitude, longitude, active
      )
      select p.id, p.city, p.country, p.latitude, p.longitude, true
      from public.profiles p
      where (p.latitude is not null or p.longitude is not null)
        and not exists (
          select 1
          from public.user_locations ul
          where ul.user_id = p.id
            and ul.latitude is not distinct from p.latitude
            and ul.longitude is not distinct from p.longitude
        )
    $move$;
  end if;
end;
$$;

alter table public.profiles
  drop column if exists latitude,
  drop column if exists longitude;
alter table public.profiles
  add column if not exists learning_languages text[] default '{}'::text[],
  add column if not exists relationship_goal text,
  add column if not exists interests text[] default '{}'::text[],
  add column if not exists cultural_interests text[] default '{}'::text[],
  add column if not exists countries_of_interest text[] default '{}'::text[],
  add column if not exists relocation_openness boolean default false,
  add column if not exists long_distance boolean default false,
  add column if not exists preferred_min_age integer,
  add column if not exists preferred_max_age integer;

comment on column public.profiles.learning_languages is
  'Languages the member is learning or can use for discovery matching.';
comment on column public.profiles.relationship_goal is
  'Member-selected relationship goal used by profile and discovery filters.';
comment on column public.profiles.interests is
  'Member interests used for shared-interest discovery matching.';
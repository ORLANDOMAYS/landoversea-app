revoke select, insert, update, delete on table public.profiles from authenticated;

grant select (
  id,
  display_name,
  bio,
  avatar_url,
  age,
  gender,
  interested_in,
  language,
  verified,
  premium,
  city,
  country,
  learning_languages,
  relationship_goal,
  interests,
  cultural_interests,
  countries_of_interest,
  relocation_openness,
  long_distance,
  preferred_min_age,
  preferred_max_age,
  created_at
) on table public.profiles to authenticated;

grant insert (
  id,
  display_name,
  bio,
  age,
  gender,
  interested_in,
  language,
  city,
  country,
  learning_languages,
  relationship_goal,
  interests,
  cultural_interests,
  countries_of_interest,
  relocation_openness,
  long_distance,
  preferred_min_age,
  preferred_max_age
) on table public.profiles to authenticated;

grant update (
  display_name,
  bio,
  age,
  gender,
  interested_in,
  language,
  city,
  country,
  learning_languages,
  relationship_goal,
  interests,
  cultural_interests,
  countries_of_interest,
  relocation_openness,
  long_distance,
  preferred_min_age,
  preferred_max_age
) on table public.profiles to authenticated;
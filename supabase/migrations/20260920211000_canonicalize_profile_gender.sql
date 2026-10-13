update public.profiles
set gender = case lower(trim(gender))
  when 'male' then 'male'
  when 'man' then 'male'
  when 'female' then 'female'
  when 'woman' then 'female'
  when 'non_binary' then 'non_binary'
  when 'non-binary' then 'non_binary'
  when 'non binary' then 'non_binary'
  when 'nonbinary' then 'non_binary'
  else gender
end
where gender is not null
  and lower(trim(gender)) in (
    'male',
    'man',
    'female',
    'woman',
    'non_binary',
    'non-binary',
    'non binary',
    'nonbinary'
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_gender_canonical_check'
  ) then
    alter table public.profiles
      add constraint profiles_gender_canonical_check
      check (
        gender is null
        or gender in (
          'male',
          'female',
          'non_binary',
          'transgender',
          'prefer_not_to_say',
          'other'
        )
      )
      not valid;
  end if;
end
$$;

alter table public.profiles
  validate constraint profiles_gender_canonical_check;
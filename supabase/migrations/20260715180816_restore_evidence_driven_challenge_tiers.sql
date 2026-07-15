alter table public.violations
  add column if not exists challenge_tier text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.violations'::regclass
      and conname = 'violations_challenge_tier_check'
  ) then
    alter table public.violations
      add constraint violations_challenge_tier_check
      check (challenge_tier is null or challenge_tier in (
        'strong', 'moderate', 'investigate', 'not_challengeable', 'operational'
      ));
  end if;
end
$$;

create index if not exists idx_violations_challenge_tier
  on public.violations (client_id, challenge_tier);

create or replace function public.derive_violation_challengeable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.challengeable := case
    when new.challenge_tier is null then null
    else new.challenge_tier in ('strong', 'moderate')
  end;
  return new;
end;
$$;

revoke all on function public.derive_violation_challengeable() from public;

drop trigger if exists derive_violation_challengeable on public.violations;
create trigger derive_violation_challengeable
before insert or update of challenge_tier, challengeable
on public.violations
for each row execute function public.derive_violation_challengeable();

comment on column public.violations.challenge_tier is
  'Evidence-driven classification: strong/moderate are proven data-error subtiers; investigate needs evidence; not_challengeable/operational are legitimate Lane C outcomes. challengeable is derived from this tier.';

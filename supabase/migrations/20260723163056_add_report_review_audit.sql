alter table public.reports
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.reports'::regclass
      and conname = 'reports_reviewed_by_fkey'
  ) then
    alter table public.reports
      add constraint reports_reviewed_by_fkey
      foreign key (reviewed_by)
      references public.users(id)
      on delete set null;
  end if;
end
$$;

comment on column public.reports.reviewed_by is
  'Staff user who moved the report draft into reviewed status.';

comment on column public.reports.reviewed_at is
  'Timestamp when a staff reviewer moved the report draft into reviewed status.';

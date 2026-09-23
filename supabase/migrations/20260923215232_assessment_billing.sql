create table if not exists public.assessment_billing (
  client_id uuid primary key references public.clients(id) on delete cascade,
  geia_insured boolean not null default false,
  waived_by uuid references auth.users(id),
  waived_at timestamptz,
  paid_at timestamptz,
  stripe_checkout_session_id text unique,
  stripe_livemode boolean,
  constraint assessment_waiver_actor check (not geia_insured or (waived_by is not null and waived_at is not null)),
  constraint assessment_payment_receipt check ((paid_at is null and stripe_checkout_session_id is null and stripe_livemode is null) or (paid_at is not null and stripe_checkout_session_id is not null and stripe_livemode is not null))
);
alter table public.assessment_billing enable row level security;
revoke all on public.assessment_billing from anon, authenticated;
grant select on public.assessment_billing to authenticated;
grant all on public.assessment_billing to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='assessment_billing' and policyname='assessment_billing_staff_read') then
    create policy assessment_billing_staff_read on public.assessment_billing for select to authenticated using ((select public.is_geia_staff()));
  end if;
end $$;
create index if not exists assessment_billing_waived_by_idx on public.assessment_billing(waived_by);

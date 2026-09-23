-- Preserve existing content and visibility. NULL denotes a legacy visible version,
-- not evidence that a review occurred. Only future inserts default to draft.
alter table public.client_playbooks
  add column if not exists review_status text,
  add column if not exists reviewed_by uuid references public.users(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists published_by uuid references public.users(id),
  add column if not exists published_at timestamptz;
alter table public.client_playbooks alter column review_status set default 'draft';
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.client_playbooks'::regclass and conname='client_playbooks_review_state') then
    alter table public.client_playbooks add constraint client_playbooks_review_state check (
      review_status is null or review_status = 'draft' or
      (review_status = 'reviewed' and reviewed_by is not null and reviewed_at is not null) or
      (review_status = 'published' and reviewed_by is not null and reviewed_at is not null and published_by is not null and published_at is not null)
    );
  end if;
end $$;
comment on column public.client_playbooks.review_status is 'NULL: legacy visible version without a recorded review. New versions: draft -> reviewed -> published.';

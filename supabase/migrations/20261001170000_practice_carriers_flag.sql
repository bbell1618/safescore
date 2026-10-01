-- Practice copies of real carriers for end-to-end staff rehearsal. Additive only.
-- A practice copy stores dot_number as 'PR' || <real DOT>; FMCSA calls strip the prefix.
alter table public.clients add column if not exists is_practice boolean not null default false;

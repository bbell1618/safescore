alter table public.alerts
  add column if not exists entity_type text,
  add column if not exists entity_id uuid;

create unique index if not exists alerts_client_entity_unique
  on public.alerts (client_id, entity_type, entity_id)
  where entity_type is not null and entity_id is not null;

comment on column public.alerts.entity_type is
  'Source table for the monitored entity that produced this alert.';
comment on column public.alerts.entity_id is
  'Source row UUID; paired with client_id and entity_type for alert deduplication.';

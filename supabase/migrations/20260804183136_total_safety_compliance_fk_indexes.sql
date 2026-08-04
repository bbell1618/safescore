-- Cover the tenant-safe composite foreign keys introduced by the U9 compliance layer.
-- These are additive indexes only; no data or constraints are changed.

create index if not exists idx_driver_documents_driver_client
  on public.driver_documents(driver_id, client_id);
create index if not exists idx_driver_documents_document_client
  on public.driver_documents(document_id, client_id)
  where document_id is not null;

create index if not exists idx_vehicle_maintenance_vehicle_client
  on public.vehicle_maintenance(vehicle_id, client_id);
create index if not exists idx_vehicle_maintenance_document_client
  on public.vehicle_maintenance(document_id, client_id)
  where document_id is not null;

create index if not exists idx_clearinghouse_records_driver_client
  on public.clearinghouse_records(driver_id, client_id)
  where driver_id is not null;
create index if not exists idx_clearinghouse_records_document_client
  on public.clearinghouse_records(document_id, client_id)
  where document_id is not null;

create index if not exists idx_compliance_expiration_events_digest_client
  on public.compliance_expiration_events(digest_id, client_id)
  where digest_id is not null;
create index if not exists idx_compliance_expiration_events_alert_client
  on public.compliance_expiration_events(alert_id, client_id)
  where alert_id is not null;
create index if not exists idx_compliance_expiration_events_request_client
  on public.compliance_expiration_events(client_request_id, client_id)
  where client_request_id is not null;

-- 20260610b_carrier_profiles_columns.sql
-- Phase A data-fix: ensure carrier_profiles has all columns the analysis import
-- upsert writes, plus the UNIQUE(client_id) index that onConflict:"client_id"
-- depends on. All statements are idempotent (IF NOT EXISTS) so they are safe to
-- re-run against environments where some columns already exist.

ALTER TABLE carrier_profiles ADD COLUMN IF NOT EXISTS mcs150_mileage_year INTEGER;
ALTER TABLE carrier_profiles ADD COLUMN IF NOT EXISTS safety_rating_date DATE;
ALTER TABLE carrier_profiles ADD COLUMN IF NOT EXISTS review_type TEXT;
ALTER TABLE carrier_profiles ADD COLUMN IF NOT EXISTS review_date DATE;
ALTER TABLE carrier_profiles ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE carrier_profiles ADD COLUMN IF NOT EXISTS carrier_operation TEXT;

-- onConflict:"client_id" in the import upsert requires a unique constraint/index
-- on client_id. carrier_profiles_client_id_key already provides this; the index
-- below is a defensive idempotent guarantee for environments missing it.
CREATE UNIQUE INDEX IF NOT EXISTS carrier_profiles_client_id_unique ON carrier_profiles(client_id);

-- Phase A data foundation
-- Workstream 1: per-BASIC alert flags on score_snapshots
--   alert = carrier exceeded the FMCSA intervention threshold for that BASIC
--   (QCMobile basics: exceededFMCSAInterventionThreshold === "1")
ALTER TABLE score_snapshots ADD COLUMN IF NOT EXISTS unsafe_driving_alert       BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE score_snapshots ADD COLUMN IF NOT EXISTS hos_compliance_alert       BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE score_snapshots ADD COLUMN IF NOT EXISTS driver_fitness_alert       BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE score_snapshots ADD COLUMN IF NOT EXISTS controlled_substance_alert BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE score_snapshots ADD COLUMN IF NOT EXISTS vehicle_maint_alert        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE score_snapshots ADD COLUMN IF NOT EXISTS hm_compliance_alert        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE score_snapshots ADD COLUMN IF NOT EXISTS crash_indicator_alert      BOOLEAN NOT NULL DEFAULT FALSE;

-- Workstream 2: carrier_profiles census + authority/safety-review enrichment
--   getCarrier() now populates these from the QCMobile /carriers/:dot response
ALTER TABLE carrier_profiles ADD COLUMN IF NOT EXISTS mcs150_mileage_year INTEGER;
ALTER TABLE carrier_profiles ADD COLUMN IF NOT EXISTS safety_rating_date  DATE;
ALTER TABLE carrier_profiles ADD COLUMN IF NOT EXISTS review_type         TEXT;
ALTER TABLE carrier_profiles ADD COLUMN IF NOT EXISTS review_date         DATE;
ALTER TABLE carrier_profiles ADD COLUMN IF NOT EXISTS entity_type         TEXT;
ALTER TABLE carrier_profiles ADD COLUMN IF NOT EXISTS carrier_operation   TEXT;

-- Enable clean upsert of carrier census data keyed by client.
ALTER TABLE carrier_profiles
  ADD CONSTRAINT carrier_profiles_client_id_key UNIQUE (client_id);

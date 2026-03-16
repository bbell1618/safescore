-- Golden Era SafeScore — Initial Schema
-- Run this in your Supabase SQL editor: https://app.supabase.com → SQL Editor
-- Requires pgcrypto extension for credential encryption

-- ── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Enums ────────────────────────────────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('geia_admin', 'geia_staff', 'client_user');
CREATE TYPE client_tier AS ENUM ('monitor', 'remediate', 'total_safety');
CREATE TYPE client_status AS ENUM ('prospect', 'active', 'paused', 'churned');
CREATE TYPE subscription_status AS ENUM ('trialing', 'active', 'past_due', 'canceled');
CREATE TYPE basic_category AS ENUM (
  'unsafe_driving', 'hos_compliance', 'driver_fitness',
  'controlled_substance', 'vehicle_maintenance', 'hazmat_compliance', 'crash_indicator'
);
CREATE TYPE challenge_priority AS ENUM ('high', 'medium', 'low');
CREATE TYPE case_status AS ENUM (
  'draft', 'filed', 'pending_state', 'pending_fmcsa',
  'approved', 'denied', 'reconsidering', 'closed'
);
CREATE TYPE cpdp_status AS ENUM ('draft', 'filed', 'pending', 'determination_made', 'closed');
CREATE TYPE cpdp_outcome AS ENUM ('preventable', 'not_preventable', 'undecided', 'dismissed');
CREATE TYPE report_type AS ENUM ('assessment', 'monthly', 'quarterly', 'improvement', 'underwriter');
CREATE TYPE report_status AS ENUM ('draft', 'reviewed', 'sent');
CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'critical');
CREATE TYPE document_category AS ENUM (
  'evidence', 'dqf', 'maintenance', 'clearinghouse', 'report', 'auth_agreement', 'other'
);
CREATE TYPE action_item_type AS ENUM ('dataq', 'cpdp', 'mcs150', 'compliance', 'monitoring');
CREATE TYPE action_item_status AS ENUM ('pending', 'in_progress', 'completed', 'dismissed');
CREATE TYPE driver_doc_type AS ENUM ('cdl', 'medical_cert', 'mvr', 'application', 'road_test', 'training');
CREATE TYPE doc_expiry_status AS ENUM ('current', 'expiring_soon', 'expired', 'missing');
CREATE TYPE driver_status AS ENUM ('active', 'inactive', 'terminated');
CREATE TYPE vehicle_status AS ENUM ('active', 'inactive');

-- ─────────────────────────────────────────────────────────────────────────────
-- GROUP 1: CLIENT MANAGEMENT
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  dot_number      TEXT NOT NULL UNIQUE,
  mc_number       TEXT,
  address         TEXT,
  city            TEXT,
  state           CHAR(2),
  zip             TEXT,
  phone           TEXT,
  email           TEXT,
  primary_contact TEXT,
  fleet_size      INTEGER,
  driver_count    INTEGER,
  tier            client_tier,
  status          client_status NOT NULL DEFAULT 'prospect',
  geia_client     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tier                    client_tier NOT NULL,
  status                  subscription_status NOT NULL DEFAULT 'trialing',
  mrr                     NUMERIC(10,2),
  billing_cycle           TEXT DEFAULT 'monthly', -- 'monthly' | 'annual'
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  trial_end               TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Encrypted credentials — GEIA staff only, never exposed to client_user
CREATE TABLE client_credentials (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                 UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE UNIQUE,
  fmcsa_dot_number          TEXT,
  fmcsa_pin_encrypted       BYTEA,      -- pgcrypto encrypted
  portal_username_encrypted BYTEA,      -- pgcrypto encrypted
  notes                     TEXT,
  last_used_at              TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users table — mirrors auth.users, adds role and client association
CREATE TABLE users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id   UUID REFERENCES clients(id) ON DELETE SET NULL, -- NULL for GEIA staff
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT,
  role        user_role NOT NULL DEFAULT 'client_user',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- GROUP 2: FMCSA SAFETY DATA
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE carrier_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  dot_number          TEXT NOT NULL,
  mc_number           TEXT,
  legal_name          TEXT,
  dba_name            TEXT,
  address             TEXT,
  phone               TEXT,
  power_units         INTEGER,
  drivers             INTEGER,
  mcs150_date         DATE,
  mcs150_mileage      INTEGER,
  cargo_types         TEXT[],
  insurance_status    TEXT,
  authority_status    TEXT,
  safety_rating       TEXT,
  raw_api_response    JSONB,
  fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_carrier_profiles_client ON carrier_profiles(client_id);

CREATE TABLE score_snapshots (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  snapshot_date                   DATE NOT NULL,
  unsafe_driving_measure          NUMERIC(6,2),
  unsafe_driving_pct              NUMERIC(5,2),
  hos_compliance_measure          NUMERIC(6,2),
  hos_compliance_pct              NUMERIC(5,2),
  driver_fitness_measure          NUMERIC(6,2),
  driver_fitness_pct              NUMERIC(5,2),
  controlled_substance_measure    NUMERIC(6,2),
  controlled_substance_pct        NUMERIC(5,2),
  vehicle_maint_measure           NUMERIC(6,2),
  vehicle_maint_pct               NUMERIC(5,2),
  hm_compliance_measure           NUMERIC(6,2),
  hm_compliance_pct               NUMERIC(5,2),
  crash_indicator_measure         NUMERIC(6,2),
  crash_indicator_pct             NUMERIC(5,2),
  oos_vehicle_rate                NUMERIC(5,2),
  oos_driver_rate                 NUMERIC(5,2),
  oos_hazmat_rate                 NUMERIC(5,2),
  source                          TEXT NOT NULL DEFAULT 'api', -- 'api' | 'manual'
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, snapshot_date)
);
CREATE INDEX idx_score_snapshots_client_date ON score_snapshots(client_id, snapshot_date DESC);

CREATE TABLE inspections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  dot_number        TEXT NOT NULL,
  report_number     TEXT NOT NULL,
  inspection_date   DATE NOT NULL,
  state             CHAR(2),
  level             TEXT,
  facility_name     TEXT,
  time_weight       INTEGER CHECK (time_weight IN (1, 2, 3)),
  total_violations  INTEGER NOT NULL DEFAULT 0,
  oos_violations    INTEGER NOT NULL DEFAULT 0,
  raw_data          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, report_number)
);
CREATE INDEX idx_inspections_client ON inspections(client_id);
CREATE INDEX idx_inspections_date ON inspections(client_id, inspection_date DESC);

CREATE TABLE violations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id         UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  violation_code        TEXT NOT NULL,
  violation_description TEXT NOT NULL,
  basic_category        basic_category,
  severity_weight       INTEGER,
  time_weight           INTEGER,
  oos_violation         BOOLEAN NOT NULL DEFAULT FALSE,
  convicted             BOOLEAN NOT NULL DEFAULT FALSE,
  citation_number       TEXT,
  challengeable         BOOLEAN,       -- NULL = not yet assessed
  challenge_reason      TEXT,
  challenge_priority    challenge_priority,
  ai_assessed_at        TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_violations_client ON violations(client_id);
CREATE INDEX idx_violations_inspection ON violations(inspection_id);
CREATE INDEX idx_violations_challengeable ON violations(client_id, challengeable);

CREATE TABLE crashes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  dot_number          TEXT NOT NULL,
  report_number       TEXT,
  crash_date          DATE NOT NULL,
  state               CHAR(2),
  city                TEXT,
  fatalities          INTEGER NOT NULL DEFAULT 0,
  injuries            INTEGER NOT NULL DEFAULT 0,
  tow_away            BOOLEAN NOT NULL DEFAULT FALSE,
  hazmat_release      BOOLEAN NOT NULL DEFAULT FALSE,
  preventable         BOOLEAN,          -- NULL = undetermined
  cpdp_eligible       BOOLEAN,          -- NULL = not yet assessed
  cpdp_eligible_types TEXT[],
  ai_assessed_at      TIMESTAMPTZ,
  raw_data            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_crashes_client ON crashes(client_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- GROUP 3: CASE MANAGEMENT
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE dataq_cases (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  violation_id      UUID REFERENCES violations(id) ON DELETE SET NULL,
  inspection_id     UUID REFERENCES inspections(id) ON DELETE SET NULL,
  case_number       TEXT,          -- FMCSA-assigned DataQs case number
  status            case_status NOT NULL DEFAULT 'draft',
  priority          challenge_priority,
  filed_date        DATE,
  state_deadline    DATE,          -- 14-day state response deadline
  last_status_check TIMESTAMPTZ,
  outcome_date      DATE,
  outcome           TEXT CHECK (outcome IN ('approved', 'denied', 'withdrawn')),
  ai_narrative      TEXT,
  final_narrative   TEXT,
  filing_notes      TEXT,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_dataq_cases_client ON dataq_cases(client_id);
CREATE INDEX idx_dataq_cases_status ON dataq_cases(client_id, status);
CREATE INDEX idx_dataq_cases_deadline ON dataq_cases(state_deadline) WHERE state_deadline IS NOT NULL;

CREATE TABLE cpdp_cases (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  crash_id            UUID NOT NULL REFERENCES crashes(id) ON DELETE CASCADE,
  status              cpdp_status NOT NULL DEFAULT 'draft',
  filed_date          DATE,
  determination_date  DATE,
  outcome             cpdp_outcome,
  ai_narrative        TEXT,
  final_narrative     TEXT,
  filing_notes        TEXT,
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_cpdp_cases_client ON cpdp_cases(client_id);

CREATE TABLE action_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type                  action_item_type NOT NULL,
  title                 TEXT NOT NULL,
  description           TEXT,
  priority              challenge_priority NOT NULL DEFAULT 'medium',
  projected_impact_score NUMERIC(5,2),
  status                action_item_status NOT NULL DEFAULT 'pending',
  assigned_to           UUID REFERENCES users(id) ON DELETE SET NULL,
  due_date              DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_action_items_client ON action_items(client_id, status);

CREATE TABLE case_evidence (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_type   TEXT NOT NULL CHECK (case_type IN ('dataq', 'cpdp')),
  case_id     UUID NOT NULL,  -- dataq_cases.id or cpdp_cases.id
  document_id UUID NOT NULL,  -- documents.id (forward reference, FK added below)
  description TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE mcs150_updates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'pending_review', 'submitted', 'confirmed')),
  proposed_changes JSONB NOT NULL DEFAULT '{}',
  notes            TEXT,
  submitted_date   DATE,
  confirmed_date   DATE,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- GROUP 4: COMPLIANCE / TIER 3
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE drivers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  full_name           TEXT NOT NULL,
  cdl_number          TEXT,
  cdl_state           CHAR(2),
  cdl_expiry          DATE,
  medical_cert_expiry DATE,
  hired_date          DATE,
  status              driver_status NOT NULL DEFAULT 'active',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_drivers_client ON drivers(client_id);

CREATE TABLE driver_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  document_id UUID,            -- FK to documents added below
  doc_type    driver_doc_type NOT NULL,
  expiry_date DATE,
  status      doc_expiry_status NOT NULL DEFAULT 'current',
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_driver_docs_driver ON driver_documents(driver_id);
CREATE INDEX idx_driver_docs_expiry ON driver_documents(expiry_date) WHERE expiry_date IS NOT NULL;

CREATE TABLE vehicles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  unit_number   TEXT,
  vin           TEXT,
  year          INTEGER,
  make          TEXT,
  model         TEXT,
  license_plate TEXT,
  plate_state   CHAR(2),
  status        vehicle_status NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_vehicles_client ON vehicles(client_id);

CREATE TABLE vehicle_maintenance (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id       UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  maintenance_type TEXT NOT NULL,
  scheduled_date   DATE,
  completed_date   DATE,
  notes            TEXT,
  document_id      UUID,     -- FK to documents added below
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_vehicle_maint_vehicle ON vehicle_maintenance(vehicle_id);

CREATE TABLE clearinghouse_records (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  driver_id   UUID REFERENCES drivers(id) ON DELETE SET NULL,
  query_date  DATE NOT NULL,
  result_type TEXT NOT NULL CHECK (result_type IN ('negative', 'positive')),
  document_id UUID,     -- FK to documents added below
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- GROUP 5: REPORTS AND ALERTS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type          report_type NOT NULL,
  title         TEXT NOT NULL,
  status        report_status NOT NULL DEFAULT 'draft',
  ai_content    TEXT,
  final_content TEXT,
  sent_at       TIMESTAMPTZ,
  sent_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_reports_client ON reports(client_id, created_at DESC);

CREATE TABLE alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  severity     alert_severity NOT NULL DEFAULT 'info',
  title        TEXT NOT NULL,
  message      TEXT NOT NULL,
  read_at      TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_alerts_client ON alerts(client_id, created_at DESC);
CREATE INDEX idx_alerts_unread ON alerts(client_id) WHERE read_at IS NULL;

CREATE TABLE activity_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES clients(id) ON DELETE SET NULL,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id   UUID,
  description TEXT NOT NULL,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_activity_log_client ON activity_log(client_id, created_at DESC);
CREATE INDEX idx_activity_log_user ON activity_log(user_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- GROUP 6: DOCUMENT STORAGE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,   -- path in Supabase Storage bucket 'safescore-documents'
  filename     TEXT NOT NULL,
  file_size    BIGINT,
  mime_type    TEXT,
  category     document_category NOT NULL DEFAULT 'other',
  uploaded_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_documents_client ON documents(client_id, created_at DESC);

-- Add document FK constraints now that documents table exists
ALTER TABLE case_evidence ADD CONSTRAINT fk_case_evidence_document
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;

ALTER TABLE driver_documents ADD CONSTRAINT fk_driver_docs_document
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL;

ALTER TABLE vehicle_maintenance ADD CONSTRAINT fk_vehicle_maint_document
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL;

ALTER TABLE clearinghouse_records ADD CONSTRAINT fk_clearinghouse_document
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATED_AT TRIGGERS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_client_credentials_updated_at
  BEFORE UPDATE ON client_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_dataq_cases_updated_at
  BEFORE UPDATE ON dataq_cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_cpdp_cases_updated_at
  BEFORE UPDATE ON cpdp_cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_action_items_updated_at
  BEFORE UPDATE ON action_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper function: get current user's role and client_id from users table
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS user_role AS $$
  SELECT role FROM users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_user_client_id()
RETURNS UUID AS $$
  SELECT client_id FROM users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_geia_staff()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(get_user_role() IN ('geia_admin', 'geia_staff'), FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Enable RLS on all tables
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE crashes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dataq_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE cpdp_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcs150_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE clearinghouse_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- ── client_credentials: GEIA staff ONLY ─────────────────────────────────────
CREATE POLICY "geia_staff_only" ON client_credentials
  FOR ALL USING (is_geia_staff());

-- ── All other tables: staff see all, client sees own ────────────────────────
-- Macro to create staff + client policies for tables with client_id column

-- clients
CREATE POLICY "clients_staff" ON clients FOR ALL USING (is_geia_staff());
CREATE POLICY "clients_client" ON clients FOR SELECT
  USING (id = get_user_client_id());

-- subscriptions
CREATE POLICY "subs_staff" ON subscriptions FOR ALL USING (is_geia_staff());
CREATE POLICY "subs_client" ON subscriptions FOR SELECT
  USING (client_id = get_user_client_id());

-- users
CREATE POLICY "users_staff" ON users FOR ALL USING (is_geia_staff());
CREATE POLICY "users_self" ON users FOR SELECT USING (id = auth.uid());

-- carrier_profiles
CREATE POLICY "cp_staff" ON carrier_profiles FOR ALL USING (is_geia_staff());
CREATE POLICY "cp_client" ON carrier_profiles FOR SELECT
  USING (client_id = get_user_client_id());

-- score_snapshots
CREATE POLICY "ss_staff" ON score_snapshots FOR ALL USING (is_geia_staff());
CREATE POLICY "ss_client" ON score_snapshots FOR SELECT
  USING (client_id = get_user_client_id());

-- inspections
CREATE POLICY "insp_staff" ON inspections FOR ALL USING (is_geia_staff());
CREATE POLICY "insp_client" ON inspections FOR SELECT
  USING (client_id = get_user_client_id());

-- violations
CREATE POLICY "viol_staff" ON violations FOR ALL USING (is_geia_staff());
CREATE POLICY "viol_client" ON violations FOR SELECT
  USING (client_id = get_user_client_id());

-- crashes
CREATE POLICY "crash_staff" ON crashes FOR ALL USING (is_geia_staff());
CREATE POLICY "crash_client" ON crashes FOR SELECT
  USING (client_id = get_user_client_id());

-- dataq_cases
CREATE POLICY "dq_staff" ON dataq_cases FOR ALL USING (is_geia_staff());
CREATE POLICY "dq_client" ON dataq_cases FOR SELECT
  USING (client_id = get_user_client_id());

-- cpdp_cases
CREATE POLICY "cpdp_staff" ON cpdp_cases FOR ALL USING (is_geia_staff());
CREATE POLICY "cpdp_client" ON cpdp_cases FOR SELECT
  USING (client_id = get_user_client_id());

-- action_items
CREATE POLICY "ai_staff" ON action_items FOR ALL USING (is_geia_staff());
CREATE POLICY "ai_client" ON action_items FOR SELECT
  USING (client_id = get_user_client_id());

-- case_evidence (no direct client_id; client sees via case)
CREATE POLICY "ce_staff" ON case_evidence FOR ALL USING (is_geia_staff());

-- mcs150_updates
CREATE POLICY "mcs_staff" ON mcs150_updates FOR ALL USING (is_geia_staff());
CREATE POLICY "mcs_client" ON mcs150_updates FOR SELECT
  USING (client_id = get_user_client_id());

-- drivers
CREATE POLICY "drv_staff" ON drivers FOR ALL USING (is_geia_staff());
CREATE POLICY "drv_client" ON drivers FOR SELECT
  USING (client_id = get_user_client_id());

-- driver_documents
CREATE POLICY "drvdoc_staff" ON driver_documents FOR ALL USING (is_geia_staff());
CREATE POLICY "drvdoc_client" ON driver_documents FOR SELECT
  USING (client_id = get_user_client_id());

-- vehicles
CREATE POLICY "veh_staff" ON vehicles FOR ALL USING (is_geia_staff());
CREATE POLICY "veh_client" ON vehicles FOR SELECT
  USING (client_id = get_user_client_id());

-- vehicle_maintenance
CREATE POLICY "vm_staff" ON vehicle_maintenance FOR ALL USING (is_geia_staff());
CREATE POLICY "vm_client" ON vehicle_maintenance FOR SELECT
  USING (client_id = get_user_client_id());

-- clearinghouse_records
CREATE POLICY "ch_staff" ON clearinghouse_records FOR ALL USING (is_geia_staff());
CREATE POLICY "ch_client" ON clearinghouse_records FOR SELECT
  USING (client_id = get_user_client_id());

-- reports
CREATE POLICY "rep_staff" ON reports FOR ALL USING (is_geia_staff());
CREATE POLICY "rep_client" ON reports FOR SELECT
  USING (client_id = get_user_client_id() AND status = 'sent');

-- alerts
CREATE POLICY "alert_staff" ON alerts FOR ALL USING (is_geia_staff());
CREATE POLICY "alert_client" ON alerts FOR SELECT
  USING (client_id = get_user_client_id());
CREATE POLICY "alert_client_update" ON alerts FOR UPDATE
  USING (client_id = get_user_client_id());  -- client can mark read/dismissed

-- activity_log
CREATE POLICY "log_staff" ON activity_log FOR ALL USING (is_geia_staff());
CREATE POLICY "log_client" ON activity_log FOR SELECT
  USING (client_id = get_user_client_id());

-- documents
CREATE POLICY "doc_staff" ON documents FOR ALL USING (is_geia_staff());
CREATE POLICY "doc_client" ON documents FOR SELECT
  USING (client_id = get_user_client_id());
CREATE POLICY "doc_client_insert" ON documents FOR INSERT
  WITH CHECK (client_id = get_user_client_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- AUTO-CREATE USER RECORD ON SIGNUP
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO users (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'client_user')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- STORAGE BUCKET (run separately or via Supabase dashboard)
-- ─────────────────────────────────────────────────────────────────────────────
-- INSERT INTO storage.buckets (id, name, public) VALUES ('safescore-documents', 'safescore-documents', false);
-- Storage policies are set via Supabase dashboard or Storage API — see SETUP.md

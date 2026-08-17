export type ComplianceDriverRow = {
  id: string;
  client_id: string;
  full_name: string;
  cdl_number: string | null;
  cdl_state: string | null;
  cdl_class: string | null;
  cdl_expiry: string | null;
  medical_cert_expiry: string | null;
  hired_date: string | null;
  status: "active" | "inactive" | "terminated";
  source: "operator" | "client_portal";
  approved_at: string | null;
  approved_by: string | null;
  request_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type DriverDocumentType =
  | "cdl"
  | "medical_cert"
  | "mvr"
  | "application"
  | "road_test"
  | "training"
  | "prior_employer_checks"
  | "annual_mvr_review"
  | "clearinghouse_pre_employment";

export type ComplianceDriverDocumentRow = {
  id: string;
  driver_id: string;
  client_id: string;
  document_id: string | null;
  doc_type: DriverDocumentType;
  completed_date: string | null;
  expiry_date: string | null;
  status: "current" | "expiring_soon" | "expired" | "missing";
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ComplianceVehicleRow = {
  id: string;
  client_id: string;
  unit_number: string | null;
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  license_plate: string | null;
  plate_state: string | null;
  annual_inspection_date: string | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
};

export type ComplianceMaintenanceRow = {
  id: string;
  vehicle_id: string;
  client_id: string;
  maintenance_type: "pm_service" | "repair" | "annual_inspection";
  scheduled_date: string | null;
  completed_date: string | null;
  notes: string | null;
  document_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ComplianceClearinghouseRow = {
  id: string;
  client_id: string;
  driver_id: string | null;
  query_date: string;
  result_type: "negative" | "positive";
  document_id: string | null;
  created_at: string;
};

export type ComplianceProfileRow = {
  id: string;
  client_id: string;
  clearinghouse_registration_status:
    | "unknown"
    | "registered"
    | "not_registered";
  clearinghouse_registration_checked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ComplianceDocumentOption = {
  id: string;
  filename: string;
  category: string;
  created_at: string;
};

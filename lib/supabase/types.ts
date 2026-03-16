export type UserRole = "geia_admin" | "geia_staff" | "client_user";
export type ClientTier = "monitor" | "remediate" | "total_safety";
export type ClientStatus = "prospect" | "active" | "paused" | "churned";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";
export type BasicCategory =
  | "unsafe_driving"
  | "hos_compliance"
  | "driver_fitness"
  | "controlled_substance"
  | "vehicle_maintenance"
  | "hazmat_compliance"
  | "crash_indicator";
export type ChallengePriority = "high" | "medium" | "low";
export type CaseStatus =
  | "draft"
  | "filed"
  | "pending_state"
  | "pending_fmcsa"
  | "approved"
  | "denied"
  | "reconsidering"
  | "closed";
export type CpdpStatus = "draft" | "filed" | "pending" | "determination_made" | "closed";
export type CpdpOutcome = "preventable" | "not_preventable" | "undecided" | "dismissed";
export type ReportType = "assessment" | "monthly" | "quarterly" | "improvement" | "underwriter";
export type ReportStatus = "draft" | "reviewed" | "sent";
export type AlertSeverity = "info" | "warning" | "critical";
export type DocumentCategory =
  | "evidence"
  | "dqf"
  | "maintenance"
  | "clearinghouse"
  | "report"
  | "auth_agreement"
  | "other";
export type ActionItemType = "dataq" | "cpdp" | "mcs150" | "compliance" | "monitoring";
export type ActionItemStatus = "pending" | "in_progress" | "completed" | "dismissed";

export interface Database {
  public: {
    Tables: {
      clients: {
        Row: {
          id: string;
          name: string;
          dot_number: string;
          mc_number: string | null;
          address: string | null;
          city: string | null;
          state: string | null;
          zip: string | null;
          phone: string | null;
          email: string | null;
          primary_contact: string | null;
          fleet_size: number | null;
          driver_count: number | null;
          tier: ClientTier | null;
          status: ClientStatus;
          geia_client: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["clients"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["clients"]["Insert"]>;
      };
      users: {
        Row: {
          id: string;
          client_id: string | null;
          email: string;
          full_name: string | null;
          role: UserRole;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["users"]["Row"], "created_at">;
        Update: Partial<Database["public"]["Tables"]["users"]["Insert"]>;
      };
      carrier_profiles: {
        Row: {
          id: string;
          client_id: string;
          dot_number: string;
          mc_number: string | null;
          legal_name: string | null;
          dba_name: string | null;
          address: string | null;
          phone: string | null;
          power_units: number | null;
          drivers: number | null;
          mcs150_date: string | null;
          mcs150_mileage: number | null;
          cargo_types: string[] | null;
          insurance_status: string | null;
          authority_status: string | null;
          safety_rating: string | null;
          raw_api_response: Record<string, unknown> | null;
          fetched_at: string;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["carrier_profiles"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["carrier_profiles"]["Insert"]>;
      };
      score_snapshots: {
        Row: {
          id: string;
          client_id: string;
          snapshot_date: string;
          unsafe_driving_measure: number | null;
          unsafe_driving_pct: number | null;
          hos_compliance_measure: number | null;
          hos_compliance_pct: number | null;
          driver_fitness_measure: number | null;
          driver_fitness_pct: number | null;
          controlled_substance_measure: number | null;
          controlled_substance_pct: number | null;
          vehicle_maint_measure: number | null;
          vehicle_maint_pct: number | null;
          hm_compliance_measure: number | null;
          hm_compliance_pct: number | null;
          crash_indicator_measure: number | null;
          crash_indicator_pct: number | null;
          oos_vehicle_rate: number | null;
          oos_driver_rate: number | null;
          oos_hazmat_rate: number | null;
          source: string;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["score_snapshots"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["score_snapshots"]["Insert"]>;
      };
      inspections: {
        Row: {
          id: string;
          client_id: string;
          dot_number: string;
          report_number: string;
          inspection_date: string;
          state: string | null;
          level: string | null;
          facility_name: string | null;
          time_weight: number | null;
          total_violations: number;
          oos_violations: number;
          raw_data: Record<string, unknown> | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["inspections"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["inspections"]["Insert"]>;
      };
      violations: {
        Row: {
          id: string;
          inspection_id: string;
          client_id: string;
          violation_code: string;
          violation_description: string;
          basic_category: BasicCategory | null;
          severity_weight: number | null;
          time_weight: number | null;
          oos_violation: boolean;
          convicted: boolean;
          citation_number: string | null;
          challengeable: boolean | null;
          challenge_reason: string | null;
          challenge_priority: ChallengePriority | null;
          ai_assessed_at: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["violations"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["violations"]["Insert"]>;
      };
      crashes: {
        Row: {
          id: string;
          client_id: string;
          dot_number: string;
          report_number: string | null;
          crash_date: string;
          state: string | null;
          city: string | null;
          fatalities: number;
          injuries: number;
          tow_away: boolean;
          hazmat_release: boolean;
          preventable: boolean | null;
          cpdp_eligible: boolean | null;
          cpdp_eligible_types: string[] | null;
          ai_assessed_at: string | null;
          raw_data: Record<string, unknown> | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["crashes"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["crashes"]["Insert"]>;
      };
      dataq_cases: {
        Row: {
          id: string;
          client_id: string;
          violation_id: string | null;
          inspection_id: string | null;
          case_number: string | null;
          status: CaseStatus;
          priority: ChallengePriority | null;
          filed_date: string | null;
          state_deadline: string | null;
          last_status_check: string | null;
          outcome_date: string | null;
          outcome: "approved" | "denied" | "withdrawn" | null;
          ai_narrative: string | null;
          final_narrative: string | null;
          filing_notes: string | null;
          created_by: string | null;
          updated_at: string;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["dataq_cases"]["Row"], "id" | "updated_at" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["dataq_cases"]["Insert"]>;
      };
      cpdp_cases: {
        Row: {
          id: string;
          client_id: string;
          crash_id: string;
          status: CpdpStatus;
          filed_date: string | null;
          determination_date: string | null;
          outcome: CpdpOutcome | null;
          ai_narrative: string | null;
          final_narrative: string | null;
          filing_notes: string | null;
          created_by: string | null;
          updated_at: string;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["cpdp_cases"]["Row"], "id" | "updated_at" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["cpdp_cases"]["Insert"]>;
      };
      action_items: {
        Row: {
          id: string;
          client_id: string;
          type: ActionItemType;
          title: string;
          description: string | null;
          priority: ChallengePriority;
          projected_impact_score: number | null;
          status: ActionItemStatus;
          assigned_to: string | null;
          due_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["action_items"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["action_items"]["Insert"]>;
      };
      reports: {
        Row: {
          id: string;
          client_id: string;
          type: ReportType;
          title: string;
          status: ReportStatus;
          ai_content: string | null;
          final_content: string | null;
          sent_at: string | null;
          sent_by: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["reports"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["reports"]["Insert"]>;
      };
      alerts: {
        Row: {
          id: string;
          client_id: string;
          type: string;
          severity: AlertSeverity;
          title: string;
          message: string;
          read_at: string | null;
          dismissed_at: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["alerts"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["alerts"]["Insert"]>;
      };
      activity_log: {
        Row: {
          id: string;
          client_id: string | null;
          user_id: string | null;
          action_type: string;
          entity_type: string | null;
          entity_id: string | null;
          description: string;
          metadata: Record<string, unknown> | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["activity_log"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["activity_log"]["Insert"]>;
      };
      documents: {
        Row: {
          id: string;
          client_id: string;
          storage_path: string;
          filename: string;
          file_size: number | null;
          mime_type: string | null;
          category: DocumentCategory;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["documents"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["documents"]["Insert"]>;
      };
      drivers: {
        Row: {
          id: string;
          client_id: string;
          full_name: string;
          cdl_number: string | null;
          cdl_state: string | null;
          cdl_expiry: string | null;
          medical_cert_expiry: string | null;
          hired_date: string | null;
          status: "active" | "inactive" | "terminated";
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["drivers"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["drivers"]["Insert"]>;
      };
      vehicles: {
        Row: {
          id: string;
          client_id: string;
          unit_number: string | null;
          vin: string | null;
          year: number | null;
          make: string | null;
          model: string | null;
          license_plate: string | null;
          plate_state: string | null;
          status: "active" | "inactive";
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["vehicles"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["vehicles"]["Insert"]>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}

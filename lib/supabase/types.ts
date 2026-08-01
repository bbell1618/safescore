export type UserRole = "geia_admin" | "geia_staff" | "client_user";
export type ClientTier = "assessment" | "monitor" | "remediate" | "total_safety";
export type ClientStatus =
  | "onboarding"
  | "prospect"
  | "awaiting_activation"
  | "active"
  | "paused"
  | "churned";
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
// 'pending' is a deprecated enum value — all DB rows were migrated to 'filed'.
// The DB enum retains 'pending' to avoid risky enum surgery on live data.
// In the UI, 'pending' is treated identically to 'filed' ("Filed / Pending FMCSA").
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
          citation_dismissed_last_24_months: boolean | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["clients"]["Row"],
          "id" | "created_at" | "updated_at" | "citation_dismissed_last_24_months"
        > &
          Partial<
            Pick<
              Database["public"]["Tables"]["clients"]["Row"],
              "citation_dismissed_last_24_months"
            >
          >;
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
          mcs150_mileage_year: number | null;
          cargo_types: string[] | null;
          insurance_status: string | null;
          authority_status: string | null;
          safety_rating: string | null;
          safety_rating_date: string | null;
          review_type: string | null;
          review_date: string | null;
          entity_type: string | null;
          carrier_operation: string | null;
          operation_classification: string | null;
          physical_address: string | null;
          mailing_address: string | null;
          safer_as_of: string | null;
          national_vehicle_oos_rate: number | null;
          national_driver_oos_rate: number | null;
          national_hazmat_oos_rate: number | null;
          raw_api_response: Record<string, unknown> | null;
          fetched_at: string;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["carrier_profiles"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["carrier_profiles"]["Insert"]>;
      };
      carrier_profile_enrichments: {
        Row: {
          id: string;
          client_id: string;
          source:
            | "safer_company_snapshot"
            | "fmcsa_motus"
            | "fmcsa_sms_inspections";
          source_url: string;
          source_as_of: string | null;
          fetched_at: string;
          currentness: "current" | "historical_only" | "no_data";
          data: Record<string, unknown>;
          parser_version: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          source:
            | "safer_company_snapshot"
            | "fmcsa_motus"
            | "fmcsa_sms_inspections";
          source_url: string;
          source_as_of?: string | null;
          fetched_at: string;
          currentness?: "current" | "historical_only" | "no_data";
          data: Record<string, unknown>;
          parser_version: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["carrier_profile_enrichments"]["Insert"]
        >;
      };
      client_attested_profiles: {
        Row: {
          id: string;
          client_id: string;
          power_units: number | null;
          drivers: number | null;
          annual_mileage: number | null;
          mileage_year: number | null;
          operation_classification: string | null;
          cargo_types: string[];
          physical_address: string | null;
          mailing_address: string | null;
          officials: unknown[];
          source: "census_default" | "operator_recorded";
          attested_at: string | null;
          attested_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          power_units?: number | null;
          drivers?: number | null;
          annual_mileage?: number | null;
          mileage_year?: number | null;
          operation_classification?: string | null;
          cargo_types?: string[];
          physical_address?: string | null;
          mailing_address?: string | null;
          officials?: unknown[];
          source?: "census_default" | "operator_recorded";
          attested_at?: string | null;
          attested_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["client_attested_profiles"]["Insert"]
        >;
      };
      client_requests: {
        Row: {
          id: string;
          client_id: string;
          dedupe_key: string;
          category: string;
          title: string;
          description: string | null;
          source: "standing" | "case";
          responsibility: "client" | "geia";
          case_type: "dataq" | "cpdp" | null;
          case_id: string | null;
          request_type: "evidence" | "question" | null;
          evidence_class:
            | "wrong-attribution"
            | "duplicate"
            | "citation-dismissed"
            | "report-factual-error"
            | null;
          evidence_status:
            | "open"
            | "submitted"
            | "applied"
            | "insufficient"
            | null;
          violation_id: string | null;
          why_copy: string | null;
          potential_points: number | null;
          response: Record<string, unknown> | null;
          submitted_at: string | null;
          applied_at: string | null;
          status_copy: string | null;
          requested_items: unknown[];
          status: "open" | "fulfilled" | "cancelled";
          due_at: string | null;
          reminder_count: number;
          reminder_limit: number;
          reminder_interval_days: number;
          last_reminded_at: string | null;
          next_reminder_at: string | null;
          escalated_at: string | null;
          closed_at: string | null;
          upload_token: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          dedupe_key: string;
          category: string;
          title: string;
          description?: string | null;
          source?: "standing" | "case";
          responsibility?: "client" | "geia";
          case_type?: "dataq" | "cpdp" | null;
          case_id?: string | null;
          request_type?: "evidence" | "question" | null;
          evidence_class?:
            | "wrong-attribution"
            | "duplicate"
            | "citation-dismissed"
            | "report-factual-error"
            | null;
          evidence_status?:
            | "open"
            | "submitted"
            | "applied"
            | "insufficient"
            | null;
          violation_id?: string | null;
          why_copy?: string | null;
          potential_points?: number | null;
          response?: Record<string, unknown> | null;
          submitted_at?: string | null;
          applied_at?: string | null;
          status_copy?: string | null;
          requested_items?: unknown[];
          status?: "open" | "fulfilled" | "cancelled";
          due_at?: string | null;
          reminder_count?: number;
          reminder_limit?: number;
          reminder_interval_days?: number;
          last_reminded_at?: string | null;
          next_reminder_at?: string | null;
          escalated_at?: string | null;
          closed_at?: string | null;
          upload_token?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["client_requests"]["Insert"]
        >;
      };
      score_snapshots: {
        Row: {
          id: string;
          client_id: string;
          snapshot_date: string;
          unsafe_driving_measure: number | null;
          unsafe_driving_pct: number | null;
          unsafe_driving_alert: boolean;
          hos_compliance_measure: number | null;
          hos_compliance_pct: number | null;
          hos_compliance_alert: boolean;
          driver_fitness_measure: number | null;
          driver_fitness_pct: number | null;
          driver_fitness_alert: boolean;
          controlled_substance_measure: number | null;
          controlled_substance_pct: number | null;
          controlled_substance_alert: boolean;
          vehicle_maint_measure: number | null;
          vehicle_maint_pct: number | null;
          vehicle_maint_alert: boolean;
          hm_compliance_measure: number | null;
          hm_compliance_pct: number | null;
          hm_compliance_alert: boolean;
          crash_indicator_measure: number | null;
          crash_indicator_pct: number | null;
          crash_indicator_alert: boolean;
          oos_vehicle_rate: number | null;
          oos_driver_rate: number | null;
          oos_hazmat_rate: number | null;
          source: string;
          official_basics: Record<string, unknown>;
          source_file_hash: string | null;
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
          mcmis_inspection_id: string | null;
          start_time: string | null;
          end_time: string | null;
          location_text: string | null;
          post_accident_indicator: string | null;
          time_weight: number | null;
          total_violations: number;
          oos_violations: number;
          raw_data: Record<string, unknown> | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["inspections"]["Row"],
          | "id"
          | "created_at"
          | "mcmis_inspection_id"
          | "start_time"
          | "end_time"
          | "location_text"
          | "post_accident_indicator"
        > &
          Partial<
            Pick<
              Database["public"]["Tables"]["inspections"]["Row"],
              | "mcmis_inspection_id"
              | "start_time"
              | "end_time"
              | "location_text"
              | "post_accident_indicator"
            >
          >;
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
          convicted: boolean | null;
          citation_number: string | null;
          citation_result: string | null;
          challenge_tier: "strong" | "moderate" | "investigate" | "not_challengeable" | "operational" | null;
          challengeable: boolean | null;
          challenge_reason: string | null;
          challenge_priority: ChallengePriority | null;
          ai_assessed_at: string | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["violations"]["Row"],
          "id" | "created_at" | "citation_result"
        > &
          Partial<Pick<Database["public"]["Tables"]["violations"]["Row"], "citation_result">>;
        Update: Partial<Database["public"]["Tables"]["violations"]["Insert"]>;
      };
      inspection_vehicles: {
        Row: {
          id: string;
          inspection_id: string;
          client_id: string | null;
          unit_number: number | null;
          unit_type: string | null;
          make: string | null;
          vin: string | null;
          license_plate: string | null;
          license_state: string | null;
          iep_dot: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["inspection_vehicles"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["inspection_vehicles"]["Insert"]>;
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
      mcs150_updates: {
        Row: {
          id: string;
          client_id: string;
          status: "draft" | "pending_review" | "submitted" | "confirmed";
          proposed_changes: Record<string, unknown>;
          notes: string | null;
          submitted_date: string | null;
          confirmed_date: string | null;
          created_by: string | null;
          client_request_id: string | null;
          trigger_key: string | null;
          trigger_reasons: unknown[] | null;
          census_snapshot: Record<string, unknown> | null;
          attested_snapshot: Record<string, unknown> | null;
          honesty_prediction: Record<string, unknown> | null;
          biennial_due_date: string | null;
          last_checked_at: string | null;
          confirmed_census_snapshot: Record<string, unknown> | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          status?: "draft" | "pending_review" | "submitted" | "confirmed";
          proposed_changes?: Record<string, unknown>;
          notes?: string | null;
          submitted_date?: string | null;
          confirmed_date?: string | null;
          created_by?: string | null;
          client_request_id?: string | null;
          trigger_key?: string | null;
          trigger_reasons?: unknown[] | null;
          census_snapshot?: Record<string, unknown> | null;
          attested_snapshot?: Record<string, unknown> | null;
          honesty_prediction?: Record<string, unknown> | null;
          biennial_due_date?: string | null;
          last_checked_at?: string | null;
          confirmed_census_snapshot?: Record<string, unknown> | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["mcs150_updates"]["Insert"]
        >;
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
          reviewed_at: string | null;
          reviewed_by: string | null;
          sent_at: string | null;
          sent_by: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["reports"]["Row"],
          "id" | "created_at" | "reviewed_at" | "reviewed_by"
        > & {
          reviewed_at?: string | null;
          reviewed_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["reports"]["Insert"]>;
      };
      client_playbooks: {
        Row: {
          id: string;
          client_id: string;
          version: number;
          template_version: string;
          trailing_window_days: number;
          source_as_of: string;
          owner_curriculum: unknown;
          family_programs: unknown;
          installment_calendar: unknown;
          ai_content: unknown;
          source_snapshot: unknown;
          generated_by: string;
          generated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["client_playbooks"]["Row"],
          "id" | "generated_at"
        > & {
          generated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["client_playbooks"]["Insert"]
        >;
      };
      alerts: {
        Row: {
          id: string;
          client_id: string;
          type: string;
          severity: AlertSeverity;
          title: string;
          message: string;
          entity_type: string | null;
          entity_id: string | null;
          read_at: string | null;
          dismissed_at: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["alerts"]["Row"], "id" | "created_at" | "entity_type" | "entity_id"> & {
          entity_type?: string | null;
          entity_id?: string | null;
        };
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
          client_request_id: string | null;
          violation_id: string | null;
          case_type: "dataq" | "cpdp" | null;
          case_id: string | null;
          evidence_class:
            | "wrong-attribution"
            | "duplicate"
            | "citation-dismissed"
            | "report-factual-error"
            | null;
          evidence_item_key: string | null;
          evidence_analysis: Record<string, unknown> | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["documents"]["Row"],
          | "id"
          | "created_at"
          | "client_request_id"
          | "violation_id"
          | "case_type"
          | "case_id"
          | "evidence_class"
          | "evidence_item_key"
          | "evidence_analysis"
        > &
          Partial<
            Pick<
              Database["public"]["Tables"]["documents"]["Row"],
              | "client_request_id"
              | "violation_id"
              | "case_type"
              | "case_id"
              | "evidence_class"
              | "evidence_item_key"
              | "evidence_analysis"
            >
          >;
        Update: Partial<Database["public"]["Tables"]["documents"]["Insert"]>;
      };
      dataq_evidence: {
        Row: {
          id: string;
          case_id: string;
          doc_type: string;
          label: string;
          context_note: string | null;
          fmcsa_category: string | null;
          required: boolean;
          status: "requested" | "received";
          storage_path: string | null;
          uploaded_at: string | null;
          uploaded_by: "client" | "geia" | null;
          acquisition_method: "auto" | "client" | "manual" | null;
          auto_source: string | null;
          needed_reason: string | null;
          client_request_id: string | null;
          document_id: string | null;
          evidence_item_key: string | null;
          storage_bucket: "documents" | "dataq-evidence" | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          case_id: string;
          doc_type: string;
          label: string;
          context_note?: string | null;
          fmcsa_category?: string | null;
          required?: boolean;
          status?: "requested" | "received";
          storage_path?: string | null;
          uploaded_at?: string | null;
          uploaded_by?: "client" | "geia" | null;
          acquisition_method?: "auto" | "client" | "manual" | null;
          auto_source?: string | null;
          needed_reason?: string | null;
          client_request_id?: string | null;
          document_id?: string | null;
          evidence_item_key?: string | null;
          storage_bucket?: "documents" | "dataq-evidence" | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["dataq_evidence"]["Insert"]>;
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
    Functions: {
      change_client_onboarding_tier_v1: {
        Args: {
          p_client_id: string;
          p_user_id: string;
          p_selected_tier: ClientTier;
        };
        Returns: Array<{
          result_tier: string;
          original_assigned_tier: string;
          previous_tier: string;
          changed: boolean;
        }>;
      };
      submit_assessment_activation_v1: {
        Args: {
          p_client_id: string;
          p_user_id: string;
        };
        Returns: Array<{
          result_status: string;
          result_tier: string;
          already_submitted: boolean;
        }>;
      };
      activate_assessment_client_v1: {
        Args: {
          p_client_id: string;
          p_user_id: string;
        };
        Returns: Array<{
          result_status: string;
          result_tier: string;
          already_active: boolean;
        }>;
      };
      activate_paid_subscription_v1: {
        Args: {
          p_client_id: string;
          p_tier: ClientTier;
          p_subscription_id: string;
          p_customer_id: string;
          p_mrr: number;
          p_source: string;
          p_user_id?: string | null;
        };
        Returns: Array<{
          result_status: string;
          result_tier: string;
          already_active: boolean;
        }>;
      };
      record_mcs150_submission_v1: {
        Args: {
          p_client_id: string;
          p_update_id: string;
          p_submitted_date: string;
          p_proposed_changes: Record<string, unknown>;
          p_trigger_key: string;
          p_trigger_reasons: unknown[];
          p_attested_snapshot: Record<string, unknown>;
          p_honesty_prediction: Record<string, unknown>;
          p_biennial_due_date: string;
          p_notes: string;
          p_request_description: string;
          p_user_id: string;
        };
        Returns: Array<{
          update_id: string;
          status: string;
          submitted_date: string;
          client_request_id: string;
        }>;
      };
      confirm_mcs150_update_v1: {
        Args: {
          p_client_id: string;
          p_update_id: string;
          p_confirmed_date: string;
          p_confirmed_census_snapshot: Record<string, unknown>;
          p_checked_at: string;
        };
        Returns: Array<{
          update_id: string;
          status: string;
          client_request_id: string;
        }>;
      };
    };
    Enums: Record<string, never>;
  };
}

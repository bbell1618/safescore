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
export type DriverStatus = "active" | "inactive" | "terminated";
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
export type DocumentExpiryStatus =
  | "current"
  | "expiring_soon"
  | "expired"
  | "missing";
export type DocumentReviewStatus =
  | "pending_review"
  | "reviewed"
  | "action_needed";
export type VehicleStatus = "active" | "inactive";
export type VehicleMaintenanceType =
  | "pm_service"
  | "repair"
  | "annual_inspection";
export type ClearinghouseResultType = "negative" | "positive";
export type ClearinghouseRegistrationStatus =
  | "unknown"
  | "registered"
  | "not_registered";
export type ComplianceExpirationItemType =
  | "medical_certificate"
  | "cdl"
  | "annual_vehicle_inspection"
  | "annual_mvr_review"
  | "clearinghouse_annual_query";
export type ComplianceExpirationSubjectType =
  | "driver"
  | "driver_document"
  | "vehicle";
export type ComplianceExpirationThreshold =
  | "60_day"
  | "30_day"
  | "7_day"
  | "expired";
export type ComplianceWorkStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "failed";

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
      client_activation_initializations: {
        Row: {
          client_id: string;
          activation_tier: ClientTier;
          activation_source: string;
          status: "pending" | "running" | "succeeded" | "failed";
          claim_token: string;
          attempt_count: number;
          claimed_at: string;
          completed_at: string | null;
          error: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["client_activation_initializations"]["Row"],
          | "claim_token"
          | "attempt_count"
          | "status"
          | "claimed_at"
          | "completed_at"
          | "error"
          | "metadata"
          | "created_at"
          | "updated_at"
        > &
          Partial<
            Pick<
              Database["public"]["Tables"]["client_activation_initializations"]["Row"],
              | "claim_token"
              | "attempt_count"
              | "status"
              | "claimed_at"
              | "completed_at"
              | "error"
              | "metadata"
              | "created_at"
              | "updated_at"
            >
          >;
        Update: Partial<
          Database["public"]["Tables"]["client_activation_initializations"]["Insert"]
        >;
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
          request_type: "evidence" | "question" | "roster_collection" | null;
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
          request_type?:
            | "evidence"
            | "question"
            | "roster_collection"
            | null;
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
          report_sequence_number: string | null;
          crash_date: string;
          state: string | null;
          city: string | null;
          location: string | null;
          fatalities: number;
          injuries: number;
          tow_away: boolean;
          hazmat_release: boolean;
          trafficway: string | null;
          access_control_desc: string | null;
          road_surface_condition: string | null;
          weather_condition: string | null;
          light_condition: string | null;
          vehicle_configuration: string | null;
          severity_weight: number | null;
          time_weight: number | null;
          citation_issued: boolean | null;
          fmcsa_not_preventable: boolean | null;
          vehicle_identification_number: string | null;
          vehicle_license_number: string | null;
          vehicle_license_state: string | null;
          federal_recordable: boolean | null;
          state_recordable: boolean | null;
          preventable: boolean | null;
          cpdp_eligible: boolean | null;
          cpdp_eligible_types: string[] | null;
          ai_assessed_at: string | null;
          par_document_id: string | null;
          par_document_source: "manual" | "lexisnexis" | null;
          par_received_at: string | null;
          par_local_report_number: string | null;
          par_content_sha256: string | null;
          raw_data: Record<string, unknown> | null;
          fmcsa_crash_sources_fetched_at: string | null;
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
          determination_outcome: string | null;
          determination_recorded_at: string | null;
          ai_narrative: string | null;
          final_narrative: string | null;
          filing_notes: string | null;
          created_by: string | null;
          updated_at: string;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["dataq_cases"]["Row"],
          | "id"
          | "updated_at"
          | "created_at"
          | "determination_outcome"
          | "determination_recorded_at"
        > & {
          determination_outcome?: string | null;
          determination_recorded_at?: string | null;
        };
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
          determination_outcome: string | null;
          determination_recorded_at: string | null;
          ai_narrative: string | null;
          final_narrative: string | null;
          filing_notes: string | null;
          created_by: string | null;
          cpdp_eligible_types: string[] | null;
          case_number: string | null;
          filed_without_evidence: boolean;
          override_reason: string | null;
          narrative_evidence_verified: boolean;
          narrative_verified_at: string | null;
          narrative_verified_by: string | null;
          ai_assessed_at: string | null;
          ai_eligibility_verdict:
            | "ELIGIBLE"
            | "INDETERMINATE"
            | "NOT_ELIGIBLE"
            | null;
          ai_eligibility_rationale: string | null;
          ai_suggested_types: string[] | null;
          par_identity_confirmed: boolean;
          par_confirmed_at: string | null;
          par_confirmed_by: string | null;
          par_ai_assessment: Record<string, unknown> | null;
          par_review_assessment: Record<string, unknown> | null;
          par_assessment_status:
            | "awaiting_par"
            | "assessing"
            | "ready_for_review"
            | "approved"
            | "failed";
          par_assessment_model: string | null;
          par_assessment_error: string | null;
          par_assessment_attempted_at: string | null;
          par_assessment_document_id: string | null;
          par_reviewed_at: string | null;
          par_reviewed_by: string | null;
          par_assessment_overrides: Record<string, unknown> | null;
          updated_at: string;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["cpdp_cases"]["Row"],
          | "id"
          | "updated_at"
          | "created_at"
          | "determination_outcome"
          | "determination_recorded_at"
        > & {
          determination_outcome?: string | null;
          determination_recorded_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["cpdp_cases"]["Insert"]>;
      };
      cpdp_evidence: {
        Row: {
          id: string;
          case_id: string;
          doc_type: string;
          label: string;
          context_note: string | null;
          fmcsa_category: string | null;
          required: boolean;
          status: string;
          storage_path: string | null;
          uploaded_at: string | null;
          uploaded_by: string | null;
          document_id: string | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["cpdp_evidence"]["Row"],
          "id" | "created_at"
        >;
        Update: Partial<
          Database["public"]["Tables"]["cpdp_evidence"]["Insert"]
        >;
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
          acknowledged_at: string | null;
          acknowledged_by: string | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["alerts"]["Row"],
          | "id"
          | "created_at"
          | "entity_type"
          | "entity_id"
          | "acknowledged_at"
          | "acknowledged_by"
        > & {
          entity_type?: string | null;
          entity_id?: string | null;
          acknowledged_at?: string | null;
          acknowledged_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["alerts"]["Insert"]>;
      };
      operator_item_acks: {
        Row: {
          id: string;
          client_id: string;
          rule_key: string;
          context_key: string;
          action: "done" | "snooze";
          snoozed_until: string | null;
          note: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          rule_key: string;
          context_key: string;
          action: "done" | "snooze";
          snoozed_until?: string | null;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["operator_item_acks"]["Insert"]
        >;
      };
      operator_manual_items: {
        Row: {
          id: string;
          client_id: string;
          title: string;
          details: string | null;
          due_date: string | null;
          status: "open" | "done";
          created_by: string | null;
          created_at: string;
          completed_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          client_id: string;
          title: string;
          details?: string | null;
          due_date?: string | null;
          status?: "open" | "done";
          created_by?: string | null;
          created_at?: string;
          completed_at?: string | null;
          deleted_at?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["operator_manual_items"]["Insert"]
        >;
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
          status: DocumentReviewStatus;
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
           | "status"
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
              | "status"
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
          cdl_class: string | null;
          cdl_expiry: string | null;
          medical_cert_expiry: string | null;
          hired_date: string | null;
          status: DriverStatus;
          source: "operator" | "client_portal";
          approved_at: string | null;
          approved_by: string | null;
          request_id: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          full_name: string;
          cdl_number?: string | null;
          cdl_state?: string | null;
          cdl_class?: string | null;
          cdl_expiry?: string | null;
          medical_cert_expiry?: string | null;
          hired_date?: string | null;
          status?: DriverStatus;
          source?: "operator" | "client_portal";
          approved_at?: string | null;
          approved_by?: string | null;
          request_id?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["drivers"]["Insert"]>;
      };
      driver_documents: {
        Row: {
          id: string;
          driver_id: string;
          client_id: string;
          document_id: string | null;
          doc_type: DriverDocumentType;
          completed_date: string | null;
          expiry_date: string | null;
          status: DocumentExpiryStatus;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          driver_id: string;
          client_id: string;
          document_id?: string | null;
          doc_type: DriverDocumentType;
          completed_date?: string | null;
          expiry_date?: string | null;
          status?: DocumentExpiryStatus;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["driver_documents"]["Insert"]>;
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
          annual_inspection_date: string | null;
          status: VehicleStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          unit_number?: string | null;
          vin?: string | null;
          year?: number | null;
          make?: string | null;
          model?: string | null;
          license_plate?: string | null;
          plate_state?: string | null;
          annual_inspection_date?: string | null;
          status?: VehicleStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["vehicles"]["Insert"]>;
      };
      vehicle_maintenance: {
        Row: {
          id: string;
          vehicle_id: string;
          client_id: string;
          maintenance_type: VehicleMaintenanceType;
          scheduled_date: string | null;
          completed_date: string | null;
          notes: string | null;
          document_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          vehicle_id: string;
          client_id: string;
          maintenance_type: VehicleMaintenanceType;
          scheduled_date?: string | null;
          completed_date?: string | null;
          notes?: string | null;
          document_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["vehicle_maintenance"]["Insert"]>;
      };
      clearinghouse_records: {
        Row: {
          id: string;
          client_id: string;
          driver_id: string | null;
          query_date: string;
          result_type: ClearinghouseResultType;
          document_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          driver_id?: string | null;
          query_date: string;
          result_type: ClearinghouseResultType;
          document_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["clearinghouse_records"]["Insert"]>;
      };
      client_compliance_profiles: {
        Row: {
          id: string;
          client_id: string;
          clearinghouse_registration_status: ClearinghouseRegistrationStatus;
          clearinghouse_registration_checked_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          clearinghouse_registration_status?: ClearinghouseRegistrationStatus;
          clearinghouse_registration_checked_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["client_compliance_profiles"]["Insert"]>;
      };
      compliance_expiration_digests: {
        Row: {
          id: string;
          client_id: string;
          digest_date: string;
          status: ComplianceWorkStatus;
          attempts: number;
          claimed_at: string | null;
          processed_at: string | null;
          last_error: string | null;
          event_count: number;
          delivery_metadata: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          digest_date: string;
          status?: ComplianceWorkStatus;
          attempts?: number;
          claimed_at?: string | null;
          processed_at?: string | null;
          last_error?: string | null;
          event_count?: number;
          delivery_metadata?: Record<string, unknown>;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["compliance_expiration_digests"]["Insert"]>;
      };
      compliance_expiration_events: {
        Row: {
          id: string;
          client_id: string;
          item_type: ComplianceExpirationItemType;
          subject_type: ComplianceExpirationSubjectType;
          subject_id: string;
          due_date: string;
          threshold: ComplianceExpirationThreshold;
          status: ComplianceWorkStatus;
          attempts: number;
          claimed_at: string | null;
          processed_at: string | null;
          last_error: string | null;
          digest_id: string | null;
          alert_id: string | null;
          client_request_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          item_type: ComplianceExpirationItemType;
          subject_type: ComplianceExpirationSubjectType;
          subject_id: string;
          due_date: string;
          threshold: ComplianceExpirationThreshold;
          status?: ComplianceWorkStatus;
          attempts?: number;
          claimed_at?: string | null;
          processed_at?: string | null;
          last_error?: string | null;
          digest_id?: string | null;
          alert_id?: string | null;
          client_request_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["compliance_expiration_events"]["Insert"]>;
      };
    };
    Views: Record<string, never>;
    Functions: {
      approve_cpdp_par_assessment_v1: {
        Args: {
          p_case_id: string;
          p_reviewer_id: string;
          p_review_assessment: Record<string, unknown>;
          p_eligible_types: string[];
          p_final_narrative: string | null;
          p_overrides?: Record<string, unknown>[];
        };
        Returns: Array<{
          case_id: string;
          crash_id: string;
          client_id: string;
          approved_at: string;
        }>;
      };
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
      activate_staff_confirmed_subscription_v1: {
        Args: {
          p_client_id: string;
          p_user_id: string;
        };
        Returns: Array<{
          result_status: string;
          result_tier: string;
          already_active: boolean;
          result_mrr: number;
        }>;
      };
      claim_client_activation_initialization_v1: {
        Args: {
          p_client_id: string;
          p_tier: ClientTier;
          p_source: string;
          p_create_if_missing?: boolean;
        };
        Returns: Array<{
          claimed: boolean;
          result_status:
            | "not_enqueued"
            | "pending"
            | "running"
            | "succeeded"
            | "failed";
          result_claim_token: string | null;
          result_attempt_count: number;
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

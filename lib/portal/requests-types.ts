import type { LaneBEvidenceClass } from "@/lib/evidence-loop/taxonomy";
type ClientRequestType = "evidence" | "question" | "roster_collection";

export type ClientRequestRow = {
  id: string;
  category: string;
  title: string;
  description: string | null;
  requested_items: unknown;
  request_type: ClientRequestType | null;
  evidence_class: LaneBEvidenceClass | null;
  why_copy: string | null;
  potential_points: number | null;
  status: string;
  evidence_status: string | null;
  status_copy: string | null;
  due_at: string | null;
  upload_token: string;
  submitted_at: string | null;
  created_at: string;
};


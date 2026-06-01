import { createClient } from "@supabase/supabase-js";
import { EvidenceUploadClient } from "./upload-client";

export const dynamic = "force-dynamic";

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface EvidenceItem {
  id: string;
  label: string;
  context_note: string | null;
  fmcsa_category: string | null;
  status: "requested" | "received";
  storage_path: string | null;
}

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function EvidenceUploadPage({ params }: PageProps) {
  const { token } = await params;
  const supabase = getAdmin();

  // Validate token
  const { data: req, error: reqErr } = await supabase
    .from("dataq_evidence_request")
    .select("id, case_id, expires_at")
    .eq("token", token)
    .single();

  if (reqErr || !req) {
    return <InvalidLink message="This link is invalid or has expired." />;
  }

  if (new Date(req.expires_at) < new Date()) {
    return (
      <InvalidLink message="This link has expired. Contact your GEIA representative for a new upload link." />
    );
  }

  // Fetch required evidence items
  const { data: evidence, error: evErr } = await supabase
    .from("dataq_evidence")
    .select("id, label, context_note, fmcsa_category, status, storage_path")
    .eq("case_id", req.case_id)
    .eq("required", true)
    .order("created_at", { ascending: true });

  if (evErr) {
    return <InvalidLink message="Unable to load evidence items. Please try again." />;
  }

  return (
    <EvidenceUploadClient
      token={token}
      caseId={req.case_id}
      evidence={(evidence ?? []) as EvidenceItem[]}
    />
  );
}

function InvalidLink({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-[#FBF7F0] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl border border-[#F0E8DA] p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-[#FAECEB] flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-6 h-6 text-[#B83B32]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h1 className="text-base font-semibold text-[#1E1C1A] mb-2">
          Link invalid or expired
        </h1>
        <p className="text-sm text-[#5C554E]">{message}</p>
        <p className="text-xs text-[#8B8178] mt-3">
          Contact your GEIA representative to request a new upload link.
        </p>
      </div>
    </div>
  );
}

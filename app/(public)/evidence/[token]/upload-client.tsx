"use client";

import { useState } from "react";
import { CheckCircle, Upload, AlertCircle } from "lucide-react";

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/tiff",
  "text/plain",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/gif",
  "image/png",
]);

const ALLOWED_EXTS = new Set([
  "pdf", "doc", "docx", "tif", "tiff", "txt", "xls", "xlsx",
  "jpg", "jpeg", "gif", "png",
]);

const ALLOWED_ACCEPT = ".pdf,.doc,.docx,.tif,.tiff,.txt,.xls,.xlsx,.jpg,.jpeg,.gif,.png";
const MAX_BYTES = 25 * 1024 * 1024;

interface EvidenceItem {
  id: string;
  label: string;
  context_note: string | null;
  fmcsa_category: string | null;
  status: "requested" | "received";
  storage_path: string | null;
}

type SlotState = "idle" | "uploading" | "done" | "error";

interface Props {
  token: string;
  caseId: string;
  evidence: EvidenceItem[];
}

export function EvidenceUploadClient({ token, evidence }: Props) {
  const [slotStates, setSlotStates] = useState<Record<string, SlotState>>(() => {
    const init: Record<string, SlotState> = {};
    for (const item of evidence) {
      init[item.id] = item.status === "received" ? "done" : "idle";
    }
    return init;
  });
  const [slotErrors, setSlotErrors] = useState<Record<string, string>>({});

  async function handleFileSelect(evidenceId: string, file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (file.type && !ALLOWED_TYPES.has(file.type) && !ALLOWED_EXTS.has(ext)) {
      setSlotErrors((prev) => ({ ...prev, [evidenceId]: "File type not allowed." }));
      return;
    }
    if (file.size > MAX_BYTES) {
      setSlotErrors((prev) => ({ ...prev, [evidenceId]: "File exceeds the 25 MB limit." }));
      return;
    }

    setSlotErrors((prev) => ({ ...prev, [evidenceId]: "" }));
    setSlotStates((prev) => ({ ...prev, [evidenceId]: "uploading" }));

    try {
      const form = new FormData();
      form.append("token", token);
      form.append("evidence_id", evidenceId);
      form.append("file", file);

      const res = await fetch(`/api/evidence/${token}/upload`, {
        method: "POST",
        body: form,
      });
      const json = await res.json();

      if (!res.ok || json.error) {
        setSlotStates((prev) => ({ ...prev, [evidenceId]: "error" }));
        setSlotErrors((prev) => ({
          ...prev,
          [evidenceId]: json.error ?? "Upload failed. Please try again.",
        }));
      } else {
        setSlotStates((prev) => ({ ...prev, [evidenceId]: "done" }));
      }
    } catch {
      setSlotStates((prev) => ({ ...prev, [evidenceId]: "error" }));
      setSlotErrors((prev) => ({
        ...prev,
        [evidenceId]: "Upload failed. Please check your connection and try again.",
      }));
    }
  }

  const allDone =
    evidence.length > 0 && evidence.every((item) => slotStates[item.id] === "done");

  return (
    <div className="min-h-screen bg-[#FBF7F0] py-12 px-4">
      <div className="max-w-xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-[#1B2D4F] flex items-center justify-center shrink-0">
              <span className="text-white text-xs font-bold leading-none">SS</span>
            </div>
            <span className="text-sm font-semibold text-[#1B2D4F] tracking-tight">
              SafeScore
            </span>
          </div>
          <h1 className="text-xl font-bold text-[#1E1C1A]">Evidence Upload</h1>
          <p className="text-sm text-[#5C554E] mt-1 leading-relaxed">
            Please upload the documents listed below so GEIA can process your DataQ
            challenge. All files are transmitted securely.
          </p>
        </div>

        {/* All done banner */}
        {allDone && (
          <div className="mb-6 bg-[#E8F3EC] border border-[#3D7A52]/20 rounded-xl px-5 py-4 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-[#3D7A52] shrink-0" />
            <p className="text-sm font-medium text-[#3D7A52]">
              All required documents submitted. You can close this window.
            </p>
          </div>
        )}

        {/* Evidence slots */}
        <div className="space-y-3">
          {evidence.map((item) => (
            <EvidenceSlot
              key={item.id}
              item={item}
              state={slotStates[item.id] ?? "idle"}
              slotError={slotErrors[item.id] ?? ""}
              onFileSelect={(file) => handleFileSelect(item.id, file)}
            />
          ))}

          {evidence.length === 0 && (
            <div className="bg-white rounded-xl border border-[#F0E8DA] px-5 py-10 text-center">
              <p className="text-sm text-[#8B8178]">No documents have been requested yet.</p>
              <p className="text-xs text-[#8B8178] mt-1">
                GEIA will update this page when documents are ready for upload.
              </p>
            </div>
          )}
        </div>

        <p className="text-xs text-[#8B8178] text-center mt-8 leading-relaxed">
          Accepted formats: PDF, Word, Excel, TIFF, JPEG, PNG, GIF, TXT &mdash; max 25 MB
          per file.
          <br />
          Golden Era Insurance Agency &bull; 510-270-8141
        </p>
      </div>
    </div>
  );
}

function EvidenceSlot({
  item,
  state,
  slotError,
  onFileSelect,
}: {
  item: EvidenceItem;
  state: SlotState;
  slotError: string;
  onFileSelect: (file: File) => void;
}) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFileSelect(file);
    e.target.value = "";
  }

  return (
    <div className="bg-white rounded-xl border border-[#F0E8DA] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1B2D4F] leading-snug">{item.label}</p>
          {item.fmcsa_category && (
            <p className="text-xs text-[#8B8178] mt-0.5 uppercase tracking-wide">
              {item.fmcsa_category}
            </p>
          )}
          {item.context_note && (
            <p className="text-xs text-[#5C554E] mt-1.5 leading-relaxed">
              {item.context_note}
            </p>
          )}
        </div>

        <div className="shrink-0 flex flex-col items-end gap-2 ml-2">
          {state === "uploading" && (
            <span className="text-xs text-[#8B8178] animate-pulse">Uploading...</span>
          )}

          {state === "done" && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-[#3D7A52]">
              <CheckCircle className="w-4 h-4" />
              Uploaded
            </span>
          )}

          {(state === "idle" || state === "error") && (
            <label className="cursor-pointer">
              <input
                type="file"
                accept={ALLOWED_ACCEPT}
                className="sr-only"
                onChange={handleChange}
              />
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1B2D4F] text-white text-xs font-medium hover:bg-[#2A4270] transition-colors select-none">
                <Upload className="w-3.5 h-3.5" />
                {state === "error" ? "Retry" : "Upload"}
              </span>
            </label>
          )}

          {state === "done" && (
            <label className="cursor-pointer">
              <input
                type="file"
                accept={ALLOWED_ACCEPT}
                className="sr-only"
                onChange={handleChange}
              />
              <span className="inline-flex items-center px-2.5 py-1 rounded-lg border border-[#F0E8DA] text-[#8B8178] text-xs hover:bg-[#FBF7F0] transition-colors select-none cursor-pointer">
                Replace
              </span>
            </label>
          )}
        </div>
      </div>

      {slotError && (
        <div className="mt-3 flex items-start gap-1.5 text-xs text-[#B83B32]">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{slotError}</span>
        </div>
      )}
    </div>
  );
}

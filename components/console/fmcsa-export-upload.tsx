"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";

interface FmcsaExportUploadProps {
  clientId: string;
  dotNumber: string;
}

type IngestResponse = {
  status?: "inserted" | "skipped";
  ingest_kind?: "inspection_detail" | "all_basics";
  parsed?: number;
  inserted?: number;
  skipped?: number;
  flagged?: number;
  error?: string;
};

export function FmcsaExportUpload({ clientId, dotNumber }: FmcsaExportUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<IngestResponse | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setResult(null);
    try {
      const form = new FormData();
      form.set("clientId", clientId);
      form.set("dotNumber", dotNumber);
      form.set("file", file);

      const response = await fetch("/api/analysis/ingest-detail", {
        method: "POST",
        body: form,
      });
      const body = (await response.json()) as IngestResponse;
      if (!response.ok) {
        setResult({ error: body.error ?? `Upload failed with HTTP ${response.status}` });
        return;
      }
      setResult(body);
      router.refresh();
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Upload failed" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-1.5">
      <input
        id="fmcsa-export-file"
        name="fmcsa_export_file"
        aria-label="FMCSA export file"
        ref={inputRef}
        type="file"
        accept=".xml,.csv,text/xml,application/xml,text/csv"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#D9CDBB] bg-white px-3 py-2 text-xs font-medium text-[#1E1C1A] hover:bg-[#FBF7F0] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Upload className="h-3.5 w-3.5" aria-hidden="true" />
        {uploading ? "Uploading FMCSA export..." : "Upload FMCSA export"}
      </button>
      <p className="max-w-56 text-[10px] leading-4 text-gray-500">
        COMPASS inspection-detail XML or SMS All BASICs CSV.
      </p>
      {result?.error ? (
        <p role="alert" className="max-w-64 text-[10px] leading-4 text-[#B83B32]">
          {result.error}
        </p>
      ) : result ? (
        <p role="status" className="max-w-64 text-[10px] leading-4 text-[#3D7A52]">
          {result.status === "skipped" ? "Already ingested" : "Ingested"}: {result.parsed ?? 0} parsed, {result.inserted ?? 0} inserted, {result.skipped ?? 0} skipped, {result.flagged ?? 0} flagged.
        </p>
      ) : null}
    </div>
  );
}

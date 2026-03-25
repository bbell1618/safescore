"use client";

import { useState, useEffect, useRef } from "react";
import {
  Upload,
  File,
  AlertCircle,
  CheckCircle,
  Clock,
  Folder,
} from "lucide-react";

const CATEGORIES = [
  { value: "dqf", label: "Driver qualification files" },
  { value: "maintenance", label: "Vehicle maintenance records" },
  { value: "other", label: "ELD/HOS data" },
  { value: "clearinghouse", label: "Drug & Alcohol Clearinghouse" },
  { value: "auth_agreement", label: "Insurance documents" },
  { value: "evidence", label: "Other" },
] as const;

type DocumentCategory = (typeof CATEGORIES)[number]["value"];

interface DocumentRow {
  id: string;
  filename: string;
  category: DocumentCategory;
  file_size: number | null;
  created_at: string;
  status?: "pending_review" | "reviewed" | "action_needed";
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const statusConfig = {
  pending_review: { label: "Pending review", icon: Clock, color: "text-[#C5A059]" },
  reviewed: { label: "Reviewed", icon: CheckCircle, color: "text-green-600" },
  action_needed: { label: "Action needed", icon: AlertCircle, color: "text-[#DC362E]" },
};

export default function DocumentVaultPage() {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<DocumentCategory>("dqf");
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchDocuments();
  }, []);

  async function fetchDocuments() {
    try {
      const res = await fetch("/api/portal/documents");
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents ?? []);
      }
    } catch {
      // fail gracefully
    } finally {
      setLoading(false);
    }
  }

  async function uploadFile(file: File) {
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", uploadCategory);

    try {
      const res = await fetch("/api/portal/documents", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error ?? "Upload failed. Please try again.");
      } else {
        setUploadSuccess(`${file.name} uploaded successfully.`);
        fetchDocuments();
      }
    } catch {
      setUploadError("Network error. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }

  // Group documents by category
  const byCategory: Partial<Record<DocumentCategory, DocumentRow[]>> = {};
  for (const doc of documents) {
    if (!byCategory[doc.category]) byCategory[doc.category] = [];
    byCategory[doc.category]!.push(doc);
  }

  // Missing categories checklist (categories with zero uploads)
  const missingCategories = CATEGORIES.filter((c) => !byCategory[c.value]?.length);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[#1A1A1A]">Document vault</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Upload and manage your compliance documents. All files are stored securely.
        </p>
      </div>

      {/* Upload area */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-5">
        <h2 className="font-semibold text-[#1A1A1A] text-sm mb-4">Upload a document</h2>

        <div className="flex gap-3 mb-4">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
            <select
              value={uploadCategory}
              onChange={(e) => setUploadCategory(e.target.value as DocumentCategory)}
              className="w-full px-3 py-2 border border-[#E5E5E5] rounded-lg text-sm text-[#1A1A1A] bg-white focus:outline-none focus:ring-2 focus:ring-[#DC362E] focus:border-transparent"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
            dragOver
              ? "border-[#DC362E] bg-[#F9E0DF]"
              : "border-[#E5E5E5] hover:border-gray-300 hover:bg-[#F4F4F4]"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-8 h-8 text-gray-400 mx-auto mb-3" />
          <p className="text-sm font-medium text-[#1A1A1A] mb-1">
            {uploading ? "Uploading..." : "Drop a file here or click to browse"}
          </p>
          <p className="text-xs text-gray-400">
            PDF, DOC, DOCX, PNG, JPG — max 25 MB
          </p>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileInput}
            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.csv,.xlsx"
          />
        </div>

        {uploadError && (
          <div className="mt-3 rounded-lg bg-[#F9E0DF] border border-[#DC362E]/20 px-4 py-2.5 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[#DC362E] shrink-0" />
            <p className="text-sm text-[#DC362E]">{uploadError}</p>
          </div>
        )}
        {uploadSuccess && (
          <div className="mt-3 rounded-lg bg-green-50 border border-green-200 px-4 py-2.5 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
            <p className="text-sm text-green-700">{uploadSuccess}</p>
          </div>
        )}
      </div>

      {/* Missing documents checklist */}
      {missingCategories.length > 0 && (
        <div className="bg-[#F5EDDB] rounded-xl border border-[#D9C48F] p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4 text-[#8E7340]" />
            <h2 className="font-semibold text-[#8E7340] text-sm">Missing documents</h2>
          </div>
          <p className="text-xs text-[#8E7340] mb-3">
            The following document categories have no uploads yet. Upload them to keep your file complete.
          </p>
          <ul className="space-y-1.5">
            {missingCategories.map((c) => (
              <li key={c.value} className="flex items-center gap-2 text-xs text-[#8E7340]">
                <div className="w-1.5 h-1.5 rounded-full bg-[#C5A059] shrink-0" />
                {c.label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Document list by category */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-[#E5E5E5] p-4 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-1/4 mb-3" />
              <div className="h-3 bg-gray-100 rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : documents.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#E5E5E5] px-5 py-12 text-center">
          <Folder className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No documents uploaded yet</p>
          <p className="text-xs text-gray-400 mt-1">
            Use the upload area above to add your first document.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {CATEGORIES.map((cat) => {
            const docs = byCategory[cat.value];
            if (!docs?.length) return null;
            return (
              <div key={cat.value} className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#E5E5E5] flex items-center gap-2">
                  <Folder className="w-4 h-4 text-[#C5A059]" />
                  <h3 className="font-semibold text-[#1A1A1A] text-sm">{cat.label}</h3>
                  <span className="text-xs text-gray-400 ml-auto">{docs.length} file{docs.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="divide-y divide-[#E5E5E5]">
                  {docs.map((doc) => {
                    const statusInfo = doc.status ? statusConfig[doc.status] : statusConfig.pending_review;
                    const StatusIcon = statusInfo.icon;
                    return (
                      <div key={doc.id} className="px-5 py-3 flex items-center gap-3">
                        <File className="w-4 h-4 text-gray-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#1A1A1A] truncate">{doc.filename}</p>
                          <p className="text-xs text-gray-400">
                            {formatDate(doc.created_at)} · {formatBytes(doc.file_size)}
                          </p>
                        </div>
                        <div className={`flex items-center gap-1.5 text-xs font-medium ${statusInfo.color}`}>
                          <StatusIcon className="w-3.5 h-3.5" />
                          {statusInfo.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

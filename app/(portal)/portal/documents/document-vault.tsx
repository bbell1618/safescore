"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  File,
  Folder,
  Upload,
} from "lucide-react";

const CATEGORIES = [
  { value: "dqf", label: "Driver qualification files" },
  { value: "maintenance", label: "Vehicle maintenance records" },
  { value: "clearinghouse", label: "Drug & Alcohol Clearinghouse" },
  { value: "auth_agreement", label: "Insurance documents" },
  { value: "evidence", label: "Evidence and supporting records" },
  { value: "report", label: "Archived report files" },
  { value: "other", label: "Other" },
] as const;

type VaultCategory = (typeof CATEGORIES)[number]["value"];
type DocumentReviewStatus =
  | "pending_review"
  | "reviewed"
  | "action_needed";

export type PortalDocumentRow = {
  id: string;
  filename: string;
  category: VaultCategory;
  file_size: number | null;
  created_at: string;
  status: DocumentReviewStatus;
};

const STATUS_CONFIG = {
  pending_review: {
    label: "Pending review",
    icon: Clock,
    color: "text-info",
  },
  reviewed: {
    label: "Reviewed",
    icon: CheckCircle,
    color: "text-success",
  },
  action_needed: {
    label: "Action needed",
    icon: AlertCircle,
    color: "text-error",
  },
} as const;

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "Size not recorded";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

async function responseBody(response: Response) {
  try {
    return (await response.json()) as { error?: string };
  } catch {
    return {};
  }
}

export default function DocumentVault({
  initialDocuments,
}: {
  initialDocuments: PortalDocumentRow[];
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [uploadCategory, setUploadCategory] =
    useState<VaultCategory>("dqf");
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File) {
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", uploadCategory);

    try {
      const response = await fetch("/api/portal/documents", {
        method: "POST",
        body: formData,
      });
      const body = await responseBody(response);
      if (!response.ok) {
        throw new Error(
          body.error ?? `Upload failed with status ${response.status}`
        );
      }

      setUploadSuccess(`${file.name} was uploaded. GEIA will review it.`);
      router.refresh();
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : "The upload failed for an unknown reason."
      );
    } finally {
      setUploading(false);
    }
  }

  function handleFileInput(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void uploadFile(file);
    event.target.value = "";
  }

  function handleDrop(event: React.DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void uploadFile(file);
  }

  const byCategory: Partial<Record<VaultCategory, PortalDocumentRow[]>> = {};
  for (const document of initialDocuments) {
    if (!byCategory[document.category]) {
      byCategory[document.category] = [];
    }
    byCategory[document.category]?.push(document);
  }
  const missingCategories = CATEGORIES.filter(
    (category) =>
      category.value !== "report" && !byCategory[category.value]?.length
  );

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-sand bg-cream p-4 sm:p-5">
        <h3 className="font-heading text-base font-semibold text-warm-dark">
          Upload a document
        </h3>

        <label
          htmlFor="vault-category"
          className="mt-4 block text-xs font-semibold text-warm-mid"
        >
          Category
        </label>
        <select
          id="vault-category"
          value={uploadCategory}
          onChange={(event) =>
            setUploadCategory(event.target.value as VaultCategory)
          }
          className="mt-1 w-full rounded-lg border border-sand bg-warm-white px-3 py-2 text-sm text-warm-dark focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold"
        >
          {CATEGORIES.filter(
            (category) => category.value !== "report"
          ).map((category) => (
            <option key={category.value} value={category.value}>
              {category.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={uploading}
          className={`mt-4 w-full cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70 ${
            dragOver
              ? "border-amber bg-amber-subtle"
              : "border-sand bg-warm-white hover:border-gold hover:bg-amber-subtle"
          }`}
          onDragEnter={() => setDragOver(true)}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload
            className="mx-auto h-8 w-8 text-amber"
            aria-hidden="true"
          />
          <span className="mt-3 block text-sm font-semibold text-warm-dark">
            {uploading
              ? "Uploading your document…"
              : "Drop a file here or choose a file"}
          </span>
          <span className="mt-1 block text-xs text-warm-mid">
            PDF, Word, Excel, CSV, PNG, or JPG — up to 25 MB
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="sr-only"
          onChange={handleFileInput}
          disabled={uploading}
          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.csv,.xls,.xlsx"
        />

        {uploadError ? (
          <div
            className="mt-3 flex items-start gap-2 rounded-lg border border-error bg-error-light px-4 py-3"
            role="alert"
          >
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0 text-error"
              aria-hidden="true"
            />
            <p className="text-sm text-error">{uploadError}</p>
          </div>
        ) : null}
        {uploadSuccess ? (
          <div
            className="mt-3 flex items-start gap-2 rounded-lg border border-success bg-success-light px-4 py-3"
            role="status"
          >
            <CheckCircle
              className="mt-0.5 h-4 w-4 shrink-0 text-success"
              aria-hidden="true"
            />
            <p className="text-sm text-success">{uploadSuccess}</p>
          </div>
        ) : null}
      </div>

      {missingCategories.length > 0 ? (
        <div className="rounded-lg border border-gold bg-amber-subtle p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <AlertCircle
              className="h-4 w-4 text-amber-dark"
              aria-hidden="true"
            />
            <h3 className="text-sm font-semibold text-amber-dark">
              Records not uploaded yet
            </h3>
          </div>
          <p className="mt-2 text-xs leading-5 text-warm-mid">
            These categories do not have a file yet. Add what applies to your
            company; you do not need to upload records that do not apply.
          </p>
          <ul className="mt-3 space-y-1.5">
            {missingCategories.map((category) => (
              <li
                key={category.value}
                className="flex items-center gap-2 text-xs text-warm-mid"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold"
                  aria-hidden="true"
                />
                {category.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {initialDocuments.length === 0 ? (
        <div className="rounded-lg border border-sand bg-cream px-5 py-10 text-center">
          <Folder
            className="mx-auto h-8 w-8 text-warm-gray"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm font-semibold text-warm-dark">
            No documents uploaded yet
          </p>
          <p className="mt-1 text-xs leading-5 text-warm-mid">
            Choose a category above when you are ready to add the first file.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {CATEGORIES.map((category) => {
            const documents = byCategory[category.value];
            if (!documents?.length) return null;
            return (
              <section
                key={category.value}
                className="overflow-hidden rounded-lg border border-sand bg-cream"
              >
                <div className="flex items-center gap-2 border-b border-sand px-4 py-3">
                  <Folder
                    className="h-4 w-4 text-gold"
                    aria-hidden="true"
                  />
                  <h4 className="text-sm font-semibold text-warm-dark">
                    {category.label}
                  </h4>
                  <span className="ml-auto text-xs text-warm-mid">
                    {documents.length}{" "}
                    {documents.length === 1 ? "file" : "files"}
                  </span>
                </div>
                <div className="divide-y divide-sand">
                  {documents.map((document) => {
                    const status =
                      STATUS_CONFIG[document.status] ??
                      STATUS_CONFIG.pending_review;
                    const StatusIcon = status.icon;
                    return (
                      <div
                        key={document.id}
                        className="flex items-center gap-3 px-4 py-3"
                      >
                        <File
                          className="h-4 w-4 shrink-0 text-warm-gray"
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-warm-dark">
                            {document.filename}
                          </p>
                          <p className="text-xs text-warm-mid">
                            {formatDate(document.created_at)} ·{" "}
                            {formatBytes(document.file_size)}
                          </p>
                        </div>
                        <div
                          className={`flex shrink-0 items-center gap-1.5 text-xs font-semibold ${status.color}`}
                        >
                          <StatusIcon
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                          {status.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

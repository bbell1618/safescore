import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import {
  createCpdpCaseForCrash,
  ingestPar,
  PAR_FUNCTION_UPLOAD_MAX_BYTES,
  ParIntakeError,
} from "@/lib/cpdp/par-intake-server";
import { fetchRemoteLexisPar } from "@/lib/cpdp/remote-par-fetch-server";

export const maxDuration = 180;

const documentSchema = z.union([
  z.string().min(1),
  z.object({ base64: z.string().min(1), filename: z.string().min(1).optional(), mime_type: z.string().min(1).optional() }),
  z.object({ url: z.string().url(), filename: z.string().min(1).optional(), mime_type: z.string().min(1).optional() }),
]);

const webhookSchema = z.object({
  report_number: z.string().trim().min(1).max(100),
  state: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  document: documentSchema,
  filename: z.string().trim().min(1).max(255).optional(),
  mime_type: z.string().trim().min(1).max(100).optional(),
  provider_reference: z.string().trim().min(1).max(255).optional(),
});

function suppliedSecret(request: Request) {
  const direct = request.headers.get("x-lexisnexis-secret");
  if (direct) return direct;
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
}

function secretsMatch(actual: string, expected: string) {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function decodeBase64(value: string) {
  const normalized = value.replace(/^data:[^;,]+;base64,/i, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new ParIntakeError("LexisNexis document base64 is invalid.", 422);
  }
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.length > PAR_FUNCTION_UPLOAD_MAX_BYTES) {
    throw new ParIntakeError("Base64 PAR exceeds the 3 MB webhook request limit; use approved URL delivery.", 413);
  }
  return bytes;
}

async function resolveDocument(input: z.infer<typeof webhookSchema>) {
  const document = input.document;
  if (typeof document === "string") {
    if (/^https:\/\//i.test(document)) return fetchRemoteLexisPar(document);
    return { bytes: decodeBase64(document), mimeType: input.mime_type ?? null, filename: input.filename ?? "police-accident-report.pdf" };
  }
  if ("url" in document) {
    const fetched = await fetchRemoteLexisPar(document.url);
    return {
      ...fetched,
      mimeType: document.mime_type ?? input.mime_type ?? fetched.mimeType,
      filename: document.filename ?? input.filename ?? fetched.filename,
    };
  }
  return {
    bytes: decodeBase64(document.base64),
    mimeType: document.mime_type ?? input.mime_type ?? null,
    filename: document.filename ?? input.filename ?? "police-accident-report.pdf",
  };
}

export async function POST(request: Request) {
  const configuredSecret = process.env.LEXISNEXIS_WEBHOOK_SECRET;
  if (!configuredSecret) {
    return NextResponse.json({ error: "integration not configured" }, { status: 503 });
  }
  if (!secretsMatch(suppliedSecret(request), configuredSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid webhook payload", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const service = await createServiceClient();
    const crashes = await service
      .from("crashes")
      .select("id")
      .eq("report_number", parsed.data.report_number)
      .eq("state", parsed.data.state)
      .limit(2);
    if (crashes.error) throw new ParIntakeError(`Unable to resolve crash: ${crashes.error.message}`, 500);
    if ((crashes.data ?? []).length === 0) throw new ParIntakeError("No crash matches that report number and state.", 404);
    if ((crashes.data ?? []).length > 1) throw new ParIntakeError("Crash match is ambiguous for that report number and state.", 409);

    const document = await resolveDocument(parsed.data);
    const caseId = await createCpdpCaseForCrash(service, { crashId: crashes.data![0].id, actorUserId: null });
    const result = await ingestPar(service, {
      caseId,
      filename: document.filename,
      declaredMimeType: document.mimeType,
      bytes: document.bytes,
      source: "lexisnexis",
      actorUserId: null,
      localReportNumber: parsed.data.report_number,
      providerReference: parsed.data.provider_reference ?? null,
    });
    return NextResponse.json({
      ok: true,
      case_id: result.caseId,
      crash_id: result.crashId,
      document_id: result.documentId,
      assessment_status: "ready_for_review",
      idempotent: result.alreadyReceived,
    }, { status: result.alreadyReceived ? 200 : 201 });
  } catch (error) {
    if (error instanceof ParIntakeError) {
      return NextResponse.json({ error: error.message, stored: error.stored, ...error.identifiers }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "PAR intake failed" }, { status: 500 });
  }
}

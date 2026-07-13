import type { PARRetrievalProvider, ParRetrievalRequest, ParRetrievalResult, ParRetrievalStatus } from "./provider";

type LexisResponse = {
  status?: string;
  reference_id?: string;
  message?: string;
  filename?: string;
  mime_type?: string;
  file_base64?: string;
  download_url?: string;
};

export class LexisNexisPARRetrievalProvider implements PARRetrievalProvider {
  private apiKey = process.env.LEXISNEXIS_API_KEY;
  private endpoint = process.env.LEXISNEXIS_PAR_ENDPOINT;

  status(): ParRetrievalStatus {
    const missingEnvVars = [!this.apiKey ? "LEXISNEXIS_API_KEY" : null, !this.endpoint ? "LEXISNEXIS_PAR_ENDPOINT" : null]
      .filter((name): name is string => Boolean(name));
    return missingEnvVars.length > 0
      ? { state: "not_configured", provider: "lexisnexis", missingEnvVars }
      : { state: "ready", provider: "lexisnexis" };
  }

  async retrieve(request: ParRetrievalRequest): Promise<ParRetrievalResult> {
    if (this.status().state === "not_configured") {
      return { state: "pending", message: "PAR retrieval pending account activation." };
    }
    const response = await fetch(this.endpoint!, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        carrier_dot_number: request.carrierDotNumber,
        crash_date: request.crashDate,
        state: request.state,
        city: request.city ?? undefined,
        fmcsa_crash_number: request.fmcsaCrashNumber ?? undefined,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`LexisNexis PAR request failed with HTTP ${response.status}`);
    const payload = await response.json() as LexisResponse;
    if (payload.file_base64) {
      return {
        state: "found",
        filename: payload.filename ?? "police-accident-report.pdf",
        mimeType: payload.mime_type ?? "application/pdf",
        bytes: Uint8Array.from(Buffer.from(payload.file_base64, "base64")),
        providerReference: payload.reference_id,
      };
    }
    if (payload.download_url) {
      const fileResponse = await fetch(payload.download_url, { signal: AbortSignal.timeout(30_000) });
      if (!fileResponse.ok) throw new Error(`LexisNexis PAR download failed with HTTP ${fileResponse.status}`);
      return {
        state: "found",
        filename: payload.filename ?? "police-accident-report.pdf",
        mimeType: payload.mime_type ?? fileResponse.headers.get("content-type") ?? "application/pdf",
        bytes: new Uint8Array(await fileResponse.arrayBuffer()),
        providerReference: payload.reference_id,
      };
    }
    if (payload.status === "pending") {
      return { state: "pending", providerReference: payload.reference_id, message: payload.message ?? "PAR request is pending." };
    }
    return { state: "not_found", message: payload.message ?? "No matching PAR was returned." };
  }
}

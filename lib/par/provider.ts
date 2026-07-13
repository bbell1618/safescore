export type ParRetrievalStatus =
  | { state: "ready"; provider: "lexisnexis" }
  | { state: "not_configured"; provider: "lexisnexis"; missingEnvVars: string[] };

export type ParRetrievalRequest = {
  carrierDotNumber: string;
  crashDate: string;
  state: string;
  city?: string | null;
  fmcsaCrashNumber?: string | null;
};

export type ParRetrievalResult =
  | { state: "found"; filename: string; mimeType: string; bytes: Uint8Array; providerReference?: string }
  | { state: "pending"; providerReference?: string; message: string }
  | { state: "not_found"; message: string };

export interface PARRetrievalProvider {
  status(): ParRetrievalStatus;
  retrieve(request: ParRetrievalRequest): Promise<ParRetrievalResult>;
}

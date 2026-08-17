export const ROSTER_DOCUMENT_TYPES = ["cdl", "medical_cert"] as const;

export type RosterDocumentType = (typeof ROSTER_DOCUMENT_TYPES)[number];

export type RosterDocument = {
  id: string;
  driverDocumentId: string;
  docType: RosterDocumentType;
  filename: string;
  mimeType: string | null;
  fileSize: number | null;
  reviewStatus: "pending_review" | "reviewed";
  createdAt: string;
};

export type RosterStagedDriver = {
  id: string;
  fullName: string;
  cdlNumber: string;
  cdlState: string;
  cdlClass: string;
  cdlExpiry: string | null;
  medicalCertExpiry: string | null;
  hiredDate: string | null;
  /** Null until GEIA accepts the client-submitted row into the official roster. */
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  documents: RosterDocument[];
};

export type RosterRequestSummary = {
  id: string;
  clientName: string;
  title: string;
  status: "open";
  submittedAt: string | null;
  response: unknown;
};

export type RosterCollectionResponse = {
  request: RosterRequestSummary;
  drivers: RosterStagedDriver[];
};

export type RosterDriverResponse = {
  driver: RosterStagedDriver;
};

export type RosterDeleteDriverResponse = {
  ok: true;
  driverId: string;
};

export type RosterDocumentResponse = {
  document: RosterDocument;
};

export type RosterSubmitResponse = {
  ok: true;
  submittedAt: string;
  response: string;
  driverCount: number;
};

export type StaffRosterRequestResponse = {
  request: {
    id: string;
    status: "open";
    created: boolean;
    reopened: boolean;
  };
  rosterUrl: string;
  emailDelivery: {
    status: "dry_run" | "sent" | "failed" | "skipped";
    dryRun: boolean;
    reason?: string;
  };
};

export type CloseRosterRequestResponse = {
  request: {
    id: string;
    status: "fulfilled";
    closedAt: string;
  };
};

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  evaluateMcs150TruthUp,
  type Mcs150ProfileValues,
} from "@/lib/mcs150/truth-up";
import {
  buildMcs150RequestDescription,
  comparableMcs150Proposal,
} from "@/lib/mcs150/truth-up-server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { normalizeClientTier, tierHasFeature } from "@/lib/tiers";

export const dynamic = "force-dynamic";

const clientIdSchema = z.string().uuid();
const nullableText = (maximum: number) =>
  z.union([z.string().trim().min(1).max(maximum), z.null()]).optional();
const officialSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    title: z.union([z.string().trim().min(1).max(160), z.null()]).optional(),
  })
  .strict();
const updateSchema = z
  .object({
    power_units: z.number().int().nonnegative().max(10_000_000),
    drivers: z.number().int().nonnegative().max(10_000_000),
    annual_mileage: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    mileage_year: z.number().int().min(1900).max(2100),
    operation_classification: nullableText(500),
    cargo_types: z
      .array(z.string().trim().min(1).max(160))
      .max(100)
      .optional(),
    physical_address: nullableText(1_000),
    mailing_address: nullableText(1_000),
    officials: z.array(officialSchema).max(50).optional(),
  })
  .strict();
const submissionSchema = z
  .object({
    action: z.literal("record_submission"),
    update_id: z.string().uuid(),
    submitted_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD submission date."),
  })
  .strict();

const ATTESTED_SELECT =
  "id, client_id, power_units, drivers, annual_mileage, mileage_year, operation_classification, cargo_types, physical_address, mailing_address, officials, source, attested_at, attested_by, created_at, updated_at";
const OPEN_UPDATE_STATUSES = ["draft", "pending_review", "submitted"] as const;

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;
type AttestedProfile =
  Database["public"]["Tables"]["client_attested_profiles"]["Row"];

type ClientRecord = {
  id: string;
  name: string;
  dot_number: string;
  tier: string | null;
};

type CarrierProfile = {
  id: string;
  power_units: number | null;
  drivers: number | null;
  mcs150_date: string | null;
  mcs150_mileage: number | null;
  mcs150_mileage_year: number | null;
  operation_classification: string | null;
  cargo_types: string[] | null;
  address: string | null;
  physical_address: string | null;
  mailing_address: string | null;
  safer_as_of: string | null;
  fetched_at: string;
};

type AuthorizedContext = {
  service: ServiceClient;
  userId: string;
  client: ClientRecord;
};

type AuthorizationResult =
  | { context: AuthorizedContext; response?: never }
  | { context?: never; response: NextResponse };

class Mcs150RouteError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function errorResponse(error: string, status: number): NextResponse {
  return NextResponse.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

async function authorize(clientId: string): Promise<AuthorizationResult> {
  const session = await createClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) {
    return { response: errorResponse("Unauthorized", 401) };
  }

  const service = await createServiceClient();
  const staffResult = await service
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (staffResult.error) {
    return {
      response: errorResponse(
        `Unable to verify MCS-150 permissions: ${staffResult.error.message}`,
        500
      ),
    };
  }
  if (
    staffResult.data?.role !== "geia_admin" &&
    staffResult.data?.role !== "geia_staff"
  ) {
    return { response: errorResponse("Forbidden", 403) };
  }

  const clientResult = await service
    .from("clients")
    .select("id, name, dot_number, tier")
    .eq("id", clientId)
    .maybeSingle();
  if (clientResult.error) {
    return {
      response: errorResponse(
        `Unable to load the MCS-150 client: ${clientResult.error.message}`,
        500
      ),
    };
  }
  if (!clientResult.data) {
    return { response: errorResponse("Client not found", 404) };
  }

  const client = clientResult.data as ClientRecord;
  if (
    !tierHasFeature(normalizeClientTier(client.tier), "compliance_layer")
  ) {
    return {
      response: errorResponse(
        "MCS-150 truth-up requires the Total Safety service tier.",
        403
      ),
    };
  }

  return { context: { service, userId: user.id, client } };
}

function censusValues(profile: CarrierProfile): Mcs150ProfileValues {
  return {
    power_units: profile.power_units,
    drivers: profile.drivers,
    annual_mileage: profile.mcs150_mileage,
    mileage_year: profile.mcs150_mileage_year,
    operation_classification: profile.operation_classification,
    cargo_types: profile.cargo_types ?? [],
    physical_address: profile.physical_address ?? profile.address,
    mailing_address: profile.mailing_address,
    officials: [],
  };
}

function attestedValues(profile: AttestedProfile): Mcs150ProfileValues {
  return {
    power_units: profile.power_units,
    drivers: profile.drivers,
    annual_mileage: profile.annual_mileage,
    mileage_year: profile.mileage_year,
    operation_classification: profile.operation_classification,
    cargo_types: profile.cargo_types,
    physical_address: profile.physical_address,
    mailing_address: profile.mailing_address,
    officials: profile.officials as Mcs150ProfileValues["officials"],
  };
}

function pacificDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function isIsoCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function censusDefaultPayload(
  clientId: string,
  census: Mcs150ProfileValues
) {
  return {
    client_id: clientId,
    power_units: census.power_units,
    drivers: census.drivers,
    annual_mileage: census.annual_mileage,
    mileage_year: census.mileage_year,
    operation_classification: census.operation_classification ?? null,
    cargo_types: census.cargo_types ?? [],
    physical_address: census.physical_address ?? null,
    mailing_address: census.mailing_address ?? null,
    officials: census.officials ?? [],
    source: "census_default" as const,
    attested_at: null,
    attested_by: null,
  };
}

async function initializeAttestedProfile(
  context: AuthorizedContext,
  census: Mcs150ProfileValues
): Promise<AttestedProfile> {
  const payload = censusDefaultPayload(context.client.id, census);
  const insertResult = await context.service
    .from("client_attested_profiles")
    .insert(payload)
    .select(ATTESTED_SELECT)
    .single();
  if (!insertResult.error && insertResult.data) {
    const inserted = insertResult.data as unknown as AttestedProfile;
    const activityResult = await context.service.from("activity_log").insert({
      client_id: context.client.id,
      user_id: context.userId,
      action_type: "mcs150_attested_profile_initialized",
      entity_type: "client_attested_profiles",
      entity_id: inserted.id,
      description: `MCS-150 comparison values were initialized from the current public census for ${context.client.name}.`,
      metadata: {
        source: "census_default",
        operator_attested: false,
        initialized_fields: [
          "power_units",
          "drivers",
          "annual_mileage",
          "mileage_year",
          "operation_classification",
          "cargo_types",
          "physical_address",
          "mailing_address",
        ],
      },
    });
    if (activityResult.error) {
      throw new Error(
        `The census-default profile was initialized, but its activity log failed: ${activityResult.error.message}`
      );
    }
    return inserted;
  }
  if (insertResult.error?.code !== "23505") {
    throw new Error(
      `Unable to initialize the attested MCS-150 profile: ${
        insertResult.error?.message ?? "No row returned"
      }`
    );
  }

  // A concurrent first-open request may win the unique client_id insert.
  const reread = await context.service
    .from("client_attested_profiles")
    .select(ATTESTED_SELECT)
    .eq("client_id", context.client.id)
    .single();
  if (reread.error || !reread.data) {
    throw new Error(
      `Unable to load the concurrently initialized attested profile: ${
        reread.error?.message ?? "No row returned"
      }`
    );
  }
  return reread.data as unknown as AttestedProfile;
}

async function synchronizeCensusDefault(
  context: AuthorizedContext,
  profile: AttestedProfile,
  census: Mcs150ProfileValues
): Promise<AttestedProfile> {
  if (profile.source !== "census_default") return profile;
  const payload = censusDefaultPayload(context.client.id, census);
  const synchronizedFields: Array<keyof typeof payload> = [
    "power_units",
    "drivers",
    "annual_mileage",
    "mileage_year",
    "operation_classification",
    "cargo_types",
    "physical_address",
    "mailing_address",
    "officials",
    "source",
    "attested_at",
    "attested_by",
  ];
  if (
    synchronizedFields.every(
      (field) =>
        stableValue(profile[field as keyof AttestedProfile]) ===
        stableValue(payload[field])
    )
  ) {
    return profile;
  }
  const updateResult = await context.service
    .from("client_attested_profiles")
    .update(payload)
    .eq("id", profile.id)
    .eq("source", "census_default")
    .select(ATTESTED_SELECT)
    .maybeSingle();
  if (updateResult.error) {
    throw new Error(
      `Unable to synchronize the census-default profile: ${updateResult.error.message}`
    );
  }
  if (updateResult.data) {
    return updateResult.data as unknown as AttestedProfile;
  }

  // An operator may save while GET is synchronizing. Never overwrite the
  // newly operator-recorded row; re-read it instead.
  const reread = await context.service
    .from("client_attested_profiles")
    .select(ATTESTED_SELECT)
    .eq("client_id", context.client.id)
    .single();
  if (reread.error || !reread.data) {
    throw new Error(
      `Unable to re-read the attested profile after synchronization: ${
        reread.error?.message ?? "No row returned"
      }`
    );
  }
  return reread.data as unknown as AttestedProfile;
}

async function loadState(
  context: AuthorizedContext,
  initializeIfMissing: boolean
) {
  const { service, client } = context;
  const profileResult = await service
    .from("carrier_profiles")
    .select(
      "id, power_units, drivers, mcs150_date, mcs150_mileage, mcs150_mileage_year, operation_classification, cargo_types, address, physical_address, mailing_address, safer_as_of, fetched_at"
    )
    .eq("client_id", client.id)
    .maybeSingle();
  if (profileResult.error) {
    throw new Error(
      `Unable to load the public MCS-150 census: ${profileResult.error.message}`
    );
  }
  if (!profileResult.data) {
    throw new Mcs150RouteError(
      "No public carrier census is available. Refresh the carrier profile before recording an attested MCS-150 profile.",
      422
    );
  }

  const carrierProfile = profileResult.data as CarrierProfile;
  const census = censusValues(carrierProfile);
  const [attestedResult, burdenResult, updatesResult] = await Promise.all([
    service
      .from("client_attested_profiles")
      .select(ATTESTED_SELECT)
      .eq("client_id", client.id)
      .maybeSingle(),
    service
      .from("burden_snapshots")
      .select("id, total_points, snapshot_date, captured_at")
      .eq("client_id", client.id)
      .order("captured_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
    service
      .from("mcs150_updates")
      .select(
        "id, status, proposed_changes, trigger_reasons, honesty_prediction, biennial_due_date, client_request_id, submitted_date, created_at, updated_at"
      )
      .eq("client_id", client.id)
      .in("status", [...OPEN_UPDATE_STATUSES])
      .order("created_at", { ascending: false }),
  ]);
  if (attestedResult.error) {
    throw new Error(
      `Unable to load the attested MCS-150 profile: ${attestedResult.error.message}`
    );
  }
  if (burdenResult.error) {
    throw new Error(
      `Unable to load the current burden snapshot: ${burdenResult.error.message}`
    );
  }
  if (updatesResult.error) {
    throw new Error(
      `Unable to load open MCS-150 updates: ${updatesResult.error.message}`
    );
  }

  let attestedProfile = attestedResult.data as AttestedProfile | null;
  if (!attestedProfile && initializeIfMissing) {
    attestedProfile = await initializeAttestedProfile(
      context,
      census
    );
  }
  if (!attestedProfile) {
    throw new Error("No attested MCS-150 profile is available.");
  }
  if (initializeIfMissing && attestedProfile.source === "census_default") {
    attestedProfile = await synchronizeCensusDefault(
      context,
      attestedProfile,
      census
    );
  }

  const latestBurden = burdenResult.data as {
    id: string;
    total_points: number;
    snapshot_date: string;
    captured_at: string;
  } | null;
  const evaluation = evaluateMcs150TruthUp({
    dotNumber: client.dot_number,
    lastFiledDate: carrierProfile.mcs150_date,
    census,
    attested: {
      power_units: attestedProfile.power_units,
      drivers: attestedProfile.drivers,
      annual_mileage: attestedProfile.annual_mileage,
      mileage_year: attestedProfile.mileage_year,
      operation_classification:
        attestedProfile.operation_classification,
      cargo_types: attestedProfile.cargo_types,
      physical_address: attestedProfile.physical_address,
      mailing_address: attestedProfile.mailing_address,
      officials: attestedProfile.officials as Mcs150ProfileValues["officials"],
    },
    burdenPoints: latestBurden?.total_points ?? null,
    asOf: pacificDateString(),
  });

  return {
    attestedProfile,
    census: {
      ...census,
      last_filed_date: carrierProfile.mcs150_date,
      safer_as_of: carrierProfile.safer_as_of,
      fetched_at: carrierProfile.fetched_at,
    },
    latestBurden,
    openUpdates: updatesResult.data ?? [],
    evaluation,
  };
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableValue).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableValue(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizedCargo(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean))
  ).sort((left, right) => left.localeCompare(right));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsedId = clientIdSchema.safeParse(id);
  if (!parsedId.success) {
    return errorResponse("Invalid client ID", 400);
  }
  const authorization = await authorize(parsedId.data);
  if (authorization.response) return authorization.response;

  try {
    const state = await loadState(authorization.context, true);
    return NextResponse.json(state, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Unable to load the MCS-150 truth-up.",
      error instanceof Mcs150RouteError ? error.status : 500
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsedId = clientIdSchema.safeParse(id);
  if (!parsedId.success) {
    return errorResponse("Invalid client ID", 400);
  }
  const authorization = await authorize(parsedId.data);
  if (authorization.response) return authorization.response;
  const { context } = authorization;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON", 400);
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid attested profile", details: parsed.error.flatten() },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const existingResult = await context.service
      .from("client_attested_profiles")
      .select(ATTESTED_SELECT)
      .eq("client_id", context.client.id)
      .maybeSingle();
    if (existingResult.error) {
      throw new Error(
        `Unable to load the prior attested profile: ${existingResult.error.message}`
      );
    }
    const existing = existingResult.data as AttestedProfile | null;
    const input = parsed.data;
    const attestedAt = new Date().toISOString();
    const cargoTypes =
      normalizedCargo(input.cargo_types) ??
      existing?.cargo_types ??
      [];
    const officials =
      input.officials !== undefined
        ? input.officials
        : ((existing?.officials ?? []) as Array<{
            name: string;
            title?: string | null;
          }>);
    const payload = {
      client_id: context.client.id,
      power_units: input.power_units,
      drivers: input.drivers,
      annual_mileage: input.annual_mileage,
      mileage_year: input.mileage_year,
      operation_classification:
        input.operation_classification !== undefined
          ? input.operation_classification
          : existing?.operation_classification ?? null,
      cargo_types: cargoTypes,
      physical_address:
        input.physical_address !== undefined
          ? input.physical_address
          : existing?.physical_address ?? null,
      mailing_address:
        input.mailing_address !== undefined
          ? input.mailing_address
          : existing?.mailing_address ?? null,
      officials,
      source: "operator_recorded" as const,
      attested_at: attestedAt,
      attested_by: context.userId,
    };

    const writeResult = await context.service
      .from("client_attested_profiles")
      .upsert(payload, { onConflict: "client_id" })
      .select(ATTESTED_SELECT)
      .single();
    if (writeResult.error || !writeResult.data) {
      throw new Error(
        `Unable to save the attested MCS-150 profile: ${
          writeResult.error?.message ?? "No row returned"
        }`
      );
    }
    const saved = writeResult.data as unknown as AttestedProfile;

    const recheckResult = await context.service
      .from("client_attested_profiles")
      .select(ATTESTED_SELECT)
      .eq("id", saved.id)
      .single();
    if (recheckResult.error || !recheckResult.data) {
      throw new Error(
        `The attested profile was written but could not be re-read: ${
          recheckResult.error?.message ?? "No row returned"
        }`
      );
    }
    const rechecked = recheckResult.data as unknown as AttestedProfile;
    const expectedValues: Record<string, unknown> = {
      power_units: payload.power_units,
      drivers: payload.drivers,
      annual_mileage: payload.annual_mileage,
      mileage_year: payload.mileage_year,
      operation_classification: payload.operation_classification,
      cargo_types: payload.cargo_types,
      physical_address: payload.physical_address,
      mailing_address: payload.mailing_address,
      officials: payload.officials,
      source: payload.source,
      attested_by: payload.attested_by,
    };
    const postconditionFailures = Object.entries(expectedValues)
      .filter(
        ([key, value]) =>
          stableValue(rechecked[key as keyof AttestedProfile]) !==
          stableValue(value)
      )
      .map(([key]) => key);
    if (
      !rechecked.attested_at ||
      Date.parse(rechecked.attested_at) !== Date.parse(attestedAt)
    ) {
      postconditionFailures.push("attested_at");
    }
    if (postconditionFailures.length > 0) {
      throw new Error(
        `Attested profile postcondition failed for: ${postconditionFailures.join(
          ", "
        )}`
      );
    }

    const changedFields = Object.entries(expectedValues)
      .filter(
        ([key, value]) =>
          stableValue(existing?.[key as keyof AttestedProfile]) !==
          stableValue(value)
      )
      .map(([key]) => key);
    const activityResult = await context.service.from("activity_log").insert({
      client_id: context.client.id,
      user_id: context.userId,
      action_type: "mcs150_attested_profile_updated",
      entity_type: "client_attested_profiles",
      entity_id: saved.id,
      description: `Carrier-attested MCS-150 operating values were recorded for ${context.client.name}.`,
      metadata: {
        source: "operator_recorded",
        changed_fields: changedFields,
        prior_profile_id: existing?.id ?? null,
        postcondition: "passed",
      },
    });
    if (activityResult.error) {
      throw new Error(
        `The attested profile was saved, but its activity log failed: ${activityResult.error.message}`
      );
    }

    let state = await loadState(context, false);
    const editableUpdate = state.openUpdates.find(
      (update) =>
        update.status === "draft" || update.status === "pending_review"
    );
    if (editableUpdate) {
      const census: Mcs150ProfileValues = {
        power_units: state.census.power_units,
        drivers: state.census.drivers,
        annual_mileage: state.census.annual_mileage,
        mileage_year: state.census.mileage_year,
        operation_classification:
          state.census.operation_classification ?? null,
        cargo_types: state.census.cargo_types ?? [],
        physical_address: state.census.physical_address ?? null,
        mailing_address: state.census.mailing_address ?? null,
        officials: state.census.officials ?? null,
      };
      const currentAttested = attestedValues(state.attestedProfile);
      const draftResult = await context.service
        .from("mcs150_updates")
        .update({
          proposed_changes: comparableMcs150Proposal(
            census,
            currentAttested
          ),
          trigger_key: state.evaluation.fingerprint,
          trigger_reasons: state.evaluation.triggerReasons,
          attested_snapshot: currentAttested,
          honesty_prediction: state.evaluation.honestyPrediction,
          biennial_due_date: state.evaluation.clock.nextDueDate,
          last_checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", editableUpdate.id)
        .eq("client_id", context.client.id)
        .in("status", ["draft", "pending_review"])
        .select("id")
        .maybeSingle();
      if (draftResult.error || !draftResult.data) {
        throw new Error(
          `The attested profile was saved, but the open MCS-150 draft could not be refreshed: ${
            draftResult.error?.message ?? "No editable draft returned"
          }`
        );
      }
      if (editableUpdate.client_request_id) {
        const requestResult = await context.service
          .from("client_requests")
          .update({
            description: buildMcs150RequestDescription(state.evaluation),
            updated_at: new Date().toISOString(),
          })
          .eq("id", editableUpdate.client_request_id)
          .eq("client_id", context.client.id)
          .eq("status", "open");
        if (requestResult.error) {
          throw new Error(
            `The MCS-150 draft was refreshed, but its client request could not be updated: ${requestResult.error.message}`
          );
        }
      }
      state = await loadState(context, false);
    }
    return NextResponse.json(state, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Unable to save the attested MCS-150 profile.",
      error instanceof Mcs150RouteError ? error.status : 500
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsedId = clientIdSchema.safeParse(id);
  if (!parsedId.success) {
    return errorResponse("Invalid client ID", 400);
  }
  const authorization = await authorize(parsedId.data);
  if (authorization.response) return authorization.response;
  const { context } = authorization;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON", 400);
  }
  const parsed = submissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid submission record", details: parsed.error.flatten() },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const state = await loadState(context, false);
    if (state.attestedProfile.source !== "operator_recorded") {
      throw new Mcs150RouteError(
        "Record carrier-attested operating values before recording an MCS-150 submission.",
        409
      );
    }
    if (!state.evaluation.shouldTrigger) {
      throw new Mcs150RouteError(
        "The current census and attested profile no longer require an MCS-150 correction.",
        409
      );
    }
    const submittedDate = parsed.data.submitted_date;
    if (
      !isIsoCalendarDate(submittedDate) ||
      submittedDate > pacificDateString()
    ) {
      throw new Mcs150RouteError(
        "Submission date must be a real date no later than today.",
        400
      );
    }

    const updateResult = await context.service
      .from("mcs150_updates")
      .select("id, status, client_request_id, census_snapshot")
      .eq("id", parsed.data.update_id)
      .eq("client_id", context.client.id)
      .maybeSingle();
    if (updateResult.error) {
      throw new Error(
        `Unable to load the MCS-150 draft: ${updateResult.error.message}`
      );
    }
    if (!updateResult.data) {
      throw new Mcs150RouteError("MCS-150 draft not found.", 404);
    }
    if (
      updateResult.data.status !== "draft" &&
      updateResult.data.status !== "pending_review"
    ) {
      throw new Mcs150RouteError(
        "Only an editable MCS-150 draft can be recorded as submitted.",
        409
      );
    }
    if (!updateResult.data.census_snapshot) {
      throw new Mcs150RouteError(
        "This draft has no baseline census snapshot and cannot safely enter the public-confirmation loop.",
        409
      );
    }

    const census: Mcs150ProfileValues = {
      power_units: state.census.power_units,
      drivers: state.census.drivers,
      annual_mileage: state.census.annual_mileage,
      mileage_year: state.census.mileage_year,
      operation_classification: state.census.operation_classification,
      cargo_types: state.census.cargo_types,
      physical_address: state.census.physical_address,
      mailing_address: state.census.mailing_address,
      officials: state.census.officials,
    };
    const currentAttested = attestedValues(state.attestedProfile);
    const { data: submissionRows, error: submissionError } =
      await context.service.rpc("record_mcs150_submission_v1", {
        p_client_id: context.client.id,
        p_update_id: updateResult.data.id,
        p_submitted_date: submittedDate,
        p_proposed_changes: comparableMcs150Proposal(
          census,
          currentAttested
        ) as unknown as Record<string, unknown>,
        p_trigger_key: state.evaluation.fingerprint,
        p_trigger_reasons: state.evaluation.triggerReasons,
        p_attested_snapshot:
          currentAttested as unknown as Record<string, unknown>,
        p_honesty_prediction:
          state.evaluation.honestyPrediction as unknown as Record<
            string,
            unknown
          >,
        p_biennial_due_date: state.evaluation.clock.nextDueDate,
        p_notes:
          "The operator recorded that the carrier attested to the figures and submitted through its own Login.gov account. Awaiting a newer matching public census.",
        p_request_description: buildMcs150RequestDescription(
          state.evaluation
        ),
        p_user_id: context.userId,
      });
    if (submissionError) {
      throw new Error(
        `Unable to atomically record the carrier's MCS-150 submission: ${submissionError.message}`
      );
    }
    const submission = submissionRows?.[0];
    if (
      !submission ||
      submission.status !== "submitted" ||
      submission.submitted_date !== submittedDate
    ) {
      throw new Error(
        "Atomic submission did not return the expected submitted postcondition."
      );
    }

    const refreshedState = await loadState(context, false);
    return NextResponse.json(refreshedState, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Unable to record the MCS-150 submission.",
      error instanceof Mcs150RouteError ? error.status : 500
    );
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { refreshCarrierProfileEnrichment } from "@/lib/fmcsa/carrier-profile-enrichment-server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const clientIdSchema = z.string().uuid();
const ENRICHMENT_SELECT =
  "id, client_id, source, source_url, source_as_of, fetched_at, currentness, data, parser_version, created_at, updated_at";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

type AuthorizedContext = {
  clientId: string;
  dotNumber: string;
  service: ServiceClient;
  userId: string;
};

type AuthorizationResult =
  | { context: AuthorizedContext; response?: never }
  | { context?: never; response: NextResponse };

function jsonError(error: string, status: number) {
  return NextResponse.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

async function authorize(rawClientId: string): Promise<AuthorizationResult> {
  const parsedClientId = clientIdSchema.safeParse(rawClientId);
  if (!parsedClientId.success) {
    return { response: jsonError("Invalid client id", 400) };
  }

  const session = await createClient();
  const {
    data: { user },
    error: authError,
  } = await session.auth.getUser();
  if (authError) {
    return {
      response: jsonError(
        `Unable to verify the current session: ${authError.message}`,
        500
      ),
    };
  }
  if (!user) {
    return { response: jsonError("Unauthorized", 401) };
  }

  const service = await createServiceClient();
  const { data: staff, error: staffError } = await service
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (staffError) {
    return {
      response: jsonError(
        `Unable to verify authority and insurance permissions: ${staffError.message}`,
        500
      ),
    };
  }
  if (staff?.role !== "geia_admin" && staff?.role !== "geia_staff") {
    return { response: jsonError("Forbidden", 403) };
  }

  const { data: client, error: clientError } = await service
    .from("clients")
    .select("id, dot_number")
    .eq("id", parsedClientId.data)
    .maybeSingle();
  if (clientError) {
    return {
      response: jsonError(
        `Unable to load the carrier: ${clientError.message}`,
        500
      ),
    };
  }
  if (!client) {
    return { response: jsonError("Client not found", 404) };
  }

  return {
    context: {
      clientId: client.id,
      dotNumber: client.dot_number,
      service,
      userId: user.id,
    },
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authorization = await authorize(id);
  if (authorization.response) return authorization.response;

  const { data: rows, error } = await authorization.context.service
    .from("carrier_profile_enrichments")
    .select(ENRICHMENT_SELECT)
    .eq("client_id", authorization.context.clientId)
    .order("source", { ascending: true });
  if (error) {
    return jsonError(
      `Unable to load authority and insurance data: ${error.message}`,
      500
    );
  }

  return NextResponse.json(
    { rows: rows ?? [] },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authorization = await authorize(id);
  if (authorization.response) return authorization.response;

  try {
    const refresh = await refreshCarrierProfileEnrichment({
      clientId: authorization.context.clientId,
      dotNumber: authorization.context.dotNumber,
      force: true,
      trigger: "operator",
      userId: authorization.context.userId,
    }, authorization.context.service);
    const failedSources = refresh.sources.filter(
      (source) => source.status === "failed"
    );
    if (failedSources.length > 0) {
      return NextResponse.json(
        {
          ...refresh,
          error: failedSources
            .map((source) => `${source.source}: ${source.reason}`)
            .join(" | "),
        },
        {
          status: 502,
          headers: { "Cache-Control": "no-store" },
        }
      );
    }
    return NextResponse.json(refresh, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown authority and insurance refresh failure";
    return jsonError(`Authority and insurance refresh failed: ${message}`, 500);
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { isClientOnboardingLocked } from "@/lib/auth/access";
import { ensureCitationDispositionFollowup } from "@/lib/evidence-loop/server";
import { notifyOperations } from "@/lib/notifications/operations";
import { didCitationDismissedAnswerChange } from "@/lib/onboarding/validation";

// Direct service-role client — no SSR cookie layer, definitively bypasses RLS.
function getAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: Request) {
  // ── Auth check (uses portal user's session cookie) ───────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // ── All DB operations use the admin client (bypasses RLS) ────────────────────
  const admin = getAdmin();

  const { data: userRecord, error: userError } = await admin
    .from("users")
    .select("client_id")
    .eq("id", user.id)
    .single();

  if (userError) {
    console.error(
      "onboarding-profile: user lookup failed:",
      userError.code,
      userError.message,
      userError.details
    );
    return NextResponse.json({ error: "User lookup failed" }, { status: 500 });
  }

  if (!userRecord?.client_id) {
    return NextResponse.json(
      { error: "No client associated with this account" },
      { status: 400 }
    );
  }

  const clientId = userRecord.client_id;

  const { data: clientRecord, error: clientError } = await admin
    .from("clients")
    .select(
      "name, dot_number, primary_contact, primary_contact_title, status, service_agreement_accepted, tier, citation_dismissed_last_24_months"
    )
    .eq("id", clientId)
    .single();

  if (clientError || !clientRecord) {
    console.error(
      "onboarding-profile: client lookup failed:",
      clientError?.code,
      clientError?.message,
      clientError?.details
    );
    return NextResponse.json(
      { error: clientError?.message ?? "Client lookup failed" },
      { status: 500 }
    );
  }

  if (isClientOnboardingLocked(clientRecord)) {
    return NextResponse.json(
      {
        error:
          "Onboarding is already complete for this carrier. Live client data cannot be changed through onboarding.",
        code: "ONBOARDING_LOCKED",
      },
      { status: 409 }
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "driverCount") &&
    (typeof body.driverCount !== "number" ||
      !Number.isInteger(body.driverCount) ||
      body.driverCount < 1 ||
      body.driverCount > 10000)
  ) {
    return NextResponse.json(
      {
        error: "Enter your current driver count (at least 1).",
        code: "DRIVER_COUNT_INVALID",
      },
      { status: 400 }
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      body,
      "citationDismissedLast24Months"
    ) &&
    typeof body.citationDismissedLast24Months !== "boolean"
  ) {
    return NextResponse.json(
      {
        error: "Choose yes or no for the roadside-ticket question.",
        code: "CITATION_ANSWER_REQUIRED",
      },
      { status: 400 }
    );
  }

  // Build update — only include fields that are present in the request body.
  // Columns added by migration: primary_contact_title, vehicle_types,
  // operating_states, operating_radius, service_agreement_accepted,
  // service_agreement_date.
  const update: Record<string, unknown> = {};

  if (body.contactName)    update.primary_contact       = body.contactName;
  if (body.contactTitle)   update.primary_contact_title = body.contactTitle;
  if (body.contactPhone)   update.phone                 = body.contactPhone;
  if (body.contactEmail)   update.email                 = body.contactEmail;

  if (Array.isArray(body.vehicleTypes) && body.vehicleTypes.length > 0) {
    update.vehicle_types = body.vehicleTypes;
  }
  if (Array.isArray(body.operatingStates) && body.operatingStates.length > 0) {
    update.operating_states = body.operatingStates;
  }
  if (body.operatingRadius) update.operating_radius = body.operatingRadius;
  if (typeof body.eldProvider === "string") update.eld_provider = body.eldProvider.trim() || null;
  if (typeof body.safetyContactName === "string") update.safety_contact_name = body.safetyContactName.trim() || null;
  if (typeof body.safetyContactEmail === "string") update.safety_contact_email = body.safetyContactEmail.trim() || null;
  if (typeof body.driverCount === "number") {
    update.driver_count = body.driverCount;
  }
  if (typeof body.citationDismissedLast24Months === "boolean") {
    update.citation_dismissed_last_24_months =
      body.citationDismissedLast24Months;
  }

  if (body.serviceAgreementAccepted === true) {
    update.service_agreement_accepted = true;
    update.service_agreement_date     = new Date().toISOString();
  }

  if (body.filingAuthorized === true) {
    const providedSigner =
      typeof body.filingAuthorizedBy === "string"
        ? body.filingAuthorizedBy.trim()
        : "";
    const primaryContact =
      typeof clientRecord?.primary_contact === "string"
        ? clientRecord.primary_contact.trim()
        : "";
    const primaryTitle =
      typeof clientRecord?.primary_contact_title === "string"
        ? clientRecord.primary_contact_title.trim()
        : "";

    update.filing_authorized = true;
    update.filing_authorized_at = new Date().toISOString();
    update.filing_authorized_by =
      providedSigner ||
      [primaryContact, primaryTitle].filter(Boolean).join(", ") ||
      null;
    update.filing_authorization_scope =
      "DataQs Requests for Data Review and Crash Preventability Determination (CPDP) requests filed by GEIA on the carrier behalf";
  }
  if (body.standingAuthorization === true) {
    update.standing_authorization = true;
    update.standing_authorized_at = new Date().toISOString();
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: true, skipped: true });
  }

  const profileUpdate = { ...update };
  delete profileUpdate.citation_dismissed_last_24_months;

  const previousCitationAnswer =
    typeof clientRecord.citation_dismissed_last_24_months === "boolean"
      ? clientRecord.citation_dismissed_last_24_months
      : null;
  let citationAnswerChanged = didCitationDismissedAnswerChange(
    previousCitationAnswer,
    body.citationDismissedLast24Months
  );

  // Persist only the client's answer before creating its derived request. The
  // remaining onboarding write can lock this route, so it must wait until the
  // follow-up exists. A side-effect failure leaves the answer authoritative and
  // the onboarding route retryable; scheduled reconciliation is a second repair.
  let followupRequestId: string | null = null;
  if (
    typeof body.citationDismissedLast24Months === "boolean" &&
    citationAnswerChanged
  ) {
    const answerUpdate = admin
      .from("clients")
      .update({
        citation_dismissed_last_24_months:
          body.citationDismissedLast24Months,
      })
      .eq("id", clientId);
    const guardedAnswerUpdate =
      previousCitationAnswer === null
        ? answerUpdate.is("citation_dismissed_last_24_months", null)
        : answerUpdate.eq(
            "citation_dismissed_last_24_months",
            previousCitationAnswer
          );
    const { data: answerClient, error: answerError } = await guardedAnswerUpdate
      .select("id")
      .maybeSingle();
    if (answerError) {
      return NextResponse.json(
        {
          error: answerError.message,
        },
        { status: 500 }
      );
    }
    if (!answerClient) {
      const { data: currentClient, error: currentClientError } = await admin
        .from("clients")
        .select("citation_dismissed_last_24_months")
        .eq("id", clientId)
        .maybeSingle();
      if (currentClientError || !currentClient) {
        return NextResponse.json(
          {
            error:
              currentClientError?.message ??
              "The roadside-ticket answer could not be confirmed",
          },
          { status: currentClientError ? 500 : 404 }
        );
      }
      if (
        currentClient.citation_dismissed_last_24_months !==
        body.citationDismissedLast24Months
      ) {
        return NextResponse.json(
          {
            error:
              "The roadside-ticket answer changed in another request. Reload onboarding and try again.",
            code: "CITATION_ANSWER_CONFLICT",
          },
          { status: 409 }
        );
      }
      // Another identical request won the guarded update. It owns the one-time
      // operations notification; this retry must not send a duplicate.
      citationAnswerChanged = false;
    }
  }

  if (body.citationDismissedLast24Months === true) {
    try {
      const followup = await ensureCitationDispositionFollowup(admin, {
        clientId,
        trigger: "onboarding",
      });
      followupRequestId = followup.requestId;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown court-disposition request failure";
      const { error: failureActivityError } = await admin.from("activity_log").insert({
        client_id: clientId,
        user_id: user.id,
        action_type: "citation_disposition_followup_failed",
        entity_type: "clients",
        entity_id: clientId,
        description:
          "The onboarding answer was saved, but its evidence request could not be prepared",
        metadata: { reason: message, recovery: "scheduled_reconciliation" },
      });
      return NextResponse.json(
        {
          error: `Your answer was saved, but the court-disposition request could not be prepared: ${message}${
            failureActivityError
              ? `. Failure logging also failed: ${failureActivityError.message}`
              : ""
          }`,
          profileSaved: true,
          recovery: "The next scheduled check will retry the request automatically.",
        },
        { status: 502 }
      );
    }
  }

  if (citationAnswerChanged) {
    const baseUrl = (
      process.env.NEXT_PUBLIC_APP_URL ?? "https://safescore.vercel.app"
    ).replace(/\/+$/, "");
    try {
      await notifyOperations(admin, {
        clientId,
        actorUserId: user.id,
        event: "intake_question_answered",
        entityType: "clients",
        entityId: clientId,
        description:
          "Client answered the roadside-ticket intake question during onboarding",
        email: {
          trigger: "staff_intake_answered",
          subject: `Client answered a SafeScore intake question — ${clientRecord.name}`,
          heading: "Client answered an onboarding intake question",
          message:
            "The client answered whether a driver has fought and beaten a roadside ticket in the last 24 months.",
          consoleUrl: `${baseUrl}/console/clients/${clientId}/requests`,
          ctaLabel: "Review client requests",
          details: [
            { label: "Company", value: clientRecord.name },
            { label: "USDOT", value: clientRecord.dot_number },
            {
              label: "Answer",
              value: body.citationDismissedLast24Months ? "Yes" : "No",
            },
            {
              label: "Court-disposition request",
              value: followupRequestId ? "Created" : "Not required",
            },
          ],
        },
        metadata: {
          source: "portal_onboarding_profile",
          previous_answer: previousCitationAnswer,
          answer: body.citationDismissedLast24Months,
          followup_request_id: followupRequestId,
        },
      });
    } catch (notificationError) {
      return NextResponse.json(
        {
          error: `Your answer was saved, but the operations notification failed: ${
            notificationError instanceof Error
              ? notificationError.message
              : String(notificationError)
          }`,
          profileSaved: true,
          followupRequestId,
        },
        { status: 502 }
      );
    }
  }

  if (Object.keys(profileUpdate).length > 0) {
    const { data: updatedClient, error: updateError } = await admin
      .from("clients")
      .update(profileUpdate)
      .eq("id", clientId)
      .select("id")
      .maybeSingle();

    if (updateError || !updatedClient) {
      console.error(
        "onboarding-profile: clients update failed:",
        updateError?.code,
        updateError?.message,
        updateError?.details,
        updateError?.hint
      );
      return NextResponse.json(
        { error: updateError?.message ?? "Client profile was not updated" },
        { status: updateError ? 500 : 404 }
      );
    }
  }

  // ── Activity log (non-fatal) ─────────────────────────────────────────────────
  try {
    await admin.from("activity_log").insert({
      client_id: clientId,
      user_id: user.id,
      action_type: "onboarding_profile_saved",
      description: "Client completed onboarding profile step",
      metadata: {
        fields_saved: Object.keys(update),
        vehicle_types: body.vehicleTypes,
        operating_states: body.operatingStates,
        operating_radius: body.operatingRadius,
        citation_dismissed_last_24_months:
          body.citationDismissedLast24Months,
      },
    });
  } catch { /* non-fatal */ }

  return NextResponse.json({ success: true, followupRequestId });
}

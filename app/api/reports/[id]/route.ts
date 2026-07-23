import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ReportAccessError,
  requireStaffReportContext,
} from "@/lib/reports/report-access-server";
import {
  buildDraftReportUpdate,
} from "@/lib/reports/report-actions";

export const dynamic = "force-dynamic";

const clientIdSchema = z.string().uuid();
const patchSchema = z.object({
  clientId: clientIdSchema,
  action: z.enum(["save", "review"]),
  finalContent: z
    .string()
    .min(1, "Report content cannot be empty")
    .max(200_000, "Report content is too long")
    .refine(
      (content) => content.trim().length > 0,
      "Report content cannot be empty"
    ),
});
const deleteSchema = z.object({ clientId: clientIdSchema });

function accessErrorResponse(error: unknown) {
  if (error instanceof ReportAccessError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Report action failed";
  return NextResponse.json({ error: message }, { status: 500 });
}

async function requestJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const parsed = patchSchema.safeParse(await requestJson(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid report update", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { id } = await params;
  const { clientId, action, finalContent } = parsed.data;

  try {
    const context = await requireStaffReportContext({
      clientId,
      reportId: id,
    });
    if (context.report.status !== "draft") {
      return NextResponse.json(
        { error: "Only draft reports can be edited or marked reviewed" },
        { status: 409 }
      );
    }

    const update = buildDraftReportUpdate({
      action,
      finalContent,
      reviewerId: context.user.id,
      reviewedAt: new Date().toISOString(),
    });
    const { data: updated, error: updateError } = await context.supabase
      .from("reports")
      .update(update)
      .eq("id", id)
      .eq("client_id", clientId)
      .eq("status", "draft")
      .select(
        "id, status, final_content, reviewed_by, reviewed_at"
      )
      .maybeSingle();

    if (updateError) {
      return NextResponse.json(
        { error: `Unable to update report: ${updateError.message}` },
        { status: 500 }
      );
    }
    if (!updated) {
      return NextResponse.json(
        {
          error:
            "The report changed before this action completed. Reload and review its current status.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ report: updated });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const parsed = deleteSchema.safeParse(await requestJson(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A valid client is required to delete a report draft" },
      { status: 400 }
    );
  }

  const { id } = await params;
  const { clientId } = parsed.data;

  try {
    const context = await requireStaffReportContext({
      clientId,
      reportId: id,
    });
    if (context.report.status !== "draft") {
      return NextResponse.json(
        { error: "Only draft reports can be deleted" },
        { status: 409 }
      );
    }

    const { data: deleted, error: deleteError } = await context.supabase
      .from("reports")
      .delete()
      .eq("id", id)
      .eq("client_id", clientId)
      .eq("status", "draft")
      .select("id")
      .maybeSingle();

    if (deleteError) {
      return NextResponse.json(
        { error: `Unable to delete report draft: ${deleteError.message}` },
        { status: 500 }
      );
    }
    if (!deleted) {
      return NextResponse.json(
        {
          error:
            "The report changed before deletion completed. Reload and review its current status.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ deleted: true, reportId: deleted.id });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

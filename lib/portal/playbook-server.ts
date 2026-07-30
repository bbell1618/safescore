import "server-only";

import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";

const nonEmptyText = z.string().trim().min(1);

const ownerModuleSchema = z.object({
  key: z.enum(["A1", "A2", "A3", "A4"]),
  title: nonEmptyText,
  installment: nonEmptyText,
  content: nonEmptyText,
  deliverables: z.array(nonEmptyText).min(1),
});

const ownerCurriculumSchema = z
  .array(ownerModuleSchema)
  .length(4)
  .superRefine((modules, context) => {
    const keys = new Set(modules.map((module) => module.key));
    for (const key of ["A1", "A2", "A3", "A4"] as const) {
      if (!keys.has(key)) {
        context.addIssue({
          code: "custom",
          message: `Missing owner curriculum module ${key}`,
        });
      }
    }
  });

const familyProgramSchema = z.object({
  familyKey: nonEmptyText,
  familyName: nonEmptyText,
  familyPriority: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  points: z.number().nonnegative(),
  inflowRatePerMonth: z.number().nonnegative(),
  trailingWindowDays: z.number().int().positive(),
  priorityScore: z.number().nonnegative(),
  riskContext: nonEmptyText,
  program: z.array(nonEmptyText).min(1),
  workingWhen: z.array(nonEmptyText).min(1),
  installments: z.array(nonEmptyText).min(1),
  introduction: nonEmptyText,
  coachingLanguage: nonEmptyText,
});

const installmentSchema = z.object({
  month: z.number().int().min(1).max(12),
  title: nonEmptyText,
  objective: nonEmptyText,
  deliverables: z.array(nonEmptyText).min(1),
});

const installmentCalendarSchema = z
  .array(installmentSchema)
  .length(12)
  .superRefine((installments, context) => {
    const months = new Set(installments.map((installment) => installment.month));
    for (let month = 1; month <= 12; month += 1) {
      if (!months.has(month)) {
        context.addIssue({
          code: "custom",
          message: `Missing installment month ${month}`,
        });
      }
    }
  });

const playbookRowSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  source_as_of: nonEmptyText,
  generated_at: nonEmptyText,
  owner_curriculum: ownerCurriculumSchema,
  family_programs: z.array(familyProgramSchema),
  installment_calendar: installmentCalendarSchema,
});

const INTERNAL_COPY_PATTERN =
  /\blane\s+c\b|template version|mapping review|unmapped code|familykey|priorityscore|truth[\s-]?up/i;

const GENERAL_SAFETY_PORTAL_COPY = {
  introduction:
    "These less common items are grouped here so they stay visible while you work through the higher-frequency programs.",
  riskContext:
    "Each item still needs an owner, a due date, and a documented correction even when it does not form a repeated pattern.",
  coachingLanguage:
    "Review each item during your weekly safety block, assign the correction, and keep proof that it was completed.",
  program: [
    "Review each item during the weekly safety block.",
    "Assign a corrective owner and completion date.",
    "Keep the repair or coaching record with your safety files.",
  ],
  workingWhen: [
    "Every item has a documented correction.",
    "No similar issue appears in a new inspection.",
  ],
  installments: [
    "General corrective-action checklist",
    "Monthly follow-up review",
  ],
} as const;

export type PortalPlaybook = Omit<
  z.infer<typeof playbookRowSchema>,
  "family_programs" | "owner_curriculum" | "installment_calendar"
> & {
  family_programs: Array<z.infer<typeof familyProgramSchema>>;
  owner_curriculum: Array<z.infer<typeof ownerModuleSchema>>;
  installment_calendar: Array<z.infer<typeof installmentSchema>>;
};

function validationSummary(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "playbook";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function parsePortalPlaybook(value: unknown): PortalPlaybook {
  const parsed = playbookRowSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Unable to render coaching playbook: stored playbook failed validation (${validationSummary(
        parsed.error
      )})`
    );
  }

  const clientPrograms = parsed.data.family_programs.map((program) =>
    program.familyKey === "general_safety"
      ? {
          ...program,
          ...GENERAL_SAFETY_PORTAL_COPY,
          program: [...GENERAL_SAFETY_PORTAL_COPY.program],
          workingWhen: [...GENERAL_SAFETY_PORTAL_COPY.workingWhen],
          installments: [...GENERAL_SAFETY_PORTAL_COPY.installments],
        }
      : program
  );
  const clientInstallments = parsed.data.installment_calendar.map(
    (installment) => ({
      ...installment,
      title: INTERNAL_COPY_PATTERN.test(installment.title)
        ? "Focused safety review"
        : installment.title,
      objective: INTERNAL_COPY_PATTERN.test(installment.objective)
        ? "Review the current safety items, assign each correction, and document the completed work."
        : installment.objective,
      deliverables: installment.deliverables.map((deliverable) =>
        INTERNAL_COPY_PATTERN.test(deliverable)
          ? "Focused safety-item review"
          : deliverable
      ),
    })
  );
  const displayedCopy = JSON.stringify({
    ownerCurriculum: parsed.data.owner_curriculum.map((module) => ({
      title: module.title,
      installment: module.installment,
      content: module.content,
      deliverables: module.deliverables,
    })),
    familyPrograms: clientPrograms.map((program) => ({
      familyName: program.familyName,
      introduction: program.introduction,
      riskContext: program.riskContext,
      coachingLanguage: program.coachingLanguage,
      program: program.program,
      workingWhen: program.workingWhen,
      installments: program.installments,
    })),
    installments: clientInstallments.map((installment) => ({
      title: installment.title,
      objective: installment.objective,
      deliverables: installment.deliverables,
    })),
  });
  if (INTERNAL_COPY_PATTERN.test(displayedCopy)) {
    throw new Error(
      "Unable to render coaching playbook: stored copy contains internal operating vocabulary."
    );
  }

  return {
    ...parsed.data,
    family_programs: clientPrograms.sort(
      (left, right) =>
        left.familyPriority - right.familyPriority ||
        right.priorityScore - left.priorityScore ||
        left.familyName.localeCompare(right.familyName)
    ),
    owner_curriculum: [...parsed.data.owner_curriculum].sort((left, right) =>
      left.key.localeCompare(right.key)
    ),
    installment_calendar: clientInstallments.sort(
      (left, right) => left.month - right.month
    ),
  };
}

/**
 * This service-role read must only be called after the portal page has passed
 * the shared playbook_coach entitlement gate. The query remains scoped to the
 * linked client because client_playbooks intentionally has staff-only RLS.
 */
export async function loadLatestPortalPlaybook(
  clientId: string
): Promise<PortalPlaybook | null> {
  const service = await createServiceClient();
  const result = await service
    .from("client_playbooks")
    .select(
      "id, version, source_as_of, generated_at, owner_curriculum, family_programs, installment_calendar"
    )
    .eq("client_id", clientId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) {
    throw new Error(`Unable to load coaching playbook: ${result.error.message}`);
  }
  return result.data ? parsePortalPlaybook(result.data) : null;
}

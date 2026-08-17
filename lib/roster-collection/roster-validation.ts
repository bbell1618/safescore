import { z } from "zod";

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  }, "Use a real calendar date.");

const optionalDate = z.union([isoDateSchema, z.null()]).optional();
const driverNameSchema = z.string().trim().min(1).max(160);
const cdlNumberSchema = z.string().trim().min(1).max(80);
const cdlStateSchema = z
  .string()
  .trim()
  .length(2)
  .regex(/^[A-Za-z]{2}$/)
  .transform((value) => value.toUpperCase());
const cdlClassSchema = z.string().trim().min(1).max(20);

export const rosterDriverCreateSchema = z
  .object({
    full_name: driverNameSchema,
    cdl_number: cdlNumberSchema,
    cdl_state: cdlStateSchema.default("CA"),
    cdl_class: cdlClassSchema.default("A"),
    cdl_expiry: optionalDate,
    medical_cert_expiry: optionalDate,
    hired_date: optionalDate,
  })
  .strict();

// Keep PATCH fields independently optional. Deriving this from the create
// schema would retain Zod defaults and overwrite omitted state/class values.
export const rosterDriverUpdateSchema = z
  .object({
    full_name: driverNameSchema.optional(),
    cdl_number: cdlNumberSchema.optional(),
    cdl_state: cdlStateSchema.optional(),
    cdl_class: cdlClassSchema.optional(),
    cdl_expiry: optionalDate,
    medical_cert_expiry: optionalDate,
    hired_date: optionalDate,
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one driver field is required."
  );

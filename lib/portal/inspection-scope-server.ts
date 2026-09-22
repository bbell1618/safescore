import "server-only";
import { cache } from "react";
import { getCanonicalInspectionScope } from "@/lib/fmcsa/canonical-inspection-scope";

/** Share this read within one server render, never across clients or requests. */
export const loadPortalInspectionScope = cache(async (clientId: string) => getCanonicalInspectionScope(clientId));

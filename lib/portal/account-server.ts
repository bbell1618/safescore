import "server-only";

import { createServiceClient } from "@/lib/supabase/server";

export type PortalAccountData = {
  company: {
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    phone: string | null;
    email: string | null;
    servicePlanDrivers: number | null;
  };
  safer: {
    powerUnits: number | null;
    drivers: number | null;
    address: string | null;
    physicalAddress: string | null;
    saferAsOf: string | null;
    fetchedAt: string | null;
  } | null;
  subscription: {
    tier: string;
    status: string;
    billingCycle: string | null;
    currentPeriodEnd: string | null;
  } | null;
  portalUsers: Array<{
    id: string;
    email: string;
    createdAt: string;
  }>;
};

function fail(label: string, error: { message: string } | null) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

export async function loadPortalAccountData(input: {
  clientId: string;
}): Promise<PortalAccountData> {
  const service = await createServiceClient();

  const [companyResult, saferResult, subscriptionResult, usersResult] =
    await Promise.all([
      service
        .from("clients")
        .select(
          "address, city, state, zip, phone, email, driver_count"
        )
        .eq("id", input.clientId)
        .single(),
      service
        .from("carrier_profiles")
        .select(
          "power_units, drivers, address, physical_address, safer_as_of, fetched_at"
        )
        .eq("client_id", input.clientId)
        .order("fetched_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      service
        .from("subscriptions")
        .select("tier, status, billing_cycle, current_period_end")
        .eq("client_id", input.clientId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      service
        .from("users")
        .select("id, email, created_at")
        .eq("client_id", input.clientId)
        .eq("role", "client_user")
        .order("created_at", { ascending: true }),
    ]);

  fail("Unable to load portal company information", companyResult.error);
  fail("Unable to load FMCSA fleet information", saferResult.error);
  fail("Unable to load portal subscription", subscriptionResult.error);
  fail("Unable to load portal users", usersResult.error);

  if (!companyResult.data) {
    throw new Error("Unable to load portal company information: client not found");
  }

  const company = companyResult.data;
  const safer = saferResult.data;
  const subscription = subscriptionResult.data;

  return {
    company: {
      address: company.address,
      city: company.city,
      state: company.state,
      zip: company.zip,
      phone: company.phone,
      email: company.email,
      servicePlanDrivers: company.driver_count,
    },
    safer: safer
      ? {
          powerUnits: safer.power_units,
          drivers: safer.drivers,
          address: safer.address,
          physicalAddress: safer.physical_address,
          saferAsOf: safer.safer_as_of,
          fetchedAt: safer.fetched_at,
        }
      : null,
    subscription: subscription
      ? {
          tier: subscription.tier,
          status: subscription.status,
          billingCycle: subscription.billing_cycle,
          currentPeriodEnd: subscription.current_period_end,
        }
      : null,
    portalUsers: (usersResult.data ?? []).map((user) => ({
      id: user.id,
      email: user.email,
      createdAt: user.created_at,
    })),
  };
}

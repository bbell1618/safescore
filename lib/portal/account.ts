export type AccountAddressSource = {
  label: "FMCSA SAFER Company Snapshot";
  asOf: string | null;
};

export type ResolvedAccountAddress = {
  value: string | null;
  source: AccountAddressSource | null;
};

type ClientAddressFields = {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

type SaferAddressFields = {
  physical_address: string | null;
  address: string | null;
  safer_as_of: string | null;
  fetched_at: string | null;
};

function clean(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function clientAddress(fields: ClientAddressFields): string | null {
  const street = clean(fields.address);
  if (!street) return null;

  const city = clean(fields.city);
  const state = clean(fields.state);
  const zip = clean(fields.zip);
  const stateZip = [state, zip].filter(Boolean).join(" ");

  return [street, city, stateZip].filter(Boolean).join(", ");
}

export function resolveAccountAddress(
  client: ClientAddressFields,
  safer: SaferAddressFields | null
): ResolvedAccountAddress {
  const storedAddress = clientAddress(client);
  if (storedAddress) {
    return { value: storedAddress, source: null };
  }

  const saferAddress =
    clean(safer?.physical_address) ?? clean(safer?.address);
  if (!saferAddress) {
    return { value: null, source: null };
  }

  return {
    value: saferAddress,
    source: {
      label: "FMCSA SAFER Company Snapshot",
      asOf: safer?.safer_as_of ?? safer?.fetched_at ?? null,
    },
  };
}

function countLabel(
  value: number | null,
  singular: string,
  plural: string
): string {
  if (value === null) return `${plural} not available`;
  return `${value.toLocaleString("en-US")} ${
    value === 1 ? singular : plural
  }`;
}

export function fleetSourceLines(input: {
  powerUnits: number | null;
  fmcsaDrivers: number | null;
  servicePlanDrivers: number | null;
}) {
  return {
    fmcsa:
      `FMCSA on file: ${countLabel(
        input.powerUnits,
        "power unit",
        "power units"
      )} · ${countLabel(input.fmcsaDrivers, "driver", "drivers")} (MCS-150)`,
    servicePlan:
      input.servicePlanDrivers === null
        ? "Your service plan: driver count not recorded"
        : `Your service plan: ${countLabel(
            input.servicePlanDrivers,
            "driver",
            "drivers"
          )}`,
  };
}

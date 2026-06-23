"use client";

export type ClientTierValue = "monitor" | "remediate" | "total_safety";

export interface ClientIntakeValues {
  name: string;
  dotNumber: string;
  mcNumber: string;
  contactName: string;
  contactEmail: string;
  tier: ClientTierValue;
  driverCount: string;
  geiaClient: boolean;
}

interface ClientIntakeFieldsProps {
  values: ClientIntakeValues;
  onChange: (values: ClientIntakeValues) => void;
  lockedFields?: Partial<Record<keyof ClientIntakeValues, boolean>>;
  idPrefix: string;
}

function normalizeDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function ClientIntakeFields({
  values,
  onChange,
  lockedFields = {},
  idPrefix,
}: ClientIntakeFieldsProps) {
  const setValue = <K extends keyof ClientIntakeValues>(key: K, value: ClientIntakeValues[K]) => {
    onChange({ ...values, [key]: value });
  };

  const estimatedMonthly =
    values.tier === "total_safety" && values.driverCount
      ? 999 + parseInt(values.driverCount, 10) * 29
      : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor={`${idPrefix}-name`} className="block text-xs font-medium text-gray-500 mb-1">
            Company name <span className="text-[#C67A1E]">*</span>
          </label>
          <input
            id={`${idPrefix}-name`}
            type="text"
            required
            value={values.name}
            disabled={lockedFields.name}
            onChange={(e) => setValue("name", e.target.value)}
            placeholder="Nationwide Carrier Inc"
            className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#C67A1E] disabled:bg-gray-50 disabled:text-gray-500"
          />
        </div>

        <div>
          <label htmlFor={`${idPrefix}-dot`} className="block text-xs font-medium text-gray-500 mb-1">
            DOT number <span className="text-[#C67A1E]">*</span>
          </label>
          <input
            id={`${idPrefix}-dot`}
            type="text"
            required
            value={values.dotNumber}
            disabled={lockedFields.dotNumber}
            onChange={(e) => setValue("dotNumber", normalizeDigits(e.target.value))}
            placeholder="2533650"
            className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#C67A1E] disabled:bg-gray-50 disabled:text-gray-500"
          />
        </div>

        <div>
          <label htmlFor={`${idPrefix}-mc`} className="block text-xs font-medium text-gray-500 mb-1">
            MC number <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id={`${idPrefix}-mc`}
            type="text"
            value={values.mcNumber}
            onChange={(e) => setValue("mcNumber", normalizeDigits(e.target.value))}
            placeholder="880750"
            className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#C67A1E]"
          />
        </div>

        <div>
          <label htmlFor={`${idPrefix}-drivers`} className="block text-xs font-medium text-gray-500 mb-1">
            Number of drivers <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id={`${idPrefix}-drivers`}
            type="number"
            min="0"
            value={values.driverCount}
            onChange={(e) => setValue("driverCount", e.target.value)}
            placeholder="e.g. 12"
            className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#C67A1E]"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor={`${idPrefix}-contact-name`} className="block text-xs font-medium text-gray-500 mb-1">
            Contact name <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id={`${idPrefix}-contact-name`}
            type="text"
            value={values.contactName}
            onChange={(e) => setValue("contactName", e.target.value)}
            placeholder="Mike Johnson"
            className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#C67A1E]"
          />
        </div>

        <div>
          <label htmlFor={`${idPrefix}-email`} className="block text-xs font-medium text-gray-500 mb-1">
            Contact email <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id={`${idPrefix}-email`}
            type="email"
            value={values.contactEmail}
            onChange={(e) => setValue("contactEmail", e.target.value)}
            placeholder="contact@carrier.com"
            className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#C67A1E]"
          />
        </div>
      </div>

      <div>
        <label htmlFor={`${idPrefix}-tier`} className="block text-xs font-medium text-gray-500 mb-1">
          Service tier
        </label>
        <select
          id={`${idPrefix}-tier`}
          value={values.tier}
          onChange={(e) => setValue("tier", e.target.value as ClientTierValue)}
          className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#C67A1E]"
        >
          <option value="monitor">Monitor ($199/mo)</option>
          <option value="remediate">Remediate ($599/mo)</option>
          <option value="total_safety">Total Safety ($999/mo + $29/driver/mo)</option>
        </select>
        {values.tier === "total_safety" && values.driverCount && (
          <p className="text-xs text-gray-500 mt-1">
            Estimated monthly: $999 + ({values.driverCount} drivers {"\u00D7"} $29) ={" "}
            <span className="font-semibold text-[#1E1C1A]">
              ${estimatedMonthly?.toLocaleString()}/mo
            </span>
          </p>
        )}
        {values.tier === "total_safety" && !values.driverCount && (
          <p className="text-xs text-gray-400 mt-1">
            Enter driver count to see estimated monthly total.
          </p>
        )}
      </div>

      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          id={`${idPrefix}-geia-client`}
          checked={values.geiaClient}
          onChange={(e) => setValue("geiaClient", e.target.checked)}
          className="mt-0.5 rounded border-gray-300 text-[#C67A1E] focus:ring-[#C67A1E]"
        />
        <label htmlFor={`${idPrefix}-geia-client`} className="text-sm text-gray-700">
          Existing GEIA insurance client (waives assessment fee)
        </label>
      </div>
    </div>
  );
}
